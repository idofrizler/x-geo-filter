# Quick Installation Guide

## Step 1: Create Extension Icons

Before loading the extension, you need to create icon files. Here are two quick options:

### Option A: Using Online Tools (Easiest)
1. Go to https://favicon.io/emoji-favicons/
2. Search for "globe" or "flag" emoji
3. Download the generated icons
4. Rename and place them in the `icons/` folder:
   - Rename the 16x16 image to `icon16.png`
   - Rename the 48x48 image to `icon48.png`
   - Rename the 128x128 image to `icon128.png`

### Option B: Using ImageMagick (Command Line)
If you have ImageMagick installed, run these commands from the project root:

```bash
# Create simple colored square icons
convert -size 16x16 xc:#1DA1F2 icons/icon16.png
convert -size 48x48 xc:#1DA1F2 icons/icon48.png
convert -size 128x128 xc:#1DA1F2 icons/icon128.png
```

### Option C: Copy Any PNG Images
Simply copy any three PNG images into the `icons/` folder and rename them to:
- `icon16.png`
- `icon48.png`
- `icon128.png`

## Step 2: Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`

2. Enable **Developer mode** (toggle in top-right corner)

3. Click **"Load unpacked"**

4. Select the `geo-filter` folder (the one containing `manifest.json`)

5. The extension should now appear in your extensions list

## Step 3: Test the Extension

1. Navigate to https://x.com (make sure you're logged in)

2. Open the browser console (F12 or Right-click → Inspect → Console tab)

3. Look for messages like:
   ```
   [Geo Filter] Extension initialized
   [Geo Filter] Found X user elements to process
   ```

4. Scroll through your feed - you should start seeing flags or country names appear next to usernames

## Troubleshooting

### No icons folder?
Create it manually: `mkdir icons` in the project directory

### Extension won't load?
- Make sure you selected the correct folder (should contain `manifest.json`)
- Check for any red error messages in `chrome://extensions/`
- Ensure all files are present (especially `manifest.json`, `background.js`, `content.js`)

### Not seeing flags?
- Open the console (F12) to check for error messages
- Make sure you're logged into X.com
- Try refreshing the page
- The first time you see a username, it needs to fetch data from the API

### Rate limiting errors?
- The extension caches all data, so you'll only see this on first load
- Wait a few minutes and cached users will load instantly
- Future visits will use cached data

## Usage Notes

- **Caching**: Location data is cached permanently until you clear extension storage
- **Privacy**: All data stored locally in your browser only
- **Performance**: First page load may be slower as it fetches data; subsequent loads are instant
- **API Calls**: Only made once per unique username (then cached forever)

## Need Help?

Check the main README.md for more details or open an issue on the project repository.
