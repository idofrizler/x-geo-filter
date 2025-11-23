// Content script for X.com to detect and annotate users with geography flags
// Uses page script injection to capture X.com's auth headers

const PROCESSED_ATTRIBUTE = 'data-geo-processed';
const GEO_LABEL_CLASS = 'geo-filter-label';
const processingQueue = new Set();
const processedUsers = new Set();

// Rate limiting configuration
const RATE_LIMIT_DELAY = 100; // ms between API calls
const RATE_LIMIT_BATCH_SIZE = 5; // max concurrent requests
const RATE_LIMIT_COOLDOWN = 5000; // ms to wait after 429 error
let lastRequestTime = 0;
let activeRequests = 0;
let rateLimitCooldown = false;
let pendingQueue = [];

// Page script state
let injectedScriptReady = false;
let pendingRequests = new Map(); // requestId -> { resolve, reject, username }
let requestIdCounter = 0;

// Inject the page script
function injectPageScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('pageScript.js');
  script.onload = function() {
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
  console.log('[Geo Filter] Injected page script');
}

// Listen for messages from page script
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  const message = event.data;
  
  // Check if page script is ready
  if (message.type === 'GEO_FILTER_INJECTED_READY') {
    injectedScriptReady = true;
    console.log('[Geo Filter] Page script ready');
    return;
  }
  
  // Handle fetch responses
  if (message.type === 'GEO_FILTER_FETCH_RESPONSE') {
    const { requestId, username, location, success, error } = message;
    
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pendingRequests.delete(requestId);
      
      if (success) {
        pending.resolve(location);
      } else {
        pending.reject(new Error(error || 'Unknown error'));
      }
    }
  }
});

// Initialize the extension
function init() {
  console.log('[Geo Filter] Extension initialized');
  
  // Inject page script
  injectPageScript();
  
  // Wait for page script to load, then process
  setTimeout(() => {
    processExistingUsers();
    setupMutationObserver();
  }, 1000);
}

// Process all visible users on the page
function processExistingUsers() {
  const userElements = findUserElements();
  console.log(`[Geo Filter] Found ${userElements.length} user elements to process`);
  userElements.forEach(element => processUserElement(element));
}

// Find all user elements on the page
function findUserElements() {
  const elements = [];
  const seenSpans = new Set(); // Prevent duplicates
  
  // Strategy 1: Find all @username spans in User-Name containers
  // This covers: tweets, replies, quoted tweets
  const userNameContainers = document.querySelectorAll('[data-testid="User-Name"]');
  userNameContainers.forEach(container => {
    // Find all spans with @username
    const spans = container.querySelectorAll('span');
    spans.forEach(span => {
      const text = span.textContent;
      // Match @username format exactly
      if (text && text.match(/^@[a-zA-Z0-9_]+$/)) {
        if (!seenSpans.has(span)) {
          seenSpans.add(span);
          elements.push(span);
        }
      }
    });
  });
  
  // Strategy 2: Profile page - Find @username in UserName testid containers
  const userNameTestIds = document.querySelectorAll('[data-testid="UserName"]');
  userNameTestIds.forEach(container => {
    const spans = container.querySelectorAll('span');
    spans.forEach(span => {
      const text = span.textContent;
      if (text && text.match(/^@[a-zA-Z0-9_]+$/)) {
        if (!seenSpans.has(span)) {
          seenSpans.add(span);
          elements.push(span);
        }
      }
    });
  });
  
  // Strategy 3: Find all spans with @username text directly
  // This catches profile pages and other edge cases
  const allSpans = document.querySelectorAll('span');
  allSpans.forEach(span => {
    const text = span.textContent;
    // Only match if it's EXACTLY @username (no extra text)
    if (text && text.match(/^@[a-zA-Z0-9_]+$/) && text.length > 1) {
      // Make sure it's in a reasonable context (has color style suggesting it's a handle)
      const style = window.getComputedStyle(span.parentElement || span);
      const color = style.color;
      // X.com uses gray colors for handles: rgb(113, 118, 123)
      if (color && (color.includes('113') || color.includes('118') || color.includes('123'))) {
        if (!seenSpans.has(span)) {
          seenSpans.add(span);
          elements.push(span);
        }
      }
    }
  });
  
  return elements;
}

