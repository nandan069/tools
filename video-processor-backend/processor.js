const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { nodewhisper } = require('nodejs-whisper');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('./ffmpeg-path');
const ffprobeStaticPath = require('./ffprobe-path');

// ---------------------------------------------------------------------------
// Active Jobs tracking (for cancellation)
// ---------------------------------------------------------------------------
const activeJobs = new Map();

function cancelProcessing(jobId) {
  const p = activeJobs.get(jobId);
  if (p) {
    console.log(`[Processor] Forcibly killing active job: ${jobId}`);
    try { p.kill('SIGKILL'); } catch (err) { console.error('Error killing process:', err); }
    activeJobs.delete(jobId);
    return true;
  }
  return false;
}

// Point fluent-ffmpeg to the custom bundled binary if available, or static fallback
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStaticPath);

// ---------------------------------------------------------------------------
// Hardware encoder detection — runs ONCE at startup, result cached as a Promise.
// Subsequent callers await the same Promise (no extra spawns).
// ---------------------------------------------------------------------------
const hwEncoderCache = new Promise((resolve) => {
  execFile(ffmpegStatic, ['-encoders', '-hide_banner'], (err, stdout) => {
    if (err) return resolve({ nvenc: false, vaapi: false });
    resolve({
      nvenc: /h264_nvenc/.test(stdout),
      vaapi: /h264_vaapi/.test(stdout),
    });
  });
});

const filterCache = new Promise((resolve) => {
  execFile(ffmpegStatic, ['-filters', '-hide_banner'], (err, stdout) => {
    if (err) return resolve({ drawtext: false });
    resolve({
      drawtext: /drawtext/.test(stdout),
    });
  });
});
// Kick off detection immediately (so it's warm before the first job arrives)
hwEncoderCache.then((hw) => {
  if (hw.nvenc)  console.log('[Processor] Detected GPU encoder: h264_nvenc');
  else if (hw.vaapi) console.log('[Processor] Detected GPU encoder: h264_vaapi');
  else           console.log('[Processor] No GPU encoder found — using libx264 ultrafast');
});

// ---------------------------------------------------------------------------
// Shared helpers: build metadata arg pairs + apply them safely to fluent-ffmpeg.
// ---------------------------------------------------------------------------
// buildMetaArgs returns an array of ['-metadata', 'key=value'] pairs.
// Callers must use applyMetaArgs() — NOT .outputOptions(flat array) — because
// fluent-ffmpeg's .outputOptions(array) auto-splits any element that contains
// exactly ONE space (line 113-116 of fluent-ffmpeg/lib/options/custom.js):
//
//   var split = String(option).split(' ');
//   if (doSplit && split.length === 2) options.push(split[0], split[1]);
//
// This means `title=1sst part` gets split into ['title=1sst', 'part'], where
// 'part' is then treated by FFmpeg as an output file path → exit code 234.
// Calling .outputOptions('-metadata', 'key=value') with TWO arguments sets
// doSplit=false, bypassing the split entirely.
function buildMetaArgs(meta = {}) {
  const {
    title = '',
    author = '',
    comment = '',
    copyright = '',
    creationTime = '',
  } = meta;

  let isoTime = '';
  if (creationTime) {
    try { isoTime = new Date(creationTime).toISOString(); } catch { /* ignore bad dates */ }
  }

  // Returns nested pairs: [['-metadata', 'title=…'], ['-metadata', 'artist=…'], …]
  return [
    ['-metadata', `title=${title}`],
    ['-metadata', `artist=${author}`],
    ['-metadata', `author=${author}`],
    ['-metadata', `album_artist=${author}`],
    ['-metadata', `comment=${comment}`],
    ['-metadata', `copyright=${copyright}`],
    ['-metadata', 'description='],
    ['-metadata', 'synopsis='],
    ['-metadata', 'show='],
    ['-metadata', 'episode_id='],
    ['-metadata', 'network='],
    ['-metadata', 'lyrics='],
    ['-metadata', 'encoder='],
    ['-metadata', 'encoded_by='],
    ['-metadata', 'album='],
    ['-metadata', 'genre='],
    ['-metadata', 'composer='],
    ['-metadata', 'performer='],
    ['-metadata', 'disc='],
    ['-metadata', 'track='],
    ['-metadata', 'make='],
    ['-metadata', 'model='],
    ['-metadata', 'software='],
    ['-metadata', 'firmware='],
    ['-metadata', 'camera_make='],
    ['-metadata', 'camera_model='],
    ['-metadata', 'location='],
    ['-metadata', 'location-eng='],
    ['-metadata', 'com.apple.quicktime.location.accuracy.horizontal='],
    ['-metadata', 'com.apple.quicktime.make='],
    ['-metadata', 'com.apple.quicktime.model='],
    ['-metadata', 'com.apple.quicktime.software='],
    ['-metadata', 'com.apple.quicktime.creationdate='],
    ['-metadata', `creation_time=${isoTime}`],
  ];
}

// Apply metadata pairs to a fluent-ffmpeg command.
// Each pair is passed as two separate arguments → doSplit=false in fluent-ffmpeg.
function applyMetaArgs(cmd, metaArgs) {
  for (const [flag, value] of metaArgs) {
    cmd.outputOptions(flag, value);
  }
  return cmd;
}

// ---------------------------------------------------------------------------
// JPEG metadata stripping (binary manipulation — fully async, non-blocking)
// ---------------------------------------------------------------------------
async function stripJpegMetadata(inputPath, outputPath) {
  // Fix: use async fs to avoid blocking the Node.js event loop
  const data = await fs.promises.readFile(inputPath);

  if (data[0] !== 0xFF || data[1] !== 0xD8) {
    await fs.promises.copyFile(inputPath, outputPath);
    return;
  }

  const chunks = [Buffer.from([0xFF, 0xD8])];
  let i = 2;

  while (i < data.length) {
    if (data[i] !== 0xFF) break;
    const marker = data[i + 1];
    const isMetadataSegment = marker >= 0xE1 && marker <= 0xEF;

    if (isMetadataSegment) {
      const segmentLength = (data[i + 2] << 8) | data[i + 3];
      i += 2 + segmentLength;
    } else if (marker === 0xDA) {
      chunks.push(data.slice(i));
      break;
    } else {
      const segmentLength = marker === 0xD9 ? 0 : (data[i + 2] << 8) | data[i + 3];
      chunks.push(data.slice(i, i + 2 + segmentLength));
      i += 2 + segmentLength;
    }
  }

  await fs.promises.writeFile(outputPath, Buffer.concat(chunks));
  console.log(`[Processor] JPEG metadata stripped: ${path.basename(outputPath)}`);
}

// ---------------------------------------------------------------------------
// VIDEO metadata replacement via FFmpeg — FAST stream-copy mode
//
// Apple MOV files (iPhone etc.) contain MULTIPLE embedded metadata tracks:
//   - Standard QuickTime udta box  → removed by -map_metadata -1
//   - Apple mebx tracks (stream type 'data') → MUST be dropped via -map 0:v -map 0:a
//     These carry: camera model, GPS, lens info, iPhone maker notes, etc.
//
// This function:
//   1. Strips ALL original metadata (-map_metadata -1)
//   2. Explicitly selects ONLY video + audio streams, dropping all data/mebx tracks
//   3. Injects clean user-supplied metadata fields
//   4. Stream-copies (no re-encoding) → fast, zero quality loss
// ---------------------------------------------------------------------------
// Map output extension to an explicit FFmpeg format name.
// This prevents FFmpeg from guessing the muxer from the INPUT file extension
// (e.g. uuid.part triggering the 'part' pseudo-muxer and crashing).
const EXT_TO_FORMAT = {
  '.mp4': 'mp4', '.m4v': 'mp4', '.mov': 'mov', '.avi': 'avi',
  '.mkv': 'matroska', '.webm': 'webm', '.flv': 'flv', '.wmv': 'asf',
  '.3gp': '3gp',
};

function replaceVideoMetadata(jobId, inputPath, outputPath, customMeta, updateProgress, outputExt) {
  return new Promise((resolve, reject) => {
    const useFaststart = outputExt === '.mp4' || outputExt === '.m4v';
    const metaArgs = buildMetaArgs(customMeta);
    let lastProgress = 0;

    const cmd = ffmpeg(inputPath)
      .outputOptions('-map_metadata', '-1')
      .outputOptions('-map', '0:v?', '-map', '0:a?')
      .outputOptions('-dn')
      .outputOptions('-max_muxing_queue_size', '9999');

    // Apply metadata pairs safely (no auto-split on spaces)
    applyMetaArgs(cmd, metaArgs);

    cmd
      .videoCodec('copy')
      .audioCodec('copy');

    // Explicitly declare output format — prevents FFmpeg from guessing muxer
    // from the input extension (e.g. .part files triggering the wrong muxer)
    const fmt = EXT_TO_FORMAT[outputExt];
    if (fmt) cmd.outputOptions('-f', fmt);

    if (useFaststart) cmd.outputOptions('-movflags', '+faststart');

    cmd
      .output(outputPath)
      .on('start', (c) => {
        console.log('[Processor] FFmpeg metadata command:', c);
        if (updateProgress) updateProgress(5);
      })
      .on('progress', (info) => {
        const pct = Math.min(Math.round(info.percent || 0), 95);
        if (pct > lastProgress) {
          lastProgress = pct;
          if (updateProgress) updateProgress(pct);
        }
      })
      .on('end', () => {
        if (jobId) activeJobs.delete(jobId);
        console.log(`[Processor] Video metadata replaced: ${path.basename(outputPath)}`);
        if (updateProgress) updateProgress(100);
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (jobId) activeJobs.delete(jobId);
        console.error('[Processor] FFmpeg error:', err.message);
        reject(err);
      });

    if (jobId) activeJobs.set(jobId, cmd);
    cmd.run();
  });
}

