// Popup script for managing filtered countries

let filteredCountries = [];

// Initialize popup
async function init() {
  console.log('[Popup] Initializing...', Object.keys(COUNTRY_NAME_TO_CODE || {}).length, 'countries available');
  
  // Load filtered countries from storage
  const result = await chrome.storage.local.get(['filteredCountries', 'geoCache', 'filteredPostsCount']);
  filteredCountries = result.filteredCountries || [];
  
  // Display filtered countries
  displayFilteredCountries();
  
  // Update stats
  updateStats(result.geoCache || {}, result.filteredPostsCount || 0);
  
  // Set up event listeners
  setupEventListeners();
}

// Set up event listeners
function setupEventListeners() {
  const searchInput = document.getElementById('country-search');
  const suggestionsDiv = document.getElementById('suggestions');
  const clearCacheBtn = document.getElementById('clear-cache');
  
  // Search input
  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    
    if (query.length === 0) {
      suggestionsDiv.classList.remove('active');
      return;
    }
    
    // Find matching countries - use COUNTRY_NAME_TO_CODE from iso-countries.js
    const matches = Object.keys(COUNTRY_NAME_TO_CODE || {})
      .filter(country => {
        return country.toLowerCase().includes(query) && 
               !filteredCountries.includes(country);
      })
      .slice(0, 10); // Limit to 10 suggestions
    
    if (matches.length === 0) {
      suggestionsDiv.classList.remove('active');
      return;
    }
    
    // Display suggestions
    suggestionsDiv.innerHTML = matches
      .map(country => `
        <div class="suggestion-item" data-country="${country}">
          <span class="suggestion-flag">${getCountryFlag(country)}</span>
          <span>${country}</span>
        </div>
      `)
      .join('');
    
    suggestionsDiv.classList.add('active');
    
    // Add click handlers to suggestions
    suggestionsDiv.querySelectorAll('.suggestion-item').forEach(item => {
      item.addEventListener('click', () => {
        const country = item.dataset.country;
        addFilteredCountry(country);
        searchInput.value = '';
        suggestionsDiv.classList.remove('active');
      });
    });
  });
  
  // Close suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      suggestionsDiv.classList.remove('active');
    }
  });
  
  // Clear cache button
  clearCacheBtn.addEventListener('click', async () => {
    if (confirm('Clear all cached geography data?')) {
      // Clear both the geoCache object and all individual geo_cache_ keys
      const allKeys = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(allKeys).filter(key => 
        key === 'geoCache' || key.startsWith('geo_cache_')
      );
      await chrome.storage.local.remove(keysToRemove);
      updateStats({}, 0);
      
      // Notify content scripts to refresh
      const tabs = await chrome.tabs.query({ url: '*://x.com/*' });
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { type: 'CACHE_CLEARED' }).catch(() => {});
      });
    }
  });
}

// Add a country to filtered list
async function addFilteredCountry(country) {
  if (!filteredCountries.includes(country)) {
    filteredCountries.push(country);
    await saveFilteredCountries();
    displayFilteredCountries();
    
    // Notify content scripts to apply filter
    notifyContentScripts();
  }
}

// Remove a country from filtered list
async function removeFilteredCountry(country) {
  filteredCountries = filteredCountries.filter(c => c !== country);
  await saveFilteredCountries();
  displayFilteredCountries();
  
  // Notify content scripts to remove filter
  notifyContentScripts();
}

// Save filtered countries to storage
async function saveFilteredCountries() {
  await chrome.storage.local.set({ filteredCountries });
}

// Display filtered countries
function displayFilteredCountries() {
  const container = document.getElementById('filtered-countries');
  
  if (filteredCountries.length === 0) {
    container.classList.add('empty');
    container.innerHTML = '';
    return;
  }
  
  container.classList.remove('empty');
  container.innerHTML = filteredCountries
    .map(country => `
      <div class="country-tag">
        <span>${getCountryFlag(country)} ${country}</span>
        <span class="country-tag-remove" data-country="${country}">×</span>
      </div>
    `)
    .join('');
  
  // Add remove handlers
  container.querySelectorAll('.country-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const country = btn.dataset.country;
      removeFilteredCountry(country);
    });
  });
}

// Update statistics
function updateStats(geoCache, filteredCount) {
  const cachedCount = Object.keys(geoCache).length;
  const cachedCountElement = document.getElementById('cached-count');
  cachedCountElement.textContent = cachedCount;
  
  // Generate top 5 countries tooltip
  if (cachedCount > 0) {
    const countryCounts = {};
    
    // Count users per country
    Object.values(geoCache).forEach(country => {
      if (country && country !== 'N/A') {
        countryCounts[country] = (countryCounts[country] || 0) + 1;
      }
    });
    
    // Sort by count and get top 5
    const topCountries = Object.entries(countryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    // Create tooltip HTML
    if (topCountries.length > 0) {
      const tooltipHTML = `
        <div class="stat-tooltip">
          <div class="stat-tooltip-title">Top Countries</div>
          ${topCountries.map(([country, count]) => `
            <div class="stat-tooltip-item">
              <span class="stat-tooltip-country">${getCountryFlag(country)} ${country}</span>
              <span class="stat-tooltip-count">${count}</span>
            </div>
          `).join('')}
        </div>
      `;
      
      // Remove existing tooltip if any
      const existingTooltip = cachedCountElement.querySelector('.stat-tooltip');
      if (existingTooltip) {
        existingTooltip.remove();
      }
      
      // Add new tooltip
      cachedCountElement.insertAdjacentHTML('beforeend', tooltipHTML);
    }
  }
  
  document.getElementById('filtered-count').textContent = filteredCount;
}

// Notify content scripts of filter changes
async function notifyContentScripts() {
  const tabs = await chrome.tabs.query({ url: '*://x.com/*' });
  tabs.forEach(tab => {
    chrome.tabs.sendMessage(tab.id, {
      type: 'FILTERS_UPDATED',
      filteredCountries: filteredCountries
    }).catch(() => {});
  });
}

// Get country flag emoji - use the function from iso-countries.js
// But if it's not available, define a simple version
function getCountryFlagLocal(country) {
  // Try to use the global function from iso-countries.js
  if (typeof getCountryFlag === 'function') {
    return getCountryFlag(country);
  }
  
  // Fallback implementation
  if (!COUNTRY_NAME_TO_CODE || !COUNTRY_NAME_TO_CODE[country]) return '🌍';
  
  const code = COUNTRY_NAME_TO_CODE[country];
  
  // Convert country code to flag emoji
  const codePoints = code
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  
  return String.fromCodePoint(...codePoints);
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