// Extract username from element
function extractUsername(element) {
  const text = element.textContent;
  if (!text) return null;
  
  // Remove @ symbol and clean up
  const username = text.replace('@', '').trim();
  
  // Validate username format (alphanumeric and underscore)
  if (username && /^[a-zA-Z0-9_]+$/.test(username)) {
    return username;
  }
  
  return null;
}

// Process a single user element
async function processUserElement(element) {
  const username = extractUsername(element);
  if (!username) {
    return;
  }
  
  // Mark element as seen
  if (!element.hasAttribute(PROCESSED_ATTRIBUTE)) {
    element.setAttribute(PROCESSED_ATTRIBUTE, 'true');
  }
  
  // If already in queue or processed, try to add label from cache
  if (processingQueue.has(username) || processedUsers.has(username)) {
    addGeoLabel(element, username);
    return;
  }
  
  // Check cache first
  try {
    const cached = await chrome.runtime.sendMessage({
      type: 'GET_CACHED_GEO',
      username: username
    });
    
    if (cached !== null) {
      processedUsers.add(username);
      addGeoLabel(element, username, cached);
      console.log(`[Geo Filter] Processed ${username}: ${cached} (cached)`);
      return;
    }
  } catch (error) {
    console.error(`[Geo Filter] Error checking cache for ${username}:`, error);
  }
  
  // Not in cache - add to pending queue for rate-limited fetching
  if (!pendingQueue.find(item => item.username === username)) {
    pendingQueue.push({ username, element });
    processQueue();
  }
}

// Process pending queue with rate limiting
async function processQueue() {
  // If in cooldown, wait and retry
  if (rateLimitCooldown) {
    setTimeout(processQueue, 1000);
    return;
  }
  
  // Check if we can make more requests
  if (activeRequests >= RATE_LIMIT_BATCH_SIZE || pendingQueue.length === 0) {
    return;
  }
  
  // Rate limit: ensure minimum delay between requests
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
    setTimeout(processQueue, RATE_LIMIT_DELAY - timeSinceLastRequest);
    return;
  }
  
  // Get next item from queue
  const item = pendingQueue.shift();
  if (!item) return;
  
  const { username, element } = item;
  
  // Skip if already processing or processed
  if (processingQueue.has(username) || processedUsers.has(username)) {
    processQueue(); // Continue with next item
    return;
  }
  
  processingQueue.add(username);
  activeRequests++;
  lastRequestTime = Date.now();
  
  try {
    // Fetch from API with rate limiting
    const geoData = await fetchUserGeo(username);
    
    // Cache the result
    await chrome.runtime.sendMessage({
      type: 'SET_CACHED_GEO',
      username: username,
      geoData: geoData
    });
    
    processedUsers.add(username);
    
    // Add label to ALL elements with this username
    addGeoLabelToAllElements(username, geoData);
    
    console.log(`[Geo Filter] Processed ${username}: ${geoData}`);
    
  } catch (error) {
    if (error.message.includes('RATE_LIMIT')) {
      console.log(`[Geo Filter] Rate limit hit for ${username}, skipping`);
      // Don't retry, just mark as processed with no geo data
      processedUsers.add(username);
    } else {
      console.error(`[Geo Filter] Error processing ${username}:`, error);
    }
    // Don't add N/A labels - just skip this user
  } finally {
    processingQueue.delete(username);
    activeRequests--;
    
    // Process next item if not in cooldown
    if (!rateLimitCooldown && pendingQueue.length > 0) {
      setTimeout(processQueue, RATE_LIMIT_DELAY);
    }
  }
}

// Add geo label to all elements with the given username
function addGeoLabelToAllElements(username, geoData) {
  const userElements = findUserElements();
  userElements.forEach(element => {
    const elementUsername = extractUsername(element);
    if (elementUsername === username) {
      addGeoLabel(element, username, geoData);
    }
  });
}