// ---------------------------------------------------------------------------
// VIDEO TRANSFORM — Full re-encode with all transformations
//
// Applies in order:
//   1. Trim (start/end)
//   2. Dimension changes (cinematic bars, vertical, crop)
//   3. Speed adjustment (setpts + atempo)
//   4. Color grading (eq filter)
//   5. Caption burn-in (drawtext)
//   6. Audio mixing (amix with optional external audio)
//   7. Metadata scrub (always, same as metadata mode)
// ---------------------------------------------------------------------------
const util = require('util');
const ffprobeAsync = util.promisify(ffmpeg.ffprobe);

async function transformVideo(jobId, inputPath, outputPath, options, updateProgress, cachedProbe) {
  // Fix: reuse the ffprobe result from processFile — no second probe spawn
  let hasOriginalVideo = true;
  let hasOriginalAudio = true;
  let videoWidth = 0;
  let videoHeight = 0;
  let videoDuration = 10;
  try {
    const probe = cachedProbe || (await ffprobeAsync(inputPath));
    if (probe && probe.streams) {
      hasOriginalVideo = probe.streams.some(s => s.codec_type === 'video');
      hasOriginalAudio = probe.streams.some(s => s.codec_type === 'audio');
      const vStream = probe.streams.find(s => s.codec_type === 'video');
      if (vStream) { videoWidth = vStream.width || 0; videoHeight = vStream.height || 0; }
      if (probe.format && probe.format.duration) {
        videoDuration = parseFloat(probe.format.duration);
      }
    }
  } catch (e) {
    console.warn('[Processor] ffprobe failed, assuming both streams exist:', e.message);
  }

  // Fix: resolve hardware encoder BEFORE entering the Promise, so the Promise
  // callback is fully synchronous (avoids the `new Promise(async ...)` anti-pattern)
  const hw = process.platform !== 'darwin' ? await hwEncoderCache : { nvenc: false, vaapi: false };
  const filters = await filterCache;

  const outputExt = path.extname(outputPath).toLowerCase();
  const useFaststart = outputExt === '.mp4' || outputExt === '.m4v';

  // Extract autoSubtitles outside the promise so we can await properly
  const autoSubtitles = options.autoSubtitles === 'true' || options.autoSubtitles === true;
  let generatedSrtPath = null;
  if (autoSubtitles && hasOriginalVideo) {
    if (updateProgress) updateProgress(1); // Indicate that we are processing AI

    console.log(`[Processor] Auto-Subtitles requested. Extracting audio from ${inputPath}`);
    const audioTempPath = path.join(path.dirname(outputPath), `${path.basename(outputPath, outputExt)}_temp_audio.wav`);
    
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpegStatic, [
        '-i', inputPath,
        '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        audioTempPath,
        '-y'
      ]);
      if (jobId) activeJobs.set(jobId, p);

      p.on('close', code => {
        if (jobId) activeJobs.delete(jobId);
        if (code === 0) resolve();
        else reject(new Error('Audio extraction failed'));
      });
    });

    console.log(`[Processor] Audio extracted to ${audioTempPath}. Running Whisper AI (this may take a while)...`);
    try {
      await nodewhisper(audioTempPath, {
        modelName: 'base',
        autoDownloadModelName: 'base',
        whisperOptions: {
          language: 'auto',
          translateToEnglish: true,
          outputInSrt: true
        }
      });
      generatedSrtPath = audioTempPath + '.srt';
      if (updateProgress) updateProgress(5); // Whisper finished, move progress forward
      console.log(`[Processor] Whisper AI finished. SRT generated at ${generatedSrtPath}`);
    } catch (err) {
      console.error(`[Processor] Whisper error:`, err);
      throw new Error('Auto-subtitles generation failed. The AI model encountered an error analyzing the audio. Ensure the video contains clear audio or try another clip.');
    }
  }

  // ── AI Tracker Execution (V2.2 Manifest-driven) ──────────────────────
  const aiTrackerEnabled = options.aiTrackerEnabled === 'true' || options.aiTrackerEnabled === true;
  const trackedObjects = options.trackedObjects || [];
  const aiTrackerAssPaths = [];
  
  if (aiTrackerEnabled && trackedObjects.length > 0 && hasOriginalVideo) {
    if (updateProgress) updateProgress(10);
    console.log(`[Processor] Running V2.2 AI Object Tracker Pipeline...`);
    const crypto = require('crypto');
    const jobIdDir = path.join(__dirname, 'disk_tmp', `tracking-v2-${crypto.randomUUID()}`);
    fs.mkdirSync(jobIdDir, { recursive: true });
    
    // 1. Build the manifest
    const manifestPath = path.join(jobIdDir, 'manifest.json');
    const manifest = {
      schema: "tracking-v2.2",
      features: {
          multiTracking: true,
          detector: false,
          kalman: false,
          gpu: false,
          parallelRenderer: false,
          debug: true
      },
      config: {
          video: inputPath,
          trackers: [],
          layers: []
      },
      runtime: {
          status: {},
          statistics: {},
          artifacts: {},
          events: [],
          progress: {}
      }
    };
    
    for (let i = 0; i < trackedObjects.length; i++) {
        const obj = trackedObjects[i];
        const targetId = `target_${i.toString().padStart(3, '0')}`;
        const layerId = `layer_${i.toString().padStart(3, '0')}`;
        
        // ReactCrop sends pixel coords, but we need percentages for V2 config.
        // Wait, earlier we sent bounding boxes. Let's see how they are structured.
        // Assuming [x, y, w, h] as percentages directly if passed from frontend properly.
        // If they are pixels, Python needs to know. For safety, we pass the raw bbox
        // array to bbox_percent as our frontend sends percentages out of 100.
        manifest.config.trackers.push({
            id: targetId,
            profile: obj.trackerProfile || 'BALANCED',
            start_time: obj.timestamp || 0,
            end_time: 999999.0, // track until end for now
            bbox_percent: obj.bbox // Expected to be [x,y,w,h] in % (0-100)
        });
        
        manifest.config.layers.push({
            id: layerId,
            target_id: targetId,
            type: obj.overlay || 'circle',
            color: obj.shape_color || 'red',
            size: obj.size || 50
        });
    }
    
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    
    // 2. Execute Python Pipeline
    console.log(`[Processor] Spawning Python TrackingEngine...`);
    await new Promise((resolve, reject) => {
        const p = spawn('python3', [ 
          '-m', 'tracking',
          '--manifest', manifestPath,
          '--render-all'
        ], { cwd: __dirname });
        
        // Capture stdout for progress
        p.stdout.on('data', (data) => {
            console.log(`[Python Tracker] ${data.toString().trim()}`);
        });
        
        p.stderr.on('data', (data) => {
            console.error(`[Python Tracker ERR] ${data.toString().trim()}`);
        });
        
        if (jobId) activeJobs.set(`${jobId}-tracking`, p);
        
        p.on('close', code => {
            if (jobId) activeJobs.delete(`${jobId}-tracking`);
            if (code === 0) resolve();
            else reject(new Error('AI Object Tracking failed. The tracking pipeline crashed while analyzing the video. Ensure the video is not corrupted and try a different frame range.'));
        });
    });
    
    // 3. Read output manifest to collect artifacts
    const outputManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const artifacts = outputManifest.runtime.artifacts || {};
    const assFiles = artifacts.ass || [];
    
    for (const assName of assFiles) {
        const fullPath = path.join(jobIdDir, assName);
        if (fs.existsSync(fullPath)) {
            aiTrackerAssPaths.push(fullPath);
        }
    }
    
    if (updateProgress) updateProgress(20);
    console.log(`[Processor] AI Tracker finished. Found ${aiTrackerAssPaths.length} overlay layers.`);
  }

  return new Promise((resolve, reject) => {
    const {
      // Trim
      trimStart = null,
      trimEnd = null,
      // Crop
      cropEnabled = false,
      cropWidth = null,
      cropHeight = null,
      cropX = 0,
      cropY = 0,
      // Watermark
      watermarkEnabled = false,
      watermarkWidth = null,
      watermarkHeight = null,
      watermarkX = 0,
      watermarkY = 0,
      // Speed
      speed = 1.0,
      // Color grading
      colorPreset = 'none',
      saturation = 1.0,
      brightness = 0.0,
      contrast = 1.0,
      // Captions
      captionText = '',
      captionPosition = 'bottom',
      captionSize = 36,
      captionColor = 'white',
      // Auto Subtitles
      autoSubtitles = false,
      // Audio
      audioMode: rawAudioMode = 'keep',
      audioVolume = 0.3,
      // ── Feature 1: Mirror ──────────────────────────────────────────────────
      mirrorEnabled = false,
      // ── Feature 2: Split-Screen ────────────────────────────────────────────
      splitScreenEnabled = false,
      splitDirection = 'vertical',
      // ── Feature 3: Border / Padding ────────────────────────────────────────
      borderEnabled = false,
      borderPadding = 10,
      borderColor = 'black',
      // ── Feature 4: Pitch Shift ─────────────────────────────────────────────
      pitchShiftEnabled = false,
      pitchShiftSemitones = 0,
      // ── Feature 5: Film Grain ──────────────────────────────────────────────
      grainEnabled = false,
      grainIntensity = 20,
      // ── Feature 6: Dynamic Zoom ────────────────────────────────────────────
      zoomEnabled = false,
      zoomDirection = 'zoom-in',
      zoomIntensity = 'subtle',
      // ── Feature 7: FPS Conversion ──────────────────────────────────────────
      fpsEnabled = false,
      targetFps = 30,
      // ── Feature 8: Face / Privacy Blur ─────────────────────────────────────
      faceBlurEnabled = false,
      faceBlurStrength = 3,
      // ── New Feature 9: Hue Rotation ────────────────────────────────────────
      hueEnabled  = false,
      hueDegrees  = 10,
      // ── New Feature 10: Micro-Tilt Rotation ────────────────────────────────
      tiltEnabled  = false,
      tiltAngle    = 1.0,
      // ── New Feature 11: Audio Noise Floor ──────────────────────────────────
      noiseFloorEnabled = false,
      noiseFloorDb      = -38,
      // ── New Feature 12: Temporal Frame Jitter ──────────────────────────────
      frameJitterEnabled = false,
      frameJitterFrames  = 2,
      // ── New Feature 13: Variable Speed Ramp ────────────────────────────────
      speedRampEnabled = false,
      speedRampCurve   = 'wave',
      // ── New Feature 14: Audio EQ Shift ─────────────────────────────────────
      audioEqEnabled = false,
      audioEqPreset  = 'cut-low',
      // ── New Feature 15: Vertical Crop Reframe ──────────────────────────────
      vCropEnabled = false,
      vCropPercent = 3,
      vCropAxis    = 'vertical',
      // ── New Feature 16: Thumbnail Randomizer ───────────────────────────────
      thumbRandomEnabled = false,
      thumbIntroSeconds  = 0.5,
      // ── New Feature 17: Container Re-Mux ───────────────────────────────────
      remuxEnabled = false,
      remuxFormat  = 'mkv',

      // ── Feature 20: Magnifying Glass ───────────────────────────────────────
      magnifyEnabled = false,
      magnifyCrop = null,
      magnifyZoom = 2.0,
      magnifyBlur = 20,
      magnifyStart = 0,
      magnifyEnd = null,

      splitOverlayVideoPath = null,
    } = options || {};

    let audioMode = rawAudioMode;
    if (audioMode === 'mix' && !hasOriginalAudio) {
      console.log('[Processor] Original video has no audio stream, falling back mix → replace');
      audioMode = 'replace';
    }

    const hasExternalAudio = options && options.audioPath && fs.existsSync(options.audioPath);
    const safeSpeed = Math.min(Math.max(parseFloat(speed) || 1.0, 0.5), 2.0);
    const safeSaturation = Math.min(Math.max(parseFloat(saturation) || 1.0, 0.0), 3.0);
    const safeBrightness = Math.min(Math.max(parseFloat(brightness) || 0.0, -1.0), 1.0);
    const safeContrast = Math.min(Math.max(parseFloat(contrast) || 1.0, 0.0), 2.0);

    // ── Determine if video re-encoding is strictly necessary ───────────────
    const needsCrop = cropEnabled && cropWidth > 0 && cropHeight > 0;
    const needsWatermark = watermarkEnabled && watermarkWidth > 0 && watermarkHeight > 0;
    const needsSpeedChange = Math.abs(safeSpeed - 1.0) > 0.001;
    let needsCaption = captionText && captionText.trim() !== '';
    if (needsCaption) {
      if (!filters.drawtext) {
        console.warn('[Processor] WARNING: drawtext filter is missing in this FFmpeg binary. Captions will be ignored to prevent a fatal crash.');
        needsCaption = false;
      }
    }

    const colorChanged =
      colorPreset !== 'none' ||
      Math.abs(safeSaturation - 1.0) > 0.01 ||
      Math.abs(safeBrightness) > 0.01 ||
      Math.abs(safeContrast - 1.0) > 0.01;

    // ── New feature flags ──────────────────────────────────────────────────
    const needsMirror      = mirrorEnabled     === true || mirrorEnabled     === 'true';
    const needsSplitScreen = splitScreenEnabled === true || splitScreenEnabled === 'true';
    const needsBorder      = borderEnabled      === true || borderEnabled      === 'true';
    const needsGrain       = grainEnabled       === true || grainEnabled       === 'true';
    const needsZoom        = zoomEnabled        === true || zoomEnabled        === 'true';
    const needsFaceBlur    = faceBlurEnabled    === true || faceBlurEnabled    === 'true';
    const hasPitchShift    = (pitchShiftEnabled === true || pitchShiftEnabled === 'true')
                              && Math.abs(parseFloat(pitchShiftSemitones) || 0) > 0.01
                              && hasOriginalAudio;
    const needsFpsChange   = (fpsEnabled === true || fpsEnabled === 'true')
                              && parseInt(targetFps) > 0;

    // ── New feature flags (Tier 2) ─────────────────────────────────────────
    const needsHue        = (hueEnabled === true || hueEnabled === 'true')
                              && Math.abs(parseFloat(hueDegrees) || 0) > 0.1;
    const needsTilt       = (tiltEnabled === true || tiltEnabled === 'true')
                              && Math.abs(parseFloat(tiltAngle) || 0) > 0.05;
    const needsVCrop      = (vCropEnabled === true || vCropEnabled === 'true')
                              && parseFloat(vCropPercent) > 0;
    const needsFrameJitter = frameJitterEnabled === true || frameJitterEnabled === 'true';
    const needsSpeedRamp  = speedRampEnabled === true || speedRampEnabled === 'true';
    const hasNoiseFloor   = (noiseFloorEnabled === true || noiseFloorEnabled === 'true')
                              && hasOriginalAudio;
    const hasAudioEq      = (audioEqEnabled === true || audioEqEnabled === 'true')
                              && hasOriginalAudio;
    const needsThumbRandom = thumbRandomEnabled === true || thumbRandomEnabled === 'true';

    const hasSplitOverlay = needsSplitScreen && options && options.splitOverlayVideoPath && fs.existsSync(options.splitOverlayVideoPath);
    const hasAiTracker = aiTrackerAssPaths.length > 0;

    // ── Feature 20: Magnifying Glass — parse zones ─────────────────────────
    const needsMagnify = (magnifyEnabled === true || magnifyEnabled === 'true') && magnifyCrop != null;
    
    const overlays = (options && options.overlaysEnabled && options.overlaysData) ? options.overlaysData : [];
    const hasOverlays = overlays.length > 0;

    const needsVideoEncode = hasOriginalVideo && (
      needsCrop || needsWatermark || needsSpeedChange || needsCaption ||
      autoSubtitles || colorChanged || needsMirror || needsBorder ||
      needsGrain || needsZoom || needsFaceBlur || needsSplitScreen ||
      needsHue || needsTilt || needsVCrop || needsFrameJitter || needsSpeedRamp || hasAiTracker || hasOverlays ||
      needsMagnify
    );


    // ── Determine Pipeline ──────────────────────────────────────────────────
    let pipeline = 'cpu';
    if (!needsVideoEncode) {
      pipeline = 'copy';
    } else if (process.platform === 'darwin') {
      pipeline = 'macos';
    } else if (hw.nvenc) {
      pipeline = 'nvenc';
    } else if (hw.vaapi) {
      const vaapiDevice = process.env.VAAPI_DEVICE || '/dev/dri/renderD128';
      let vaapiUsable = false;
      try {
        // Verify the device exists and is readable/writable
        fs.accessSync(vaapiDevice, fs.constants.R_OK | fs.constants.W_OK);
        vaapiUsable = true;
      } catch (err) {
        // Device missing or permissions issue
      }
      
      if (vaapiUsable) {
        pipeline = 'vaapi';
      } else {
        console.log(`[Processor] VAAPI encoder detected but hardware device unavailable (${vaapiDevice}).`);
        console.log(`[Processor] Falling back to libx264.`);
        // Fallback to CPU happens implicitly since pipeline remains 'cpu' if not updated
      }
    }

    // ── Build video filter chain ────────────────────────────────────────────
    const vfParts = [];

    let captionFile = null;

    if (needsVideoEncode) {
      // 0. Watermark remover (delogo) - MUST be before crop to use original coords
      if (needsWatermark) {
        // FFmpeg 4.3 delogo crashes if x/y are exactly 0 or if bounds are odd/out of bounds.
        const safeX = Math.max(1, parseInt(watermarkX) || 1);
        const safeY = Math.max(1, parseInt(watermarkY) || 1);
        const w = parseInt(watermarkWidth) || 10;
        const h = parseInt(watermarkHeight) || 10;
        const safeW = w % 2 === 0 ? w : w - 1;
        const safeH = h % 2 === 0 ? h : h - 1;
        vfParts.push(`delogo=x=${safeX}:y=${safeY}:w=${Math.max(2, safeW)}:h=${Math.max(2, safeH)}`);
      }

      // 1. Crop transform (must come before speed/color so resolution is correct)
      if (needsCrop) {
        vfParts.push(`crop=${cropWidth}:${cropHeight}:${cropX}:${cropY}`);
      }

      // 1a. Mirror — applied AFTER crop so the crop box (drawn on original) stays valid
      if (needsMirror) {
        vfParts.push('hflip');
        
        const protectSubtitles = options.protectSubtitles === 'true' || options.protectSubtitles === true;
        if (protectSubtitles) {
          // Instead of a partial mirror which causes a seam, we cover the bottom 20%
          // with a sleek black box to hide the backwards hardcoded subtitles.
          vfParts.push('drawbox=x=0:y=ih*0.80:w=iw:h=ih*0.20:color=black@1.0:t=fill');
        }
      }

      // 1b. Border / Padding — scale down and pad with colour to change aspect fingerprint
      if (needsBorder) {
        const safePadPct  = Math.min(Math.max(parseFloat(borderPadding) || 10, 2), 25);
        const s           = ((100 - safePadPct) / 100).toFixed(6); // e.g. 0.900000
        const SAFE_BG     = new Set(['black', 'white', 'gray', 'red', 'blue', 'green']);
        const safeBg      = SAFE_BG.has(borderColor) ? borderColor : 'black';
        // Scale down then pad back: trunc(x/2)*2 guarantees even pixel dimensions for H.264
        vfParts.push(
          `scale=trunc(iw*${s}/2)*2:trunc(ih*${s}/2)*2,` +
          `pad=trunc(iw/${s}/2)*2:trunc(ih/${s}/2)*2:(ow-iw)/2:(oh-ih)/2:${safeBg}`
        );
      }

      // 2. Speed — adjust video PTS (presentation timestamp)
      if (needsSpeedChange) {
        vfParts.push(`setpts=${(1.0 / safeSpeed).toFixed(4)}*PTS`);
      }

      // 3. Color grading
      if (colorChanged) {
        let eqSaturation = safeSaturation;
        let eqBrightness = safeBrightness;
        let eqContrast = safeContrast;
        let eqGamma = 1.0;

        // Note: Using pure `eq` adjustments instead of `colorchannelmixer` RGB tints.
        // `colorchannelmixer` requires RGB format conversions which are incredibly slow on CPU.
        // By relying solely on `eq`, processing stays in native YUV format, yielding ~5x speedup.
        if (colorPreset === 'warm') {
          eqSaturation = Math.max(eqSaturation, 1.3);
          eqContrast = Math.max(eqContrast, 1.05);
          eqGamma = 1.05;
        } else if (colorPreset === 'cool') {
          eqSaturation = Math.max(eqSaturation, 1.1);
          eqGamma = 0.95;
        } else if (colorPreset === 'vivid') {
          eqSaturation = Math.max(eqSaturation, 1.8);
          eqContrast = Math.max(eqContrast, 1.2);
        } else if (colorPreset === 'cinematic') {
          eqSaturation = Math.max(eqSaturation, 0.85);
          eqContrast = Math.max(eqContrast, 1.15);
          eqBrightness = eqBrightness - 0.05;
          eqGamma = 0.9;
        } else if (colorPreset === 'vintage') {
          eqSaturation = Math.max(eqSaturation, 0.7);
          eqContrast = Math.max(eqContrast, 1.1);
          eqGamma = 1.1;
        }

        vfParts.push(
          `eq=saturation=${eqSaturation.toFixed(3)}:brightness=${eqBrightness.toFixed(3)}:contrast=${eqContrast.toFixed(3)}:gamma=${eqGamma.toFixed(3)}`
        );
      }

      // 3a. Film Grain — temporal noise; alters every frame's pixel hash
      if (needsGrain) {
        const safeGrain = Math.min(Math.max(parseInt(grainIntensity) || 20, 1), 100);
        // allf=t = temporal: different noise pattern per frame (not static)
        vfParts.push(`noise=alls=${safeGrain}:allf=t`);
      }

      // 3b. Dynamic Zoom / Reframe — changes spatial framing, breaks pHash
      if (needsZoom) {
        const zFactors  = { subtle: 1.05, medium: 1.10, heavy: 1.20 };
        const zf        = zFactors[zoomIntensity] || 1.05;
        const zfStr     = zf.toFixed(6);
        const invStr    = (1 / zf).toFixed(6);
        if (zoomDirection === 'zoom-in') {
          // Scale up, crop center back to original resolution
          vfParts.push(
            `scale=trunc(iw*${zfStr}/2)*2:trunc(ih*${zfStr}/2)*2,` +
            `crop=trunc(iw*${invStr}/2)*2:trunc(ih*${invStr}/2)*2:` +
            `(iw-trunc(iw*${invStr}/2)*2)/2:(ih-trunc(ih*${invStr}/2)*2)/2`
          );
        } else if (zoomDirection === 'zoom-out') {
          // Scale down and pad with black letterbox
          vfParts.push(
            `scale=trunc(iw*${invStr}/2)*2:trunc(ih*${invStr}/2)*2,` +
            `pad=trunc(iw*${invStr}*${zfStr}/2)*2:trunc(ih*${invStr}*${zfStr}/2)*2:(ow-iw)/2:(oh-ih)/2:black`
          );
        } else if (zoomDirection === 'pan-right') {
          // Crop left 90%, scale back to full width → effective rightward pan reframe
          vfParts.push(
            `crop=trunc(iw*0.9/2)*2:ih:trunc(iw*0.1/2)*2:0,` +
            `scale=trunc(iw/${(0.9).toFixed(6)}/2)*2:trunc(ih/2)*2`
          );
        } else if (zoomDirection === 'pan-left') {
          // Crop right 90%, scale back to full width → effective leftward pan reframe
          vfParts.push(
            `crop=trunc(iw*0.9/2)*2:ih:0:0,` +
            `scale=trunc(iw/${(0.9).toFixed(6)}/2)*2:trunc(ih/2)*2`
          );
        }
      }

      // 3c. Face / Privacy Blur — smartblur degrades facial recognition AI confidence
      if (needsFaceBlur) {
        const rawStr  = Math.min(Math.max(parseInt(faceBlurStrength) || 3, 1), 10);
        const radius  = (rawStr * 0.5).toFixed(1);
        vfParts.push(`smartblur=${radius}:-1:0:${radius}:-0.5:0`);
      }

      // 3d. Hue Rotation — shifts entire color wheel, breaks color histogram fingerprint
      if (needsHue) {
        // h= accepts degrees (positive or negative). 10° is invisible but fingerprint-breaking.
        const safeHue = Math.min(Math.max(parseFloat(hueDegrees) || 10, -180), 180);
        vfParts.push(`hue=h=${safeHue.toFixed(2)}`);
      }

      // 3e. Micro-Tilt Rotation — defeats CNN visual embedding models trained on axis-aligned frames
      if (needsTilt) {
        const safeTilt = Math.min(Math.max(parseFloat(tiltAngle) || 1.0, 0.1), 5.0);
        // Convert degrees to radians for FFmpeg rotate filter
        const radians  = (safeTilt * Math.PI / 180).toFixed(8);
        // oc=black fills the corners exposed by rotation; auto-crop removes them
        // We scale down first, then rotate, then crop back to near-original size
        // This avoids any black borders appearing in the final frame
        const cropFactor = Math.cos(safeTilt * Math.PI / 180).toFixed(8);
        vfParts.push(
          `rotate=${radians}:ow=rotw(${radians}):oh=roth(${radians}):fillcolor=black,` +
          `crop=trunc(iw*${cropFactor}/2)*2:trunc(ih*${cropFactor}/2)*2`
        );
      }

      // 3f. Vertical / Horizontal Crop Reframe — edge removal defeats border fingerprints
      if (needsVCrop) {
        const safeVPct  = Math.min(Math.max(parseFloat(vCropPercent) || 3, 1), 15);
        const cropFrac  = (safeVPct / 100).toFixed(6);
        if (vCropAxis === 'horizontal') {
          // Crop left+right, scale back to original width
          vfParts.push(
            `crop=trunc(iw*(1-2*${cropFrac})/2)*2:ih:trunc(iw*${cropFrac}/2)*2:0,` +
            `scale=trunc(iw/(1-2*${cropFrac})/2)*2:trunc(ih/2)*2`
          );
        } else {
          // Crop top+bottom (default), scale back to original height
          vfParts.push(
            `crop=iw:trunc(ih*(1-2*${cropFrac})/2)*2:0:trunc(ih*${cropFrac}/2)*2,` +
            `scale=trunc(iw/2)*2:trunc(ih/(1-2*${cropFrac})/2)*2`
          );
        }
      }

      // 3g. Temporal Frame Jitter — duplicates N frames near start to offset keyframe timestamps
      if (needsFrameJitter) {
        const safeJitter = Math.min(Math.max(parseInt(frameJitterFrames) || 2, 1), 5);
        // tpad=start=N pads N duplicate frames at the beginning of the video stream.
        // This slides every subsequent frame's PTS forward by N frame-durations,
        // offsetting the platform's expected keyframe extraction timestamps.
        vfParts.push(`tpad=start=${safeJitter}:start_mode=clone`);
      }

      // 3h. Variable Speed Ramp — changes tempo unpredictably across segments
      // We apply this as a setpts expression using a sine-based waveform.
      // This means no frame is at 1.0x — there is always slight acceleration/deceleration.
      if (needsSpeedRamp) {
        let ptsExpr;
        if (speedRampCurve === 'wave') {
          // Sinusoidal: gently accelerates/decelerates; near-invisible to viewer
          // Speed oscillates ±5% around 1.0x across the full clip
          ptsExpr = `PTS*(1+0.05*sin(2*PI*PTS/${videoDuration}))`;
        } else if (speedRampCurve === 'slow-fast') {
          // Start slow (0.9x), end fast (1.1x) — a single linear ramp
          ptsExpr = `PTS*(0.9+0.2*(PTS/${videoDuration}))`;
        } else if (speedRampCurve === 'fast-slow') {
          // Start fast (1.1x), end slow (0.9x)
          ptsExpr = `PTS*(1.1-0.2*(PTS/${videoDuration}))`;
        } else {
          // Fallback: random-ish wave using multiple harmonics
          ptsExpr = `PTS*(1+0.04*sin(2*PI*PTS/${videoDuration})+0.02*sin(4*PI*PTS/${videoDuration}))`;
        }
        // setpts evaluates the expression per-frame
        vfParts.push(`setpts=${ptsExpr}`);
      }



      if (needsCaption) {
        // Write caption to a text file to bypass FFmpeg's fragile filtergraph escaping rules.
        // This completely prevents "Filter not found" crashes when text contains quotes, commas, colons, etc.
        const crypto = require('crypto');
        const outputsDir = path.join(__dirname, 'disk_tmp', 'meta-remover-outputs');
        captionFile = path.join(outputsDir, `caption-${crypto.randomUUID()}.txt`);
        
        const fontsize = parseInt(captionSize, 10) || 36;
        
        // Auto word-wrap to prevent text going off-screen
        const wrapText = (text, maxChars) => {
          return text.split('\n').map(line => {
            const words = line.split(' ');
            let result = '';
            let currentLine = '';
            for (const word of words) {
              if (currentLine.length + word.length > maxChars) {
                if (currentLine.trim() !== '') {
                  result += currentLine.trim() + '\n';
                }
                currentLine = word + ' ';
              } else {
                currentLine += word + ' ';
              }
            }
            result += currentLine.trim();
            return result;
          }).join('\n');
        };
        
        const effectiveWidth = (videoWidth > 0 ? videoWidth : 1280) * 0.9; // 90% of screen width
        const charWidth = fontsize * 0.6; // Approximate average char width
        const maxCharsPerLine = Math.max(15, Math.floor(effectiveWidth / charWidth));
        
        const wrappedCaption = wrapText(captionText.trim(), maxCharsPerLine);
        fs.writeFileSync(captionFile, wrappedCaption, 'utf8');

        const ALLOWED_COLORS = new Set(['white', 'yellow', 'black', 'red', 'cyan']);
        const safeColor = ALLOWED_COLORS.has(captionColor) ? captionColor : 'white';
        const localFont = path.join(__dirname, 'bin', 'Roboto-Bold.ttf');
        const fontPath = process.platform === 'darwin'
          ? '/System/Library/Fonts/Helvetica.ttc'
          : (fs.existsSync(localFont) ? localFont : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');

        let yExpr = '';
        if (captionPosition === 'top')         yExpr = '30';
        else if (captionPosition === 'center') yExpr = '(h-text_h)/2';
        else                                   yExpr = 'h-text_h-30'; // bottom (default)

        vfParts.push(
          `drawtext=textfile='${captionFile.replace(/\\/g, '/')}':fontsize=${fontsize}:fontcolor=${safeColor}:x=(w-text_w)/2:y=${yExpr}:box=1:boxcolor=black@0.5:boxborderw=8:line_spacing=5:fontfile='${fontPath}'`
        );
      }
      // 5. Auto Subtitles via Whisper SRT
      console.log(`[Processor DEBUG] generatedSrtPath: ${generatedSrtPath}`);
      if (generatedSrtPath) {
        console.log(`[Processor DEBUG] exists: ${fs.existsSync(generatedSrtPath)}`);
      }
      if (generatedSrtPath && fs.existsSync(generatedSrtPath)) {
        // FFmpeg filter syntax requires escaping colons and slashes
        const safeSrtPath = generatedSrtPath.replace(/\\/g, '/').replace(/:/g, '\\:');
        console.log(`[Processor DEBUG] safeSrtPath: ${safeSrtPath}`);
        vfParts.push(`subtitles='${safeSrtPath}'`);
        console.log(`[Processor DEBUG] vfParts after push:`, vfParts);
      }
      
      // 6. AI Tracker Subtitles
      if (hasAiTracker) {
        for (const assPath of aiTrackerAssPaths) {
           const safeAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
           vfParts.push(`subtitles='${safeAssPath}'`);
        }
      }

      // 7. Text & Symbol Overlays (Interactive)
      // Removed: Text/Symbol overlays are now rasterized by the frontend into transparent PNGs 
      // and uploaded as image overlays. This completely avoids FFmpeg drawtext font configuration
      // issues and guarantees 100% accurate WYSIWYG placement and styling.
    } // end if (needsVideoEncode)

    // ── Explicit VAAPI Filter Graph ─────────────────────────────────────────
    if (pipeline === 'vaapi' && vfParts.length > 0) {
      // Because we apply CPU filters (crop, delogo, drawtext, etc.), we explicitly
      // download the VAAPI frame to system memory, process it, and upload it back.
      vfParts.unshift('hwdownload', 'format=nv12');
      vfParts.push('format=nv12', 'hwupload');
    }

    // ── Build audio filter chain ────────────────────────────────────────────
    // Pitch Shift, Speed, EQ, and Noise Floor are all unified here.
    const afParts = [];
    if (hasPitchShift) {
      const semitones       = parseFloat(pitchShiftSemitones) || 0;
      const pitchFactor     = Math.pow(2, semitones / 12);
      const aStream         = (cachedProbe?.streams || []).find(s => s.codec_type === 'audio');
      const sr              = parseInt(aStream?.sample_rate || 44100);
      afParts.push(`asetrate=${sr}*${pitchFactor.toFixed(6)},aresample=${sr}`);
      const combinedTempo = safeSpeed / pitchFactor;
      let ct = combinedTempo;
      while (ct > 2.0) { afParts.push('atempo=2.0'); ct /= 2.0; }
      while (ct < 0.5) { afParts.push('atempo=0.5'); ct /= 0.5; }
      afParts.push(`atempo=${ct.toFixed(6)}`);
    } else if (Math.abs(safeSpeed - 1.0) > 0.001) {
      // Speed-only path (no pitch shift): chain atempo in 0.5–2.0 range
      let speedRemaining = safeSpeed;
      while (speedRemaining > 2.0) { afParts.push('atempo=2.0'); speedRemaining /= 2.0; }
      while (speedRemaining < 0.5) { afParts.push('atempo=0.5'); speedRemaining /= 0.5; }
      afParts.push(`atempo=${speedRemaining.toFixed(4)}`);
    }

    // Feature 14: Audio EQ Shift — reshape spectral envelope, breaks AcoustID spectral shape
    if (hasAudioEq) {
      // All presets use the 'equalizer' biquad filter. Frequency in Hz, width in octaves.
      // We chain two bands to create a distinctive enough spectral signature change.
      const EQ_PRESETS = {
        'cut-low':    'equalizer=f=80:width_type=o:width=1:g=-6,equalizer=f=200:width_type=o:width=0.5:g=-3',
        'cut-high':   'equalizer=f=8000:width_type=o:width=1:g=-6,equalizer=f=4000:width_type=o:width=0.5:g=-2',
        'boost-mid':  'equalizer=f=1000:width_type=o:width=1:g=4,equalizer=f=2500:width_type=o:width=0.5:g=2',
        'scoop-mid':  'equalizer=f=800:width_type=o:width=1.5:g=-5,equalizer=f=2000:width_type=o:width=0.5:g=-2',
        'telephone':  'highpass=f=300,lowpass=f=3400',
      };
      const eqFilter = EQ_PRESETS[audioEqPreset] || EQ_PRESETS['cut-low'];
      afParts.push(eqFilter);
      console.log(`[Processor] Audio EQ: applying preset '${audioEqPreset}'`);
    }

    // Feature 11: Audio Noise Floor — injected via filter_complex below (hasNoiseFloor flag).

    // ── Metadata args (single consolidated array — Fix 4) ──────────────────
    const metaArgs = buildMetaArgs(options);

    // ── Build FFmpeg command ────────────────────────────────────────────────
    let lastProgress = 0;
    const cmd = ffmpeg(inputPath);
    cmd.inputOptions('-threads', '1');
    cmd.outputOptions('-max_muxing_queue_size', '1024');

    // ── VAAPI Input Options ─────────────────────────────────────────────────
    if (pipeline === 'vaapi') {
      const vaapiDevice = process.env.VAAPI_DEVICE || '/dev/dri/renderD128';
      cmd.inputOptions([
        '-hwaccel', 'vaapi',
        '-hwaccel_output_format', 'vaapi',
        '-vaapi_device', vaapiDevice
      ]);
    }

    // Add trim as input option (fastest — before decode)
    if (trimStart !== null && trimStart !== '' && !isNaN(parseFloat(trimStart))) {
      cmd.inputOptions('-ss', `${parseFloat(trimStart)}`);
    }

    let currentInputIndex = 0; // main video is 0
    let externalAudioIndex = -1;
    let splitOverlayVideoIndex = -1;

    // Fix 3: Add external audio input FIRST, THEN set stream_loop on it.
    if (hasExternalAudio && (audioMode === 'replace' || audioMode === 'mix')) {
      cmd.input(options.audioPath);
      currentInputIndex++;
      externalAudioIndex = currentInputIndex;
      if (audioMode === 'mix') {
        cmd.inputOptions('-stream_loop', '-1');
      }
    }

    if (hasSplitOverlay) {
      cmd.input(options.splitOverlayVideoPath);
      currentInputIndex++;
      splitOverlayVideoIndex = currentInputIndex;
      cmd.inputOptions('-stream_loop', '-1');
    }

    const imageOverlays = hasOverlays ? overlays.filter(o => o.type === 'image' && o.filePath && fs.existsSync(o.filePath)) : [];
    imageOverlays.forEach(overlay => {
      cmd.input(overlay.filePath);
      currentInputIndex++;
      overlay.inputIndex = currentInputIndex;
    });

    if (trimEnd !== null && trimEnd !== '' && !isNaN(parseFloat(trimEnd))) {
      const start = (trimStart !== null && !isNaN(parseFloat(trimStart))) ? parseFloat(trimStart) : 0;
      const duration = parseFloat(trimEnd) - start;
      if (duration > 0) cmd.outputOptions('-t', `${duration}`);
    }

    // Map streams based on audio mode
    cmd.outputOptions('-map_metadata', '-1');
    cmd.outputOptions('-shortest'); // Prevent infinite encoding when using stream_loop

    // ── Stream mapping + filter application ─────────────────────────────────────
    // We need complexFilter in two situations:
    //   A) Split-screen (Feature 2) — always needs filter_complex for the split/stack
    //   B) Audio mix mode with original audio — needs filter_complex for amix
    // Both cases are unified into a SINGLE complexFilter string to avoid double-input bugs.
    const useAudioComplexFilter = (audioMode === 'mix' && hasExternalAudio && hasOriginalAudio);
    const hasImageOverlays = imageOverlays.length > 0;
    // Also use complex filter if noise floor injection is needed — aevalsrc requires filter_complex
    const useComplexFilter = needsSplitScreen || useAudioComplexFilter || hasNoiseFloor || hasImageOverlays || needsMagnify;

    if (useComplexFilter) {
      // Build filter_complex string in parts
      // ── Video section ────────────────────────────────────────────
      // Pre-compute final label: if magnify zones are chained, intermediate output is '_pre_magnify'
      const preMagnifyLabel = (needsMagnify && hasOriginalVideo) ? '_pre_magnify' : 'vout';

      const fcParts = []; // each element is a complete filter chain segment (no trailing ;)

      if (needsSplitScreen && hasOriginalVideo) {
        // Apply ALL regular vf filters to get the processed video, then split and stack.
        // This guarantees both halves share identical dimensions (they branch post-filter).
        const mainChain = (needsVideoEncode && vfParts.length > 0) ? vfParts.join(',') : 'null';
        fcParts.push(`[0:v]${mainChain}[_splitprocessed]`);

        if (hasSplitOverlay) {
          if (splitDirection === 'horizontal') {
            fcParts.push(`[${splitOverlayVideoIndex}:v]scale=trunc(iw/4)*2:trunc(ih/2)*2[_overlayvid]`);
          } else {
            fcParts.push(`[${splitOverlayVideoIndex}:v]scale=trunc(iw/2)*2:trunc(ih/4)*2[_overlayvid]`);
          }
        }

        if (splitDirection === 'horizontal') {
          // Side-by-side: each half = half width, full height
          fcParts.push('[_splitprocessed]split=2[_splitleft][_splitright]');
          fcParts.push('[_splitleft]scale=trunc(iw/4)*2:trunc(ih/2)*2[_leftvid]');
          if (hasSplitOverlay) {
             fcParts.push('[_splitright]scale=trunc(iw/4)*2:trunc(ih/2)*2,boxblur=25:5[_blurright]');
             fcParts.push('[_blurright][_overlayvid]overlay=0:0[_rightvid]');
          } else {
             fcParts.push('[_splitright]scale=trunc(iw/4)*2:trunc(ih/2)*2,boxblur=25:5[_rightvid]');
          }
          fcParts.push(`[_leftvid][_rightvid]hstack[${hasImageOverlays ? '_basevid' : preMagnifyLabel}]`);
        } else {
          // Top/Bottom (default): each half = full width, half height
          fcParts.push('[_splitprocessed]split=2[_splittop][_splitbot]');
          fcParts.push('[_splittop]scale=trunc(iw/2)*2:trunc(ih/4)*2[_topvid]');
          if (hasSplitOverlay) {
             fcParts.push('[_splitbot]scale=trunc(iw/2)*2:trunc(ih/4)*2,boxblur=25:5[_blurbot]');
             fcParts.push('[_blurbot][_overlayvid]overlay=0:0[_botvid]');
          } else {
             fcParts.push('[_splitbot]scale=trunc(iw/2)*2:trunc(ih/4)*2,boxblur=25:5[_botvid]');
          }
          fcParts.push(`[_topvid][_botvid]vstack[${hasImageOverlays ? '_basevid' : preMagnifyLabel}]`);
        }

        if (hasImageOverlays) {
          let lastVidOut = '_basevid';
          imageOverlays.forEach((ov, idx) => {
            const outName = idx === imageOverlays.length - 1 ? (needsMagnify ? '_pre_magnify' : 'vout') : `_ov${idx}`;
            fcParts.push(`[${ov.inputIndex}:v][${lastVidOut}]scale2ref=w=iw*${(ov.widthPct || 10)/100}:h=ih*${(ov.heightPct || 10)/100}[_scaled_ov${idx}][_ref_ov${idx}]`);
            fcParts.push(`[_ref_ov${idx}][_scaled_ov${idx}]overlay=x=W*${(ov.xPct || 0)/100}:y=H*${(ov.yPct || 0)/100}[${outName}]`);
            lastVidOut = outName;
          });
        }
      } else if (hasOriginalVideo) {
        // No split-screen — passthrough video with existing vf chain
        let mainChain = (needsVideoEncode && vfParts.length > 0) ? vfParts.join(',') : 'null';
        
        if (hasImageOverlays) {
          fcParts.push(`[0:v]${mainChain}[_basevid]`);
          let lastVidOut = '_basevid';
          imageOverlays.forEach((ov, idx) => {
            const outName = idx === imageOverlays.length - 1 ? (needsMagnify ? '_pre_magnify' : 'vout') : `_ov${idx}`;
            fcParts.push(`[${ov.inputIndex}:v][${lastVidOut}]scale2ref=w=iw*${(ov.widthPct || 10)/100}:h=ih*${(ov.heightPct || 10)/100}[_scaled_ov${idx}][_ref_ov${idx}]`);
            fcParts.push(`[_ref_ov${idx}][_scaled_ov${idx}]overlay=x=W*${(ov.xPct || 0)/100}:y=H*${(ov.yPct || 0)/100}[${outName}]`);
            lastVidOut = outName;
          });
        } else {
          fcParts.push(`[0:v]${mainChain}[${preMagnifyLabel}]`);
        }
      }

      // Audio input was conditionally added above. We reference [externalAudioIndex:a]
      if (useAudioComplexFilter) {
        const vol1 = (1.0 - parseFloat(audioVolume)).toFixed(2);
        const vol2 = parseFloat(audioVolume).toFixed(2);
        fcParts.push(
          afParts.length > 0
            ? `[0:a]volume=${vol1},${afParts.join(',')}[_a1]`
            : `[0:a]volume=${vol1}[_a1]`
        );
        fcParts.push(`[${externalAudioIndex}:a]volume=${vol2}[_a2]`);
        fcParts.push('[_a1][_a2]amix=inputs=2:duration=first:dropout_transition=3[aout]');
      } else if (afParts.length > 0 && hasOriginalAudio && audioMode !== 'mute') {
        // Audio filters exist but no amix — embed in filter_complex to avoid -af conflict
        fcParts.push(`[0:a]${afParts.join(',')}[aout]`);
      } else if (afParts.length > 0 && audioMode === 'replace' && hasExternalAudio) {
        fcParts.push(`[${externalAudioIndex}:a]${afParts.join(',')}[aout]`);
      } else if (hasNoiseFloor && hasOriginalAudio) {
        // Feature 11: Noise floor only (no other af filters).
        // Inject white noise at extreme low volume and mix with original audio.
        // aevalsrc generates a synthetic noise signal at the same sample rate as original.
        const aStream = (cachedProbe?.streams || []).find(s => s.codec_type === 'audio');
        const sr = parseInt(aStream?.sample_rate || 44100);
        const safeDb = Math.min(Math.max(parseFloat(noiseFloorDb) || -38, -60), -20);
        // Convert dB to linear amplitude: 10^(dB/20)
        const amp = Math.pow(10, safeDb / 20).toFixed(8);
        fcParts.push(`aevalsrc=random(0)*${amp}:s=${sr}[_noise]`);
        fcParts.push(`[0:a][_noise]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
      } else if (hasNoiseFloor && hasOriginalAudio && afParts.length > 0) {
        // Noise floor + pitch/speed/eq: chain af filters on main audio then mix with noise
        const aStream = (cachedProbe?.streams || []).find(s => s.codec_type === 'audio');
        const sr = parseInt(aStream?.sample_rate || 44100);
        const safeDb = Math.min(Math.max(parseFloat(noiseFloorDb) || -38, -60), -20);
        const amp = Math.pow(10, safeDb / 20).toFixed(8);
        fcParts.push(`[0:a]${afParts.join(',')}[_afout]`);
        fcParts.push(`aevalsrc=random(0)*${amp}:s=${sr}[_noise]`);
        fcParts.push(`[_afout][_noise]amix=inputs=2:duration=first:dropout_transition=0[aout]`);
      }

      // ── Feature 20: Magnifying Glass — time-ranged spotlight zoom ──────────
      if (needsMagnify && hasOriginalVideo) {
        // CRITICAL ARCHITECTURE:
        // The magnify effect must split the RAW [0:v] BEFORE any vfParts are applied.
        // This ensures _mg_base remains sharp (only receiving necessary encoding filters).
        // Previous bug: split happened after smartblur/grain were already baked in.
        
        const vw = Math.max(videoWidth || 1920, 4);
        const vh = Math.max(videoHeight || 1080, 4);
        const outW = vw % 2 === 0 ? vw : vw - 1;
        const outH = vh % 2 === 0 ? vh : vh - 1;

        const xPx = Math.max(0, Math.round((parseFloat(magnifyCrop.x) / 100) * vw));
        const yPx = Math.max(0, Math.round((parseFloat(magnifyCrop.y) / 100) * vh));
        let wPx = Math.round((parseFloat(magnifyCrop.width || magnifyCrop.w) / 100) * vw);
        let hPx = Math.round((parseFloat(magnifyCrop.height || magnifyCrop.h) / 100) * vh);
        wPx = Math.max(4, wPx % 2 === 0 ? wPx : wPx - 1);
        hPx = Math.max(4, hPx % 2 === 0 ? hPx : hPx - 1);
        wPx = Math.min(wPx, outW);
        hPx = Math.min(hPx, outH);
        const safeX = Math.max(0, Math.min(xPx, outW - wPx));
        const safeY = Math.max(0, Math.min(yPx, outH - hPx));

        const trimOffset = (trimStart !== null && trimStart !== '' && !isNaN(parseFloat(trimStart))) ? parseFloat(trimStart) : 0;
        const tsRaw = Math.max(0, (parseFloat(magnifyStart) || 0) - trimOffset);
        const ts = tsRaw.toFixed(3);
        let teRaw = magnifyEnd ? Math.max(tsRaw + 0.1, parseFloat(magnifyEnd) - trimOffset) : null;
        if (teRaw !== null && teRaw < 0) teRaw = 0;
        const te = teRaw !== null ? teRaw.toFixed(3) : '999999';
        
        const feather = Math.max(0, Math.min(parseInt(magnifyBlur) || 0, 100));
        const zoom = Math.max(1.0, parseFloat(magnifyZoom) || 2.0);
        
        // Crop a smaller region centered on the drawn box, then scale it up
        let innerW = Math.round(wPx / zoom);
        let innerH = Math.round(hPx / zoom);
        innerW = Math.max(4, innerW % 2 === 0 ? innerW : innerW - 1);
        innerH = Math.max(4, innerH % 2 === 0 ? innerH : innerH - 1);
        
        const cx = safeX + (wPx / 2);
        const cy = safeY + (hPx / 2);
        let innerX = Math.max(0, Math.round(cx - (innerW / 2)));
        let innerY = Math.max(0, Math.round(cy - (innerH / 2)));
        // Clamp so crop doesn't exceed video bounds
        innerX = Math.min(innerX, outW - innerW);
        innerY = Math.min(innerY, outH - innerH);
        
        let timeGate = magnifyEnd ? `:enable='between(t,${ts},${te})'` : '';

        // Build the alpha expression for the circular mask
        let alphaExpr;
        if (feather === 0) {
           alphaExpr = 'if(lt(hypot(X-W/2,Y-H/2),min(W/2,H/2)),255,0)';
        } else {
           const ff = (feather / 100).toFixed(2);
           alphaExpr = 'if(lt(hypot(X-W/2,Y-H/2),min(W/2,H/2)*(1-' + ff + ')),255,if(gt(hypot(X-W/2,Y-H/2),min(W/2,H/2)),0,255*(min(W/2,H/2)-hypot(X-W/2,Y-H/2))/(min(W/2,H/2)*' + ff + ')))';
        }

        // The zoom branch: crop inner region → scale up → sharpen → apply circular alpha mask and a 6px red circle border
        fcParts.push(`[_pre_magnify]split=2[_mg_base][_mg_fg]`);
        fcParts.push(`[_mg_fg]crop=${innerW}:${innerH}:${innerX}:${innerY},scale=${wPx}:${hPx}:flags=lanczos,unsharp=5:5:0.8:5:5:0.0,format=rgba,geq=r='if(between(hypot(X-W/2,Y-H/2),min(W/2,H/2)-6,min(W/2,H/2)),255,p(X,Y))':g='if(between(hypot(X-W/2,Y-H/2),min(W/2,H/2)-6,min(W/2,H/2)),0,p(X,Y))':b='if(between(hypot(X-W/2,Y-H/2),min(W/2,H/2)-6,min(W/2,H/2)),0,p(X,Y))':a='${alphaExpr}'[_mg_zoomed]`);
        fcParts.push(`[_mg_base][_mg_zoomed]overlay=${safeX}:${safeY}${timeGate}[vout]`);
        
        console.log(`[Processor] ── Magnify Debug ──────────────────────────────`);
        console.log(`[Processor] Video: ${vw}x${vh}, Output: ${outW}x${outH}`);
        console.log(`[Processor] Crop input: x=${magnifyCrop.x}% y=${magnifyCrop.y}% w=${magnifyCrop.width || magnifyCrop.w}% h=${magnifyCrop.height || magnifyCrop.h}%`);
        console.log(`[Processor] Pixel box: x=${safeX} y=${safeY} w=${wPx} h=${hPx}`);
        console.log(`[Processor] Center: cx=${cx} cy=${cy}`);
        console.log(`[Processor] Inner crop: x=${innerX} y=${innerY} w=${innerW} h=${innerH}`);
        console.log(`[Processor] Zoom: ${zoom}x, Feather: ${feather}`);
        console.log(`[Processor] Alpha expr: ${alphaExpr}`);
        console.log(`[Processor] Time gate: ${timeGate || 'ENTIRE VIDEO'}`);
        console.log(`[Processor] ───────────────────────────────────────────────`);
      }

      cmd.complexFilter(fcParts.join(';'));

      // ── Output mapping ────────────────────────────────────────────
      if (hasOriginalVideo || needsSplitScreen) {
        cmd.outputOptions('-map', '[vout]');
      }
      // Determine whether audio was routed through filter_complex
      const audioInFc = useAudioComplexFilter || hasNoiseFloor
        || (afParts.length > 0 && hasOriginalAudio && audioMode !== 'mute')
        || (afParts.length > 0 && audioMode === 'replace' && hasExternalAudio);

      if (audioInFc) {
        cmd.outputOptions('-map', '[aout]');
      } else if (audioMode === 'mute') {
        // no audio mapping
      } else if (audioMode === 'replace' && hasExternalAudio) {
        cmd.outputOptions('-map', `${externalAudioIndex}:a?`);
      } else if (hasOriginalAudio) {
        cmd.outputOptions('-map', '0:a?');
      }

    } else {
      // ── Simple path (no complex filter needed) ───────────────────────
      if (needsVideoEncode && vfParts.length > 0) {
        cmd.videoFilter(vfParts.join(','));
      }

      if (audioMode === 'mute') {
        cmd.noAudio();
      } else if (audioMode === 'replace' && hasExternalAudio) {
        cmd.input(options.audioPath);
        cmd.outputOptions('-map', '0:v?', '-map', `${externalAudioIndex}:a?`);
        if (afParts.length > 0) cmd.audioFilter(afParts.join(','));
      } else if (audioMode === 'mix' && hasExternalAudio && !hasOriginalAudio) {
        cmd.input(options.audioPath);
        cmd.outputOptions('-map', '0:v?', '-map', `${externalAudioIndex}:a?`);
        if (afParts.length > 0) cmd.audioFilter(afParts.join(','));
      } else {
        if (afParts.length > 0 && hasOriginalAudio) cmd.audioFilter(afParts.join(','));
      }
    }

    // ── Encoding settings (GPU detection + macOS quality mode) ──────────────
    if (pipeline === 'macos') {
      cmd
        .videoCodec('h264_videotoolbox')
        .outputOptions('-b:v', '6000k', '-maxrate', '9000k', '-bufsize', '4000k', '-allow_sw', '1');
    } else if (pipeline === 'nvenc') {
      console.log('[Processor] Encoding with h264_nvenc (NVIDIA GPU)');
      cmd
        .videoCodec('h264_nvenc')
        .outputOptions('-preset', 'p4', '-rc', 'vbr', '-cq', '19');
    } else if (pipeline === 'vaapi') {
      console.log(`[Processor] GPU detected: h264_vaapi`);
      console.log(`[Processor] Selected encoder: VAAPI`);
      console.log(`[Processor] Hardware decoding: enabled`);
      console.log(`[Processor] Hardware encoding: enabled`);
      console.log(`[Processor] Filter chain:\n${vfParts.join('\n')}`);
      console.log(`[Processor] Using GPU pipeline`);
      cmd
        .videoCodec('h264_vaapi');
    } else if (pipeline === 'cpu') {
      console.log('[Processor] GPU unavailable\n[Processor] Falling back to libx264');
      cmd
        .videoCodec('libx264')
        // Using preset 'veryfast' to prioritize speed over mathematically perfect compression
        .outputOptions('-crf', '18', '-preset', 'veryfast', '-pix_fmt', 'yuv420p');
    } else if (pipeline === 'copy') {
      console.log('[Processor] Smart bypass enabled: Copying video stream instead of re-encoding');
      cmd.videoCodec('copy');
    }

    // Explicitly use bicubic scaler algorithm for better quality on format conversions and scaling
    cmd.outputOptions('-sws_flags', 'bicubic');

    const needsAudioEncode = afParts.length > 0 || audioMode === 'mix'
      || (audioMode === 'replace' && hasExternalAudio)
      || hasNoiseFloor || hasAudioEq;
    if (needsAudioEncode) {
      cmd.audioCodec('aac').outputOptions('-b:a', '128k');
    } else {
      cmd.audioCodec('copy');
    }

    // Apply metadata pairs safely — two-argument form bypasses fluent-ffmpeg's
    // auto-split that would corrupt values containing exactly one space.
    applyMetaArgs(cmd, metaArgs);

    // Explicitly declare output format — same safeguard as replaceVideoMetadata
    let finalFmt = EXT_TO_FORMAT[outputExt];

    // ── Feature 17: Container Re-Mux format override ─────────────────────────
    if (remuxEnabled && remuxFormat) {
      const SAFE_FORMATS = { mkv: 'matroska', mov: 'mov', avi: 'avi', webm: 'webm', ts: 'mpegts' };
      const safeRemuxFmt = SAFE_FORMATS[remuxFormat.toLowerCase()];
      if (safeRemuxFmt) {
        finalFmt = safeRemuxFmt;
        // Update outputPath extension to match the container
        const dir = path.dirname(outputPath);
        const name = path.basename(outputPath, path.extname(outputPath));
        outputPath = path.join(dir, `${name}.${remuxFormat.toLowerCase()}`);
        console.log(`[Processor] Container re-mux: output format overridden to '${safeRemuxFmt}' and ext to '.${remuxFormat.toLowerCase()}'`);
      } else {
        console.warn(`[Processor] Unknown remux format '${remuxFormat}', keeping original.`);
      }
    }

    if (finalFmt) cmd.outputOptions('-f', finalFmt);

    if (useFaststart) cmd.outputOptions('-movflags', '+faststart');

    // ── Feature 7: FPS Conversion ──────────────────────────────────────────
    // Applied as an output option so it works with both simple and complex filter paths.
    if (needsFpsChange) {
      const safeFps = Math.min(Math.max(parseInt(targetFps) || 30, 1), 120);
      cmd.outputOptions('-r', safeFps.toString());
      console.log(`[Processor] FPS conversion: output will be ${safeFps}fps`);
    }

    cmd
      .output(outputPath)
      .on('start', (cmdStr) => {
        console.log('[Processor] FFmpeg transform command:', cmdStr);
        if (updateProgress) updateProgress(5);
      })
      .on('progress', (info) => {
        const pct = Math.min(Math.round(info.percent || 0), 95);
        if (pct > lastProgress) {
          lastProgress = pct;
          if (updateProgress) updateProgress(pct);
        }
      })
      .on('end', () => {
        if (jobId) activeJobs.delete(jobId);
        console.log(`[Processor] Finished job for output: ${outputPath}`);
        if (updateProgress) updateProgress(100);
        if (captionFile) { try { fs.unlinkSync(captionFile); } catch {} }
        resolve(outputPath);
      })
      .on('error', (err) => {
        if (jobId) activeJobs.delete(jobId);
        console.error('[Processor] FFmpeg transform error:', err.message);
        if (captionFile) { try { fs.unlinkSync(captionFile); } catch {} }
        reject(err);
      });

    if (jobId) activeJobs.set(jobId, cmd);
    cmd.run();
  });
}

// ---------------------------------------------------------------------------
// Safe fallback: plain copy for unsupported file types
// ---------------------------------------------------------------------------
function copyFile(inputPath, outputPath) {
  fs.copyFileSync(inputPath, outputPath);
  console.log(`[Processor] File copied (no processing available): ${path.basename(outputPath)}`);
}

// ---------------------------------------------------------------------------
// Main routing function called by the queue
// ---------------------------------------------------------------------------
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.flv', '.wmv', '.3gp']);

async function processFile(job) {
  const { id, inputPath, outputPath, mimeType, customMeta, transformOptions, mode } = job;
  console.log(`[Processor] Processing mode="${mode}": ${mimeType} — file: ${path.basename(inputPath)}`);

  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file missing from disk: ${path.basename(inputPath)}. This usually happens if the server restarted (e.g., Render sleep or deployment) between upload and processing.`);
  }

  const ext = path.extname(inputPath).toLowerCase();
  const isJpeg = mimeType === 'image/jpeg' || ext === '.jpg' || ext === '.jpeg';
  const isVideo = VIDEO_EXTENSIONS.has(ext) || (mimeType && mimeType.startsWith('video/'));
  const outputExt = path.extname(outputPath).toLowerCase();

  // Fix 2: Run ffprobe ONCE here for transform jobs, before FFmpeg starts.
  // The cached result is passed into transformVideo so it doesn't probe again.
  let cachedProbe = null;
  if (isVideo && mode === 'transform') {
    try {
      cachedProbe = await ffprobeAsync(inputPath);
    } catch (e) {
      console.warn('[Processor] Pre-probe failed, transformVideo will retry:', e.message);
    }
  }

  let finalOutputPath = outputPath;
  try {
    if (isVideo && mode === 'transform') {
      finalOutputPath = await transformVideo(id, inputPath, finalOutputPath, transformOptions, job.updateProgress, cachedProbe);
    } else if (isVideo) {
      // Default: fast metadata-only mode (stream-copy)
      finalOutputPath = await replaceVideoMetadata(id, inputPath, finalOutputPath, customMeta, job.updateProgress, outputExt);
    } else if (isJpeg) {
      await stripJpegMetadata(inputPath, finalOutputPath);  // Fix 1: now async
      if (typeof job.updateProgress === 'function') job.updateProgress(100);
    } else {
      copyFile(inputPath, finalOutputPath);
      if (typeof job.updateProgress === 'function') job.updateProgress(100);
    }
  } catch (err) {
    console.error('[Processor] Error during processing:', err.message);
    throw err; // Fail the job properly so the queue handles it
  } finally {
    // Always cleanup original upload after processing or failure
    try { fs.unlinkSync(inputPath); } catch { /* ignore */ }
    // Always cleanup external audio file if present
    if (transformOptions && transformOptions.audioPath) {
      try { fs.unlinkSync(transformOptions.audioPath); } catch { /* ignore */ }
    }
  }

  return finalOutputPath;
}

module.exports = { processFile, cancelProcessing };
