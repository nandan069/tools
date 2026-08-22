const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const uuidv4 = () => crypto.randomUUID();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { processingQueue } = require('./queue');
const { cancelProcessing } = require('./processor');

const router = express.Router();

// Use local disk instead of /tmp (which is mapped to RAM in Render Free Tier)
const TMP_DIR = path.join(__dirname, 'disk_tmp');
const UPLOADS_DIR = path.join(TMP_DIR, 'meta-remover-uploads');
const OUTPUTS_DIR = path.join(TMP_DIR, 'meta-remover-outputs');

// Create directories if they don't exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

console.log('[Routes] Upload dir:', UPLOADS_DIR);
console.log('[Routes] Output dir:', OUTPUTS_DIR);

// Multer configuration using /tmp
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Secure UUID filename — prevents path traversal
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  }
});

// Accept any file field for dynamic overlays
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB limit (free tier safe)
}).any();

// Upload endpoint
router.post('/upload', upload, async (req, res) => {
  const filesArray = req.files || [];
  const files = {};
  filesArray.forEach(f => {
    if (!files[f.fieldname]) files[f.fieldname] = [];
    files[f.fieldname].push(f);
  });

  if (!files.file || files.file.length === 0) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const videoFile = files.file[0];
  const audioFile = files.audio ? files.audio[0] : null;
  const splitOverlayVideoFile = files.splitOverlayVideo ? files.splitOverlayVideo[0] : null;

  const jobId = uuidv4();
  const inputPath = videoFile.path;

  // Always output as mp4 for transform mode (re-encode), preserve original ext for metadata mode if valid
  const mode = (req.body.mode || 'metadata').trim();
  const rawExt = path.extname(videoFile.originalname).toLowerCase();
  
  // Strict whitelist of safe extensions to prevent ffmpeg from misinterpreting the output format
  // or crashing with "Error opening output file part." on files like "video.part"
  const SAFE_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv', '.3gp', '.jpg', '.jpeg']);
  const originalExt = SAFE_EXTS.has(rawExt) ? rawExt : '.mp4';
  
  const outputExt = mode === 'transform' ? '.mp4' : originalExt;
  const outputPath = path.join(OUTPUTS_DIR, `${jobId}${outputExt}`);

  console.log(`[Routes] Job ${jobId} mode="${mode}": ${videoFile.mimetype} → ${outputPath}`);

  // Parse custom metadata fields (used by both modes)
  const customMeta = {
    title:        (req.body.title        || '').trim(),
    author:       (req.body.author       || '').trim(),
    comment:      (req.body.comment      || '').trim(),
    copyright:    (req.body.copyright    || '').trim(),
    creationTime: (req.body.creationTime || '').trim(),
  };

  // Parse transform options (only used in transform mode)
  const transformOptions = {
    // Inherit metadata
    ...customMeta,

    // Trim
    trimStart:   req.body.trimStart   != null && req.body.trimStart   !== '' ? parseFloat(req.body.trimStart)   : null,
    trimEnd:     req.body.trimEnd     != null && req.body.trimEnd     !== '' ? parseFloat(req.body.trimEnd)     : null,

    // Crop
    cropEnabled: req.body.cropEnabled === 'true',
    cropWidth:   parseInt(req.body.cropWidth, 10) || null,
    cropHeight:  parseInt(req.body.cropHeight, 10) || null,
    cropX:       parseInt(req.body.cropX, 10) || 0,
    cropY:       parseInt(req.body.cropY, 10) || 0,

    // Watermark
    watermarkEnabled: req.body.watermarkEnabled === 'true',
    watermarkWidth:   parseInt(req.body.watermarkWidth, 10) || null,
    watermarkHeight:  parseInt(req.body.watermarkHeight, 10) || null,
    watermarkX:       parseInt(req.body.watermarkX, 10) || 0,
    watermarkY:       parseInt(req.body.watermarkY, 10) || 0,

    // Speed
    speed:       parseFloat(req.body.speed || '1.0'),

    // Color
    colorPreset: (req.body.colorPreset || 'none').trim(),
    saturation:  parseFloat(req.body.saturation  || '1.0'),
    brightness:  parseFloat(req.body.brightness  || '0.0'),
    contrast:    parseFloat(req.body.contrast    || '1.0'),

    // Captions
    captionText:     (req.body.captionText     || '').trim(),
    captionPosition: (req.body.captionPosition || 'bottom').trim(),
    captionSize:     parseInt(req.body.captionSize || '36', 10),
    captionColor:    (req.body.captionColor    || 'white').trim(),

    // Auto Subtitles (AI)
    autoSubtitles:   req.body.autoSubtitles === 'true',

    // Audio
    audioMode:   (req.body.audioMode   || 'keep').trim(),
    audioVolume: parseFloat(req.body.audioVolume || '0.3'),
    audioPath:   audioFile ? audioFile.path : null,

    // ── Feature 1: Mirror ──────────────────────────────────────────────────
    mirrorEnabled: req.body.mirrorEnabled === 'true',

    // ── Feature 2: Split-Screen Underlay ───────────────────────────────────
    splitScreenEnabled: req.body.splitScreenEnabled === 'true',
    splitDirection:     (req.body.splitDirection || 'vertical').trim(),
    splitOverlayVideoPath: splitOverlayVideoFile ? splitOverlayVideoFile.path : null,



    // AI Tracker Feature
    aiTrackerEnabled: req.body.aiTrackerEnabled === 'true',
    trackedObjects: (() => {
      if (req.body.aiTrackerEnabled === 'true' && req.body.trackedObjects) {
        try { return JSON.parse(req.body.trackedObjects); } catch (e) { console.error("Failed to parse trackedObjects:", e); }
      }
      return [];
    })(),

    // ── Feature 3: Border / Padding ────────────────────────────────────────
    borderEnabled: req.body.borderEnabled === 'true',
    borderPadding: parseFloat(req.body.borderPadding || '10'),
    borderColor:   (req.body.borderColor || 'black').trim(),

    // ── Feature 4: Pitch Shift (audio) ─────────────────────────────────────
    pitchShiftEnabled:   req.body.pitchShiftEnabled === 'true',
    pitchShiftSemitones: parseFloat(req.body.pitchShiftSemitones || '0'),

    // ── Feature 5: Film Grain ──────────────────────────────────────────────
    grainEnabled:   req.body.grainEnabled === 'true',
    grainIntensity: parseInt(req.body.grainIntensity || '20', 10),

    // ── Feature 6: Dynamic Zoom ────────────────────────────────────────────
    zoomEnabled:   req.body.zoomEnabled === 'true',
    zoomDirection: (req.body.zoomDirection || 'zoom-in').trim(),
    zoomIntensity: (req.body.zoomIntensity || 'subtle').trim(),

    // ── Feature 7: FPS Conversion ──────────────────────────────────────────
    fpsEnabled: req.body.fpsEnabled === 'true',
    targetFps:  parseInt(req.body.targetFps || '30', 10),

    // ── Feature 8: Face / Privacy Blur ─────────────────────────────────────
    faceBlurEnabled:   req.body.faceBlurEnabled === 'true',
    faceBlurStrength:  parseInt(req.body.faceBlurStrength || '3', 10),

    // ── New Feature 9: Hue Rotation ───────────────────────────────────────
    hueEnabled:  req.body.hueEnabled === 'true',
    hueDegrees:  parseFloat(req.body.hueDegrees || '10'),

    // ── New Feature 10: Micro-Tilt Rotation ───────────────────────────────
    tiltEnabled:  req.body.tiltEnabled === 'true',
    tiltAngle:    parseFloat(req.body.tiltAngle || '1.0'),

    // ── New Feature 11: Audio Noise Floor ─────────────────────────────────
    noiseFloorEnabled:  req.body.noiseFloorEnabled === 'true',
    noiseFloorDb:       parseFloat(req.body.noiseFloorDb || '-38'),

    // ── New Feature 12: Temporal Frame Jitter ─────────────────────────────
    frameJitterEnabled:   req.body.frameJitterEnabled === 'true',
    frameJitterFrames:    parseInt(req.body.frameJitterFrames || '2', 10),

    // ── New Feature 13: Variable Speed Ramp ───────────────────────────────
    speedRampEnabled: req.body.speedRampEnabled === 'true',
    speedRampCurve:   (req.body.speedRampCurve || 'wave').trim(),

    // ── New Feature 14: Audio EQ Shift ────────────────────────────────────
    audioEqEnabled:   req.body.audioEqEnabled === 'true',
    audioEqPreset:    (req.body.audioEqPreset || 'cut-low').trim(),

    // ── New Feature 15: Vertical Crop Reframe ─────────────────────────────
    vCropEnabled: req.body.vCropEnabled === 'true',
    vCropPercent: parseFloat(req.body.vCropPercent || '3'),
    vCropAxis:    (req.body.vCropAxis || 'vertical').trim(),

    // ── New Feature 16: Thumbnail Randomizer ──────────────────────────────
    thumbRandomEnabled:  req.body.thumbRandomEnabled === 'true',
    thumbIntroSeconds:   parseFloat(req.body.thumbIntroSeconds || '0.5'),

    // ── New Feature 17: Container Re-Mux ──────────────────────────────────
    remuxEnabled:     req.body.remuxEnabled === 'true',
    remuxFormat:      (req.body.remuxFormat || 'mkv').trim(),

    // ── Interactive Overlays ──────────────────────────────────────────────
    overlaysEnabled: req.body.overlaysEnabled === 'true',
    overlaysData: (() => {
      if (req.body.overlaysEnabled === 'true' && req.body.overlaysData) {
        try { 
           const parsed = JSON.parse(req.body.overlaysData); 
           // Attach file paths for images
           return parsed.map(o => {
              if (o.type === 'image' && files[`overlayImage_${o.id}`]) {
                 o.filePath = files[`overlayImage_${o.id}`][0].path;
              }
              return o;
           });
        } catch (e) { console.error("Failed to parse overlaysData:", e); }
      }
      return [];
    })(),

    // ── Feature 20: Magnifying Glass ──────────────────────────────────────
    magnifyEnabled: req.body.magnifyEnabled === 'true',
    magnifyCrop: req.body.magnifyCropX !== undefined ? {
      x: parseInt(req.body.magnifyCropX),
      y: parseInt(req.body.magnifyCropY),
      w: parseInt(req.body.magnifyCropW),
      h: parseInt(req.body.magnifyCropH)
    } : null,
    magnifyZoom: parseFloat(req.body.magnifyZoom) || 2.0,
    magnifyBlur: parseInt(req.body.magnifyBlur) || 20,
    magnifyStart: parseFloat(req.body.magnifyStart) || 0,
    magnifyEnd: parseFloat(req.body.magnifyEnd) || null,
  };

  // Output name: respect remux format if enabled, otherwise always .mp4 for transform
  const downloadExt = mode === 'transform' && transformOptions.remuxEnabled
    ? '.' + transformOptions.remuxFormat.replace(/^\./, '')
    : '.mp4';
  const outputOriginalName = mode === 'transform'
    ? path.basename(videoFile.originalname, originalExt) + '_transformed' + downloadExt
    : videoFile.originalname;

  const jobData = {
    id: jobId,
    inputPath,
    outputPath,
    mimeType: videoFile.mimetype,
    originalName: outputOriginalName,
    customMeta,
    transformOptions,
    mode,
  };

  // Add job to BullMQ
  await processingQueue.add('video-process', jobData, { jobId });

  res.status(202).json({ jobId, message: 'File queued for processing' });
});

