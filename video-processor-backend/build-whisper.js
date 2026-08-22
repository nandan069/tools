const shell = require('shelljs');
const path = require('path');
const fs = require('fs');

console.log('[Build-Whisper] Checking if Whisper AI needs to be built...');

const whisperDir = path.join(__dirname, 'node_modules', 'nodejs-whisper', 'cpp', 'whisper.cpp');
if (!fs.existsSync(whisperDir)) {
  console.log('[Build-Whisper] nodejs-whisper not found, skipping.');
  process.exit(0);
}

// Add our local cmake to PATH just in case
process.env.PATH = process.env.PATH + ':' + path.join(__dirname, 'node_modules', '.bin') + ':/opt/homebrew/bin:/usr/local/bin';

const buildDir = path.join(whisperDir, 'build');
// Always do a clean rebuild to ensure the correct CPU flags are used.
if (fs.existsSync(buildDir)) {
  console.log('[Build-Whisper] Removing old build directory for clean rebuild...');
  shell.rm('-rf', buildDir);
}

console.log('[Build-Whisper] Configuring CMake (no AVX512 for cloud compatibility)...');
shell.cd(whisperDir);
// Disable AVX512 variants — Render.com / most cloud VMs don't support them.
// The binary will still use AVX2/FMA which is universally available on modern x86-64.
// VERY IMPORTANT: We must pass -DGGML_NATIVE=OFF so the compiler does NOT use -march=native,
// which would otherwise re-enable AVX512 if the build machine happens to support it.
const configCmd = 'cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_AVX512=OFF -DGGML_AVX512_VBMI=OFF -DGGML_AVX512_VNNI=OFF -DGGML_AVX512_BF16=OFF';
if (shell.exec(configCmd).code !== 0) {
  console.error('[Build-Whisper] CMake configuration failed.');
  process.exit(1);
}

console.log('[Build-Whisper] Building with CMake (this may take a while)...');
const buildCmd = 'cmake --build build --config Release';
if (shell.exec(buildCmd).code !== 0) {
  console.error('[Build-Whisper] Build failed.');
  process.exit(1);
}

console.log('[Build-Whisper] Build successful!');
