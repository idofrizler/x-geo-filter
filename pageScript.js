// This script runs in the page context to access cookies and make API calls
// It intercepts X.com's own fetch calls to capture authentication headers

(function() {
  'use strict';
  
  // Store headers from X.com's own API calls
  let xcomHeaders = null;
  let headersReady = false;
  
  console.log('[Geo Filter Page Script] Loaded in page context');
  
  // Function to capture headers from a request
  function captureHeaders(headers) {
    if (!headers) return;
    
    const headerObj = {};
    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        headerObj[key] = value;
      });
    } else if (headers instanceof Object) {
      // Copy all headers
      for (const [key, value] of Object.entries(headers)) {
        headerObj[key] = value;
      }
    }
    
    // Replace headers completely to ensure we get auth tokens
    xcomHeaders = headerObj;
    headersReady = true;
    console.log('[Geo Filter Page Script] Captured X.com headers:', Object.keys(headerObj));
  }
  
  // Intercept fetch to capture X.com's headers
  const originalFetch = window.fetch;
  window.fetch = function(...args) {
    const url = args[0];
    const options = args[1] || {};
    
    // If it's a X.com GraphQL API call, capture ALL headers
    if (typeof url === 'string' && url.includes('x.com/i/api/graphql')) {
      if (options.headers) {
        captureHeaders(options.headers);
      }
    }
    
    return originalFetch.apply(this, args);
  };
  
  // Also intercept XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.send = function(...args) {
    if (this._url && this._url.includes('x.com/i/api/graphql')) {
      const headers = {};
      if (this._headers) {
        Object.assign(headers, this._headers);
      }
      captureHeaders(headers);
    }
    return originalXHRSend.apply(this, args);
  };
  
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
    if (!this._headers) this._headers = {};
    this._headers[header] = value;
    return originalSetRequestHeader.apply(this, [header, value]);
  };
  
  // Wait for X.com to make some API calls first
  setTimeout(() => {
    if (!headersReady) {
      console.log('[Geo Filter Page Script] No X.com headers captured yet, using defaults');
      xcomHeaders = {
        'Accept': '*/*',
        'Content-Type': 'application/json'
      };
      headersReady = true;
    }
  }, 3000);
  
  // Listen for fetch requests from content script
  window.addEventListener('message', async function(event) {
    // Only accept messages from our extension
    if (event.source !== window) return;
    if (event.data && event.data.type === 'GEO_FILTER_FETCH_USER') {
      const { username, requestId } = event.data;
      
      // Wait for headers to be ready
      if (!headersReady) {
        let waitCount = 0;
        while (!headersReady && waitCount < 30) {
          await new Promise(resolve => setTimeout(resolve, 100));
          waitCount++;
        }
      }
      
      try {
        const variables = JSON.stringify({ screenName: username });
        const url = `https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery?variables=${encodeURIComponent(variables)}`;
        
        // Use captured headers or minimal defaults
        const headers = xcomHeaders || {
          'Accept': '*/*',
          'Content-Type': 'application/json'
        };
        
        // Make request with X.com's own headers
        const response = await fetch(url, {
          method: 'GET',
          credentials: 'include',
          headers: headers,
          referrer: window.location.href,
          referrerPolicy: 'origin-when-cross-origin'
        });
        
        let location = null;
        let success = true;
        let error = null;
        
        if (response.ok) {
          const data = await response.json();
          location = data?.data?.user_result_by_screen_name?.result?.about_profile?.account_based_in || null;
          console.log(`[Geo Filter Page Script] Got location for ${username}: ${location}`);
        } else {
          success = false;
          if (response.status === 429) {
            error = 'RATE_LIMIT';
            console.warn(`[Geo Filter Page Script] Rate limited for ${username}`);
          } else if (response.status === 403) {
            error = 'AUTHENTICATION';
            console.error(`[Geo Filter Page Script] Auth error for ${username}`);
          } else {
            error = `HTTP ${response.status}`;
            console.error(`[Geo Filter Page Script] Error ${response.status} for ${username}`);
          }
        }
        
        // Send response back to content script
        window.postMessage({
          type: 'GEO_FILTER_FETCH_RESPONSE',
          requestId: requestId,
          username: username,
          location: location,
          success: success,
          error: error
        }, '*');
        
      } catch (error) {
        console.error('[Geo Filter Page Script] Error fetching:', error);
        window.postMessage({
          type: 'GEO_FILTER_FETCH_RESPONSE',
          requestId: requestId,
          username: username,
          location: null,
          success: false,
          error: error.message
        }, '*');
      }
    }
  });
  
  // Signal that we're ready
  window.postMessage({
    type: 'GEO_FILTER_INJECTED_READY'
  }, '*');
  
})();