// Status endpoint
router.get('/status/:id', async (req, res) => {
  const jobId = req.params.id;
  try {
    const job = await processingQueue.getJob(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const state = await job.getState();
    const progress = job.progress || 0;
    
    let status = 'queued';
    let position = 0;
    if (state === 'active') status = 'processing';
    if (state === 'completed') status = 'completed';
    if (state === 'failed') status = 'failed';
    
    // Calculate position in queue if waiting
    if (state === 'waiting' || state === 'delayed') {
      const waitingJobs = await processingQueue.getWaiting();
      position = waitingJobs.findIndex(j => j.id === jobId) + 1;
    }
    
    res.json({
      status,
      position,
      progress,
      result: job.returnvalue ? job.returnvalue.outputPath : null,
      originalName: job.returnvalue ? job.returnvalue.originalName : null,
      error: job.failedReason
    });
  } catch (error) {
    console.error(`[Routes] Error fetching job status:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Download endpoint
router.get('/download/:id', async (req, res) => {
  const jobId = req.params.id;
  
  try {
    const job = await processingQueue.getJob(jobId);
    if (!job || await job.getState() !== 'completed') {
      return res.status(400).json({ error: 'File not ready or job failed' });
    }

    const filePath = job.returnvalue.outputPath;
    const originalName = job.returnvalue.originalName || 'processed_file';

    console.log(`[Routes] Download requested: ${filePath}`);

    if (!fs.existsSync(filePath)) {
      console.error(`[Routes] File missing: ${filePath}`);
      return res.status(404).json({ error: 'File not found on server. Please re-upload and try again.' });
    }

    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath);
    const mimeTypes = {
      '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
      '.mkv': 'video/x-matroska', '.webm': 'video/webm', '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    const contentType = mimeTypes[ext.toLowerCase()] || 'application/octet-stream';

    // Set headers explicitly — required for cross-origin fetch() downloads
    res.set({
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`,
      'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length',
    });

    // Stream the file to avoid loading the entire thing into memory
    const stream = fs.createReadStream(filePath);

    stream.on('error', (err) => {
      console.error('[Routes] Stream error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading file' });
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error(`[Routes] Error downloading file:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Cancel job endpoint
router.post('/cancel/:id', async (req, res) => {
  const jobId = req.params.id;
  try {
    const job = await processingQueue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'active') {
        // Try to forcibly kill the FFmpeg process running this job
        cancelProcessing(jobId);
      }
      
      // Attempt to remove it from the queue if it's waiting or delayed
      try {
        await job.remove();
      } catch (err) {
        // Job might be active and lock prevents removal, that's fine since we killed the process.
      }
    } else {
      // Even if the job isn't in BullMQ, try to kill it just in case
      cancelProcessing(jobId);
    }
    res.json({ message: 'Cancellation requested' });
  } catch (error) {
    console.error(`[Routes] Error cancelling job:`, error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
