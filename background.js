// Background service worker for caching only
// API calls are made from content script to access page auth tokens

const CACHE_KEY_PREFIX = 'geo_cache_';

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_CACHED_GEO') {
    getCachedGeo(request.username).then(sendResponse);
    return true;
  } else if (request.type === 'SET_CACHED_GEO') {
    cacheGeo(request.username, request.geoData).then(() => {
      sendResponse({ success: true });
    });
    return true;
  } else if (request.type === 'GET_ALL_CACHED_GEO') {
    getAllCachedGeo().then(sendResponse);
    return true;
  }
});

async function getCachedGeo(username) {
  const key = CACHE_KEY_PREFIX + username.toLowerCase();
  const result = await chrome.storage.local.get(key);
  return result[key] || null;
}

async function cacheGeo(username, geoData) {
  const key = CACHE_KEY_PREFIX + username.toLowerCase();
  await chrome.storage.local.set({ [key]: geoData });
  console.log(`[Geo Filter] Cached geo for ${username}:`, geoData);
  
  // Also update the geoCache object for quick lookup
  const result = await chrome.storage.local.get('geoCache');
  const geoCache = result.geoCache || {};
  geoCache[username.toLowerCase()] = geoData;
  await chrome.storage.local.set({ geoCache });
}

async function getAllCachedGeo() {
  const result = await chrome.storage.local.get('geoCache');
  return result.geoCache || {};
}
