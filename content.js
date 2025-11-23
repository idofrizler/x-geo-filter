// Content script for X.com to detect and annotate users with geography flags

// Import flag utility (will be loaded via manifest)
// Note: We'll need to include flags.js in the manifest content_scripts

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

// Initialize the extension
function init() {
  console.log('[Geo Filter] Extension initialized');
  
  // Process existing content
  processExistingUsers();
  
  // Set up mutation observer for dynamic content
  setupMutationObserver();
}

// Process all visible users on the page
function processExistingUsers() {
  const userElements = findUserElements();
  console.log(`[Geo Filter] Found ${userElements.length} user elements to process`);
  userElements.forEach(element => processUserElement(element));
}

// Find all user elements on the page
function findUserElements() {
  const selectors = [
    // Username links in tweets
    'a[href^="/"][href*="/status/"] div[dir="ltr"] > span',
    // User profile links
    'a[role="link"][href^="/"][data-testid="User-Name"]',
    // Tweet author names
    'div[data-testid="User-Name"] a[role="link"]',
    // Reply author names
    'div[data-testid="tweet"] div[data-testid="User-Name"]',
    // Conversation participants
    'article div[data-testid="User-Name"]'
  ];
  
  const elements = [];
  
  // Find all username links (more reliable selector)
  const links = document.querySelectorAll('a[role="link"][href^="/"]');
  links.forEach(link => {
    const href = link.getAttribute('href');
    // Match pattern: /<username> or /<username>/status/...
    if (href && href.match(/^\/[a-zA-Z0-9_]+(?:\/|$)/)) {
      // Check if this is a username container
      const spans = link.querySelectorAll('span');
      spans.forEach(span => {
        const text = span.textContent;
        if (text && text.startsWith('@')) {
          elements.push(span);
        }
      });
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
      console.warn(`[Geo Filter] Rate limit hit, cooling down for ${RATE_LIMIT_COOLDOWN}ms`);
      rateLimitCooldown = true;
      
      // Put item back in queue
      pendingQueue.unshift(item);
      
      // Schedule cooldown end
      setTimeout(() => {
        rateLimitCooldown = false;
        processQueue();
      }, RATE_LIMIT_COOLDOWN);
    } else {
      console.error(`[Geo Filter] Error processing ${username}:`, error);
      // Add N/A label to all elements with this username
      addGeoLabelToAllElements(username, 'N/A');
    }
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

// Extract authorization token from page's JavaScript
function getAuthToken() {
  // Try to find the bearer token in the page's main.js bundle
  // X.com includes it in their web app code
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const content = script.textContent || script.innerText;
    // Look for Bearer token pattern
    const match = content.match(/Bearer\s+([A-Za-z0-9%]+)/);
    if (match && match[1].length > 100) {
      return `Bearer ${match[1]}`;
    }
  }
  
  // Fallback: use the known public token (may need updating if X changes it)
  // This is X.com's public web API token - it's publicly available in their web app
  return 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
}

// Fetch user geography from X.com API
async function fetchUserGeo(username) {
  const API_URL = 'https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery';
  const variables = { screenName: username };
  const url = `${API_URL}?variables=${encodeURIComponent(JSON.stringify(variables))}`;
  
  // Get CSRF token from cookies
  const csrfToken = document.cookie.split('; ')
    .find(row => row.startsWith('ct0='))
    ?.split('=')[1];
  
  // Get authorization token from page (extracted dynamically)
  const authToken = getAuthToken();
  
  const headers = {
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'X-Twitter-Active-User': 'yes',
    'X-Twitter-Client-Language': 'en',
    'authorization': authToken
  };
  
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: headers
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('RATE_LIMIT: Too many requests. Please wait before trying again.');
    }
    if (response.status === 403) {
      throw new Error('AUTHENTICATION: Unable to authenticate with X.com API. Make sure you are logged in to X.com.');
    }
    throw new Error(`API returned status ${response.status}`);
  }

  const data = await response.json();
  
  // Extract location from response
  const userResult = data?.data?.user_result_by_screen_name?.result;
  
  if (!userResult || userResult.__typename === 'UserUnavailable') {
    return 'N/A';
  }

  const location = userResult?.about_profile?.account_based_in;
  
  return location || 'N/A';
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
  
  console.log('[Geo Filter] Mutation observer set up');
}

// Flag conversion function is now loaded from utils/iso-countries.js
// The getCountryFlag() function is available globally

// Start the extension when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
