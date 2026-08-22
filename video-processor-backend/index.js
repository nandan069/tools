require('dotenv').config(); // Load .env for local dev (no-op on Render — env vars are set in dashboard)

// Ensure common Homebrew paths and local node_modules/.bin are in PATH so child processes like nodejs-whisper can find cmake
const path = require('path');
process.env.PATH = process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin:' + path.join(__dirname, 'node_modules', '.bin');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const cron = require('node-cron');

const router = require('./routes');

// Global crash protection
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION — Server crashed]', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION — Server crashed]', reason);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Required when running behind Nginx reverse proxy
// Setting it to 1 is appropriate for a standard Nginx reverse proxy
app.set('trust proxy', 1);

// Directories are now managed via /tmp in routes.js

// Security headers (helmet must come before CORS and routes)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // allow file downloads from different origins
  contentSecurityPolicy: false, // disabled — API-only server, no HTML served
}));

// CORS — must come before routes
const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin, optionsSuccessStatus: 200 }));

// Rate Limiting (DOS protection)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // Max 15 video processing requests per IP to prevent /tmp disk exhaustion
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/upload', limiter);

// Routes
app.use('/api', router);

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Meta Data Remover API is running' });
});

// Centralized Error Handling
app.use((err, req, res, next) => {
  console.error('[Error]', err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// Start Background Cleanup Task
const os = require('os');
const TMP_DIR = path.join(__dirname, 'disk_tmp');
const UPLOADS_DIR = path.join(TMP_DIR, 'meta-remover-uploads');
const OUTPUTS_DIR = path.join(TMP_DIR, 'meta-remover-outputs');

function cleanupOldFiles() {
  const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  
  [UPLOADS_DIR, OUTPUTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdir(dir, (err, files) => {
      if (err) return console.error(`[Cleanup] Error reading ${dir}:`, err);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        fs.stat(filePath, (err, stats) => {
          if (err) return;
          if (now - stats.mtimeMs > MAX_AGE) {
            fs.unlink(filePath, err => {
              if (!err) console.log(`[Cleanup] Deleted old file (24h+): ${filePath}`);
            });
          }
        });
      });
    });
  });
}
// Run cleanup every hour at the top of the hour
cron.schedule('0 * * * *', cleanupOldFiles);
cleanupOldFiles(); // Run once on startup

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Fix "failed to fetch" on slow uploads: 
// Node's default timeout will drop connections if an upload takes too long.
// Increase timeout to 30 minutes to allow slow connections to finish uploading large videos.
server.timeout = 30 * 60 * 1000;
server.keepAliveTimeout = 30 * 60 * 1000;
server.headersTimeout = 31 * 60 * 1000;
