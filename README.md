# X Geography Filter Chrome Extension

A Chrome extension that displays country flags next to usernames on X.com (Twitter) based on their geographic location.

## Features

- **Automatic Detection**: Automatically detects usernames in your X.com feed, replies, and profiles
- **Geographic Labeling**: Displays country flags or location text next to usernames
- **Smart Caching**: Caches location data locally to minimize API calls
- **Real-time Updates**: Uses MutationObserver to detect dynamically loaded content
- **Minimal UI**: Seamlessly integrates with X.com's interface

## Installation

### Development Mode (Unpacked Extension)

1. **Clone or download this repository** to your local machine

2. **Open Chrome** and navigate to `chrome://extensions/`

3. **Enable Developer Mode** by toggling the switch in the top-right corner

4. **Click "Load unpacked"** and select the `geo-filter` directory

5. **Navigate to X.com** and the extension will automatically start working

### Adding Extension Icons

The extension requires icon files. Create three PNG images and place them in the `icons/` directory:
- `icon16.png` - 16x16 pixels
- `icon48.png` - 48x48 pixels  
- `icon128.png` - 128x128 pixels

You can use any image editor or online tool to create simple icons (e.g., a globe or flag emoji).

## How It Works

1. **Content Script** (`content.js`) scans the X.com page for username elements
2. **Background Worker** (`background.js`) makes API calls to X's GraphQL endpoint to fetch location data
3. **Caching System** stores location data permanently in Chrome's local storage
4. **Flag Display** shows country flag emojis or location text next to usernames

### API Details

The extension uses X.com's internal GraphQL API:
```
https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery
```

This API is accessed using your existing X.com session cookies (no separate authentication needed).

## Display Logic

- **Country with flag emoji**: Shows the flag (e.g., 🇮🇱 for Israel)
- **Country without flag**: Shows the country name as text
- **No data available**: Shows "N/A"
- **API error**: Shows "N/A" and logs error to console

## Troubleshooting

### Extension Not Working

1. **Check Console**: Open DevTools (F12) and check the Console tab for errors
2. **Verify Installation**: Ensure the extension is enabled in `chrome://extensions/`
3. **Check Permissions**: Make sure the extension has permission to access x.com

### Rate Limiting

If you see rate limit errors in the console:
- The extension will show "N/A" for affected users
- Wait a few minutes before loading more content
- Cached users won't trigger new API calls

### Clearing Cache

To clear the cached location data:
1. Go to `chrome://extensions/`
2. Find "X Geography Filter"
3. Click "Details"
4. Scroll down and click "Clear storage"

## Development

### File Structure

```
geo-filter/
├── manifest.json           # Extension configuration
├── background.js           # Service worker for API calls
├── content.js             # DOM manipulation and user detection
├── utils/
│   └── flags.js           # Country-to-flag mapping
├── styles/
│   └── content.css        # Styling for flag labels
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### Key Components

- **MutationObserver**: Watches for dynamically loaded content
- **Chrome Storage API**: Persistent caching without expiration
- **Chrome Runtime Messaging**: Communication between content script and background worker
- **ISO 3166-1 Standard**: Uses official ISO country codes with programmatic flag emoji generation

### Country Code Mapping

The extension uses a comprehensive ISO 3166-1 alpha-2 country code mapping (249 countries) in `utils/iso-countries.js`. Instead of manually creating flag emojis, it:

1. Maps country names to ISO alpha-2 codes (e.g., "Israel" → "IL")
2. Programmatically generates flag emojis using Unicode Regional Indicator Symbols
3. Each 2-letter country code automatically produces the correct flag emoji

This approach is:
- **Standards-based**: Uses official ISO 3166-1 codes
- **Maintainable**: Only country names need to be added, flags are auto-generated
- **Complete**: Supports all 249 ISO-recognized countries and territories
- **No dependencies**: Embedded data, no build tools or external packages required

## Privacy & Security

- **Local Storage Only**: All data is stored locally in your browser
- **No External Services**: No external servers or third-party services are used
- **Session-Based Authentication**: Uses your existing X.com session cookies
- **Public API Token**: The extension dynamically extracts X.com's public web API bearer token
  - This token is publicly available in X.com's web app JavaScript
  - The extension extracts it from the page on each load
  - If the token cannot be extracted, the extension will fail gracefully with an error
  - No hardcoded tokens - always uses the current token from X.com's own code
- **CSRF Protection**: Extracts and uses your CSRF token from cookies
- **Read-Only**: Extension only reads public profile data, makes no modifications

**Note**: The bearer token is X.com's public API token used by their web application. It's not a secret credential and is safe to commit to a public repository.

## Future Enhancements

Potential features for future versions:
- Filter/hide users by country
- Statistics dashboard
- Custom country lists
- Manual cache management UI
- Export/import cache data

## License

MIT License - Feel free to modify and distribute

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