// Fetch user geography via page script (uses X.com's own auth headers)
function fetchUserGeo(username) {
  return new Promise((resolve, reject) => {
    // Wait for page script to be ready
    if (!injectedScriptReady) {
      const checkReady = setInterval(() => {
        if (injectedScriptReady) {
          clearInterval(checkReady);
          fetchUserGeo(username).then(resolve).catch(reject);
        }
      }, 100);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkReady);
        reject(new Error('Page script not ready'));
      }, 5000);
      return;
    }
    
    const requestId = ++requestIdCounter;
    
    // Store the promise handlers
    pendingRequests.set(requestId, { resolve, reject, username });
    
    // Send message to page script
    window.postMessage({
      type: 'GEO_FILTER_FETCH_USER',
      username: username,
      requestId: requestId
    }, '*');
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timeout'));
      }
    }, 10000);
  });
}

// Add geography label next to username
function addGeoLabel(element, username, geoData = null) {
  // Check if label already exists
  const existingLabel = element.parentElement?.querySelector(`.${GEO_LABEL_CLASS}[data-username="${username}"]`);
  if (existingLabel) {
    // Update existing label if we have new data
    if (geoData !== null) {
      const displayText = getCountryFlag(geoData);
      existingLabel.textContent = displayText;
    }
    return;
  }
  
  // If we don't have geo data yet, try to get it from cache by requesting it
  if (geoData === null) {
    // Request from background script (will use cache)
    chrome.runtime.sendMessage({
      type: 'GET_CACHED_GEO',
      username: username
    }).then(cachedData => {
      if (cachedData !== null) {
        addGeoLabel(element, username, cachedData);
      }
    }).catch(err => {
      console.error('[Geo Filter] Error fetching cached data:', err);
    });
    return;
  }
  
  // Create label element
  const label = document.createElement('span');
  label.className = GEO_LABEL_CLASS;
  label.setAttribute('data-username', username);
  
  const displayText = getCountryFlag(geoData);
  label.textContent = displayText;
  
  // Insert after the username element
  if (element.parentElement) {
    element.parentElement.insertBefore(label, element.nextSibling);
  }
}

// Set up MutationObserver to watch for new content
function setupMutationObserver() {
  const observer = new MutationObserver((mutations) => {
    const newElements = findUserElements();
    newElements.forEach(element => {
      if (!element.hasAttribute(PROCESSED_ATTRIBUTE)) {
        processUserElement(element);
      }
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // console.log('[Geo Filter] Mutation observer set up');
}

// Cleanup function to stop all processing
function cleanup() {
  // console.log('[Geo Filter] Cleaning up - stopping all pending requests');
  
  // Clear the pending queue
  pendingQueue = [];
  
  // Reject all pending requests
  pendingRequests.forEach((pending, requestId) => {
    pending.reject(new Error('Page navigation - request cancelled'));
  });
  pendingRequests.clear();
  
  // Clear processing sets
  processingQueue.clear();
  
  // Reset counters
  activeRequests = 0;
  rateLimitCooldown = false;
}

// Listen for page unload/navigation
window.addEventListener('beforeunload', cleanup);
window.addEventListener('pagehide', cleanup);

// Also listen for visibility changes (tab switches)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // console.log('[Geo Filter] Page hidden - pausing queue processing');
    // Don't clear everything, just stop processing new items
    // Queue will resume when page becomes visible again
  }
});

// Detect SPA navigation (URL changes without page reload)
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    // console.log('[Geo Filter] Navigation detected, cleaning up pending requests');
    cleanup();
    
    // Reinitialize after a short delay to process new page
    setTimeout(() => {
      processExistingUsers();
    }, 1000);
  }
}).observe(document, { subtree: true, childList: true });

// Flag conversion function is now loaded from utils/iso-countries.js
// The getCountryFlag() function is available globally

// Start the extension when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
