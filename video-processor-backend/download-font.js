const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BIN_DIR = path.join(__dirname, 'bin');

if (!fs.existsSync(BIN_DIR)) {
  fs.mkdirSync(BIN_DIR, { recursive: true });
}

try {
  console.log('[Font-Downloader] Downloading Roboto-Bold font for captions...');
  const fontUrl = "https://github.com/googlefonts/roboto/raw/main/src/hinted/Roboto-Bold.ttf";
  execSync(`curl -sL "${fontUrl}" -o "${path.join(BIN_DIR, 'Roboto-Bold.ttf')}"`, { stdio: 'inherit' });
  console.log('[Font-Downloader] Download complete!');
} catch (error) {
  console.error('[Font-Downloader] Failed to download font:', error.message);
}
