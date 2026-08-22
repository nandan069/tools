import { useState, useRef, useEffect, useMemo } from 'react';
import ReactCrop from 'react-image-crop';
import { Rnd } from 'react-rnd';
import 'react-image-crop/dist/ReactCrop.css';
import './App.css';
import VideoTimeline from './VideoTimeline';

// ── Small helper: seconds → MM:SS ────────────────────────────────────────
function secondsToMMSS(s) {
  if (s == null || s === '') return '';
  const total = Math.max(0, parseFloat(s));
  const m = Math.floor(total / 60);
  const sec = (total % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

// ── Accordion card component ─────────────────────────────────────────────
function AccordionPanel({ icon, title, badge, enabled, onToggleEnabled, children }) {
  const [open, setOpen] = useState(false); // collapsed by default — less scroll

  // Auto-open when user enables the panel
  const handleToggle = (checked) => {
    onToggleEnabled(checked);
    if (checked) setOpen(true);
  };

  return (
    <div className={`accordion-card ${enabled ? 'accordion-card--active' : ''}`}>
      <div className="accordion-header" onClick={() => setOpen(o => !o)}>
        <div className="accordion-left">
          <span className="accordion-icon">{icon}</span>
          <span className="accordion-title">{title}</span>
          {badge && enabled && <span className="accordion-badge">{badge}</span>}
          {!enabled && <span className="accordion-off-tag">off</span>}
        </div>
        <div className="accordion-right" onClick={e => e.stopPropagation()}>
          <label className="toggle-switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => handleToggle(e.target.checked)}
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>
          <span className={`accordion-chevron ${open ? 'open' : ''}`}>›</span>
        </div>
      </div>
      {open && (
        <div className={`accordion-body ${!enabled ? 'accordion-body--disabled' : ''}`}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Helper ───────────────────────────────────────────────────────────────
const textMeasureCtx = document.createElement('canvas').getContext('2d');

// ── Main App ─────────────────────────────────────────────────────────────
function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);
  const [outputUrl, setOutputUrl] = useState('');
  const [error, setError] = useState('');
  const [isHovering, setIsHovering] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const videoRef = useRef(null);
  const previewContainerRef = useRef(null);
  const magnifyPreviewRef = useRef(null);
  const magnifyVideoRef = useRef(null);

  // Processing mode
  const [mode, setMode] = useState('transform'); // 'metadata' | 'transform'
  const [activeTab, setActiveTab] = useState('basic');

  // ── Metadata fields ───────────────────────────────────────────────────
  const [metaTitle, setMetaTitle] = useState('');
  const [metaAuthor, setMetaAuthor] = useState('');
  const [metaComment, setMetaComment] = useState('');
  const [metaCopyright, setMetaCopyright] = useState('');
  const [metaCreationTime, setMetaCreationTime] = useState('');

  // ── Feature toggles ───────────────────────────────────────────────────
  const [trimEnabled, setTrimEnabled] = useState(false);
  const [dimsEnabled, setDimsEnabled] = useState(false);
  const [speedEnabled, setSpeedEnabled] = useState(false);
  const [speed, setSpeed] = useState(1.0);
  const [colorEnabled, setColorEnabled] = useState(false);
  const [captionEnabled, setCaptionEnabled] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // ── Trim ─────────────────────────────────────────────────────────────
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');

  // ── Crop & Watermark ───────────────────────────────────────────────────────
  const [activeDrawMode, setActiveDrawMode] = useState('none'); // 'crop' | 'watermark' | 'none' | 'ai-tracker'
  const [cropEnabled, setCropEnabled] = useState(false);
  const [crop, setCrop] = useState(null); // stores percent crop

  const [watermarkEnabled, setWatermarkEnabled] = useState(false);
  const [watermarkCrop, setWatermarkCrop] = useState(null);

  const [videoDimensions, setVideoDimensions] = useState({ width: 0, height: 0 });
  const [videoDuration, setVideoDuration] = useState(0);

  // ── Auto Subtitles (AI) ────────────────────────────────────────────────
  const [autoSubtitles, setAutoSubtitles] = useState(false);

  // ── Audio ─────────────────────────────────────────────────────
  const [audioMode, setAudioMode] = useState('keep'); // 'keep'|'mute'|'replace'|'mix'
  const [audioFile, setAudioFile] = useState(null);
  const [audioVolume, setAudioVolume] = useState(0.3);

  // ── Feature 1: Horizontal Mirror ───────────────────────────────────
  const [mirrorEnabled, setMirrorEnabled] = useState(false);
  const [protectSubtitles, setProtectSubtitles] = useState(false);

  // ── Feature 2: Split-Screen Underlay ────────────────────────────
  const [splitScreenEnabled, setSplitScreenEnabled] = useState(false);
  const [splitDirection, setSplitDirection] = useState('vertical');
  const [splitOverlayVideo, setSplitOverlayVideo] = useState(null);

  // ── Feature 3: Border / Padding ──────────────────────────────────
  const [borderEnabled, setBorderEnabled] = useState(false);
  const [borderPadding, setBorderPadding] = useState(10);
  const [borderColor, setBorderColor] = useState('black');

  // ── Feature 4: Independent Pitch Shift (inside Audio panel) ────────────
  const [pitchShiftEnabled, setPitchShiftEnabled] = useState(false);
  const [pitchShiftSemitones, setPitchShiftSemitones] = useState(0);

  // ── Feature 5: Film Grain ─────────────────────────────────────────
  const [grainEnabled, setGrainEnabled] = useState(false);
  const [grainIntensity, setGrainIntensity] = useState(20);

  // ── Feature 6: Dynamic Zoom / Reframe ─────────────────────────────
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const [zoomDirection, setZoomDirection] = useState('zoom-in');
  const [zoomIntensity, setZoomIntensity] = useState('subtle');

  // ── Feature 7: FPS Conversion ──────────────────────────────────────
  const [fpsEnabled, setFpsEnabled] = useState(false);
  const [targetFps, setTargetFps] = useState(60);

  // ── Feature 8: Privacy / Face Blur ───────────────────────────────
  const [faceBlurEnabled, setFaceBlurEnabled] = useState(false);
  const [faceBlurStrength, setFaceBlurStrength] = useState(3);

  // ── Feature 9: Hue Rotation ──────────────────────────────────────
  const [hueEnabled, setHueEnabled] = useState(false);
  const [hueDegrees, setHueDegrees] = useState(10);

  // ── Feature 10: Micro-Tilt Rotation ──────────────────────────────
  const [tiltEnabled, setTiltEnabled] = useState(false);
  const [tiltAngle, setTiltAngle] = useState(1.0);

  // ── Feature 11: Audio Noise Floor ────────────────────────────────
  const [noiseFloorEnabled, setNoiseFloorEnabled] = useState(false);
  const [noiseFloorDb, setNoiseFloorDb] = useState(-38);

  // ── Feature 12: Temporal Frame Jitter ────────────────────────────
  const [frameJitterEnabled, setFrameJitterEnabled] = useState(false);
  const [frameJitterFrames, setFrameJitterFrames] = useState(2);

  // ── Feature 13: Variable Speed Ramp ──────────────────────────────
  const [speedRampEnabled, setSpeedRampEnabled] = useState(false);
  const [speedRampCurve, setSpeedRampCurve] = useState('wave');

  // ── Feature 14: Audio EQ Shift ───────────────────────────────────
  const [audioEqEnabled, setAudioEqEnabled] = useState(false);
  const [audioEqPreset, setAudioEqPreset] = useState('cut-low');

  // ── Feature 15: Vertical Crop Reframe ────────────────────────────
  const [vCropEnabled, setVCropEnabled] = useState(false);
  const [vCropPercent, setVCropPercent] = useState(3);
  const [vCropAxis, setVCropAxis] = useState('vertical');

  // ── Feature 16: Thumbnail Randomizer ─────────────────────────────
  const [thumbRandomEnabled, setThumbRandomEnabled] = useState(false);
  const [thumbIntroSeconds, setThumbIntroSeconds] = useState(0.5);

  // ── Feature 17: Container Re-Mux ─────────────────────────────────
  const [remuxEnabled, setRemuxEnabled] = useState(false);
  const [remuxFormat, setRemuxFormat] = useState('mkv');

  // ── Color grading ────────────────────────────────────────────────────
  const [colorPreset, setColorPreset] = useState('none');
  const [saturation, setSaturation] = useState(1.0);
  const [brightness, setBrightness] = useState(0.0);
  const [contrast, setContrast] = useState(1.0);

  // ── Captions ─────────────────────────────────────────────────────────
  const [captionText, setCaptionText] = useState('');
  const [captionPosition, setCaptionPosition] = useState('bottom');
  const [captionSize, setCaptionSize] = useState(36);
  const [captionColor, setCaptionColor] = useState('white');
  
  // ── Master Anti-AI Toggle ──────────────────────────────────────────────
  const [masterAntiAiEnabled, setMasterAntiAiEnabled] = useState(false);
  const handleMasterAntiAiToggle = (enabled) => {
    setMasterAntiAiEnabled(enabled);
    if (enabled) {
      setBorderEnabled(true);
      setZoomEnabled(true);
      setFpsEnabled(true);
      setHueEnabled(true);
      setTiltEnabled(true);
      setFrameJitterEnabled(true);
      setVCropEnabled(true);
      setThumbRandomEnabled(true);
    }
  };

  // ── Feature 19: AI Object Tracker ──────────────────────────────────────────────
  const [aiTrackerEnabled, setAiTrackerEnabled] = useState(false);
  const [aiTrackerCrop, setAiTrackerCrop] = useState(null);
  const [trackedObjects, setTrackedObjects] = useState([]);
  const [aiTrackerProfile, setAiTrackerProfile] = useState('BALANCED');
  const [aiTrackerShape, setAiTrackerShape] = useState('circle');
  const [aiTrackerColor, setAiTrackerColor] = useState('red');
  const [aiTrackerSize, setAiTrackerSize] = useState(50);

  // ── Interactive Overlays (Images, Text, Symbols) ──────────
  const [overlaysEnabled, setOverlaysEnabled] = useState(false);
  const [overlays, setOverlays] = useState([]);
  const fileOverlayInputRef = useRef(null);

  // ── Feature 20: Magnifying Glass (Time-Ranged Spotlight Zoom) ──────────────
  const [magnifyEnabled, setMagnifyEnabled] = useState(false);
  const [magnifyCrop, setMagnifyCrop] = useState(null);
  const [magnifyZoom, setMagnifyZoom] = useState(2.0);
  const [magnifyBlur, setMagnifyBlur] = useState(0);
  const [magnifyRangeEnabled, setMagnifyRangeEnabled] = useState(false);
  const [magnifyStart, setMagnifyStart] = useState('');
  const [magnifyEnd, setMagnifyEnd] = useState('');

  const addTextOverlay = () => {
    setOverlays([...overlays, {
      id: Math.random().toString(36).substring(7),
      type: 'text',
      content: 'New Text',
      x: 10, y: 10, width: 250, height: 'auto',
      color: '#ffffff',
      isBold: true,
      fontSize: 48,
      bgColor: 'transparent'
    }]);
  };

  const addSymbolOverlay = (val) => {
    if (val.startsWith('SHAPE:')) {
      const parts = val.split(':');
      const shapeType = parts[1];
      const defaultColor = parts[2] === 'red' ? '#ff0000' : '#ffffff';
      setOverlays([...overlays, {
        id: Math.random().toString(36).substring(7),
        type: 'shape',
        shapeType: shapeType,
        content: shapeType,
        x: 10, y: 10, width: shapeType === 'oval' ? 100 : 60, height: 60,
        color: defaultColor
      }]);
      return;
    }

    let symbol = val;
    let defaultColor = '#ffffff';
    if (val.startsWith('RED:')) {
      symbol = val.split(':')[1];
      defaultColor = '#ff0000';
    }
    
    setOverlays([...overlays, {
      id: Math.random().toString(36).substring(7),
      type: 'symbol',
      content: symbol,
      x: 10, y: 10, width: 60, height: 60,
      color: defaultColor,
      fontSize: 48
    }]);
  };

  const handleOverlayImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setOverlays([...overlays, {
        id: Math.random().toString(36).substring(7),
        type: 'image',
        content: url,
        file: file,
        x: 10, y: 10, width: 150, height: 150
      }]);
    }
    e.target.value = null; // reset
  };

  const updateOverlay = (id, newProps) => {
    setOverlays(overlays.map(o => o.id === id ? { ...o, ...newProps } : o));
  };
  
  const removeOverlay = (id) => {
    setOverlays(overlays.filter(o => o.id !== id));
  };

  // ── Video Preview Effects ─────────────────────────────────────────────
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = speedEnabled ? speed : 1.0;
    }
  }, [speed, speedEnabled, previewUrl]);

  // Pause video automatically when entering a draw mode
  useEffect(() => {
    if (activeDrawMode !== 'none' && videoRef.current) {
      videoRef.current.pause();
    }
  }, [activeDrawMode]);

  // ── Magnify Preview Sync & Time-Gating ────────────────────────────────
  useEffect(() => {
    const mainVid = videoRef.current;
    const magVid = magnifyVideoRef.current;
    if (!mainVid) return;
    
    // Define sync handlers at the top level of the effect so the cleanup function can access them
    const syncTime = () => {
      if (magVid && Math.abs(mainVid.currentTime - magVid.currentTime) > 0.1) {
        magVid.currentTime = mainVid.currentTime;
      }
    };
    const syncPlay = () => { if (magVid) magVid.play().catch(e => console.warn(e)); };
    const syncPause = () => { if (magVid) magVid.pause(); };

    // Sync playback state
    if (magVid) {
      mainVid.addEventListener('seeked', syncTime);
      mainVid.addEventListener('timeupdate', syncTime);
      mainVid.addEventListener('play', syncPlay);
      mainVid.addEventListener('pause', syncPause);
      
      // Ensure initial sync
      syncTime();
      if (!mainVid.paused) syncPlay();
    }
    
    // Time-gating for the preview container
    const handleTimeUpdate = () => {
      if (magnifyPreviewRef.current && magnifyEnabled && magnifyCrop) {
        const t = mainVid.currentTime;
        let visible = true;
        if (magnifyRangeEnabled) {
          const s = parseFloat(magnifyStart) || 0;
          const e = magnifyEnd && magnifyEnd !== '' ? parseFloat(magnifyEnd) : mainVid.duration;
          if (t < s || t > e) visible = false;
        }
        magnifyPreviewRef.current.style.opacity = visible ? '1' : '0';
      }
    };
    mainVid.addEventListener('timeupdate', handleTimeUpdate);
    handleTimeUpdate(); // Init state

    return () => {
      if (magVid) {
        mainVid.removeEventListener('seeked', syncTime);
        mainVid.removeEventListener('timeupdate', syncTime);
        mainVid.removeEventListener('play', syncPlay);
        mainVid.removeEventListener('pause', syncPause);
      }
      mainVid.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [magnifyEnabled, magnifyCrop, magnifyRangeEnabled, magnifyStart, magnifyEnd, previewUrl, activeDrawMode]);

  // ── Handle Tab Close Cancellation ─────────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (processing && activeJobId) {
        // Use sendBeacon to reliably send a POST request even as the page unloads
        const cancelUrl = `${API_URL}/cancel/${activeJobId}`;
        navigator.sendBeacon(cancelUrl);
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [processing, activeJobId]);

  const previewFilter = useMemo(() => {
    if (!colorEnabled) return 'none';
    let f = '';
    if (colorPreset === 'warm') f += 'sepia(0.3) saturate(1.2) hue-rotate(-10deg) ';
    else if (colorPreset === 'cool') f += 'sepia(0.2) saturate(0.9) hue-rotate(180deg) ';
    else if (colorPreset === 'vivid') f += 'saturate(1.5) contrast(1.1) ';
    else if (colorPreset === 'cinematic') f += 'contrast(1.2) saturate(0.8) sepia(0.1) ';
    else if (colorPreset === 'vintage') f += 'sepia(0.6) contrast(0.9) brightness(0.9) ';
    
    f += `saturate(${saturation}) brightness(${1 + brightness}) contrast(${contrast})`;
    return f;
  }, [colorEnabled, colorPreset, saturation, brightness, contrast]);

  const fileInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const splitOverlayInputRef = useRef(null);
  const downloadingRef = useRef(false);
  const processingRef = useRef(false);
  const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3001/api' : 'https://video-processor-api-new.onrender.com/api');

  const isVideo = videoFile?.type?.startsWith('video/');

  // ── File handlers ─────────────────────────────────────────────────────
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setVideoFile(file);
      setOutputUrl('');
      setProgress(0);
      setError('');
      setMessage('File selected. Configure your transformations below and click Process.');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsHovering(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setVideoFile(file);
      setOutputUrl('');
      setProgress(0);
      setError('');
      setMessage('File selected. Configure your transformations below and click Process.');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsHovering(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setIsHovering(false); };

  // ── Status polling (exponential backoff) ────────────────────────────────
  const pollStatus = async (jobId, interval = 800, lastSeenProgress = -1) => {
    try {
      const res = await fetch(`${API_URL}/status/${jobId}`);
      if (!res.ok) throw new Error('Failed to get status');
      const data = await res.json();

      // If user cancelled manually, stop polling
      if (!processingRef.current) return;

      if (data.status === 'failed') throw new Error(data.error || 'Processing failed');

      const currentProgress = data.progress || 0;
      setProgress(currentProgress);
      
      if (data.status === 'queued') {
        setMessage(data.position > 0 ? `Waiting in queue... Position: ${data.position}` : 'Queued for processing...');
      } else if (data.status === 'completed') {
        setMessage('Done! Your video is ready to download.');
        setOutputUrl(`${API_URL}/download/${jobId}`);
        setProcessing(false);
      } else {
        setMessage(`Processing: ${currentProgress}%`);
      }

      if (data.status !== 'completed') {
        const progressMoved = currentProgress > lastSeenProgress;
        const nextInterval = progressMoved ? 800 : Math.min(interval * 2, 3000);
        setTimeout(() => pollStatus(jobId, nextInterval, currentProgress), nextInterval);
      }
    } catch (err) {
      setError(err.message);
      setProcessing(false);
    }
  };

  // ── Process video ─────────────────────────────────────────────────────
  const processVideo = async () => {
    if (!videoFile) return;

    setProcessing(true);
    processingRef.current = true;
    setProgress(0);
    setError('');
    setOutputUrl('');
    setActiveJobId(null);
    setMessage('Uploading file...');

    try {
      const formData = new FormData();
      formData.append('file', videoFile);
      formData.append('mode', mode);

      // Metadata (always sent)
      formData.append('title', metaTitle);
      formData.append('author', metaAuthor);
      formData.append('comment', metaComment);
      formData.append('copyright', metaCopyright);
      formData.append('creationTime', metaCreationTime);

      if (mode === 'transform') {
        // Trim
        if (trimEnabled) {
          if (trimStart !== '') formData.append('trimStart', trimStart);
          if (trimEnd !== '') formData.append('trimEnd', trimEnd);
        }

        // Crop
        if (cropEnabled && crop && videoDimensions.width > 0 && crop.width > 0 && crop.height > 0) {
          formData.append('cropEnabled', 'true');
          formData.append('cropWidth', Math.round((crop.width / 100) * videoDimensions.width));
          formData.append('cropHeight', Math.round((crop.height / 100) * videoDimensions.height));
          formData.append('cropX', Math.round((crop.x / 100) * videoDimensions.width));
          formData.append('cropY', Math.round((crop.y / 100) * videoDimensions.height));
        } else {
          formData.append('cropEnabled', 'false');
        }

        // Watermark
        if (watermarkEnabled && watermarkCrop && videoDimensions.width > 0 && watermarkCrop.width > 0 && watermarkCrop.height > 0) {
          formData.append('watermarkEnabled', 'true');
          formData.append('watermarkWidth', Math.round((watermarkCrop.width / 100) * videoDimensions.width));
          formData.append('watermarkHeight', Math.round((watermarkCrop.height / 100) * videoDimensions.height));
          formData.append('watermarkX', Math.round((watermarkCrop.x / 100) * videoDimensions.width));
          formData.append('watermarkY', Math.round((watermarkCrop.y / 100) * videoDimensions.height));
        } else {
          formData.append('watermarkEnabled', 'false');
        }

        // Speed
        formData.append('speed', speedEnabled ? speed : 1.0);

        // Color
        formData.append('colorPreset', colorEnabled ? colorPreset : 'none');
        formData.append('saturation', colorEnabled ? saturation : 1.0);
        formData.append('brightness', colorEnabled ? brightness : 0.0);
        formData.append('contrast', colorEnabled ? contrast : 1.0);

        // Captions
        formData.append('captionText', captionEnabled ? captionText : '');
        formData.append('captionPosition', captionPosition);
        formData.append('captionSize', captionSize);
        formData.append('captionColor', captionColor);

        // Auto Subtitles
        formData.append('autoSubtitles', autoSubtitles);

        // Audio
        formData.append('audioMode', audioEnabled ? audioMode : 'keep');
        formData.append('audioVolume', audioVolume);
        if (audioEnabled && audioFile && (audioMode === 'replace' || audioMode === 'mix')) {
          formData.append('audio', audioFile);
        }

        // ── Feature 1: Mirror ────────────────────────────────────────────
        formData.append('mirrorEnabled', mirrorEnabled);
        formData.append('protectSubtitles', protectSubtitles);

        // ── Feature 2: Split-Screen ──────────────────────────────────────
        formData.append('splitScreenEnabled', splitScreenEnabled);
        formData.append('splitDirection', splitDirection);
        if (splitScreenEnabled && splitOverlayVideo) {
          formData.append('splitOverlayVideo', splitOverlayVideo);
        }


        // ── AI Tracker Feature ──────────────────────────────────────────────
        formData.append('aiTrackerEnabled', aiTrackerEnabled);
        if (aiTrackerEnabled && trackedObjects.length > 0) {
           formData.append('trackedObjects', JSON.stringify(trackedObjects));
        }

        // ── Feature 3: Border / Padding ──────────────────────────────────
        formData.append('borderEnabled', borderEnabled);
        formData.append('borderPadding', borderPadding);
        formData.append('borderColor', borderColor);

        // ── Feature 4: Pitch Shift (audio sub-feature) ───────────────────
        formData.append('pitchShiftEnabled', audioEnabled && pitchShiftEnabled);
        formData.append('pitchShiftSemitones', pitchShiftSemitones);

        // ── Feature 5: Film Grain ────────────────────────────────────────
        formData.append('grainEnabled', grainEnabled);
        formData.append('grainIntensity', grainIntensity);

        // ── Feature 6: Dynamic Zoom ──────────────────────────────────────
        formData.append('zoomEnabled', zoomEnabled);
        formData.append('zoomDirection', zoomDirection);
        formData.append('zoomIntensity', zoomIntensity);

        // ── Feature 7: FPS Conversion ────────────────────────────────────
        formData.append('fpsEnabled', fpsEnabled);
        formData.append('targetFps', targetFps);

        // ── Feature 8: Face / Privacy Blur ───────────────────────────────
        formData.append('faceBlurEnabled', faceBlurEnabled);
        formData.append('faceBlurStrength', faceBlurStrength);

        // ── Tier 2 Features ──────────────────────────────────────────────
        formData.append('hueEnabled', hueEnabled);
        formData.append('hueDegrees', hueDegrees);

        formData.append('tiltEnabled', tiltEnabled);
        formData.append('tiltAngle', tiltAngle);

        formData.append('noiseFloorEnabled', audioEnabled && noiseFloorEnabled);
        formData.append('noiseFloorDb', noiseFloorDb);

        formData.append('frameJitterEnabled', frameJitterEnabled);
        formData.append('frameJitterFrames', frameJitterFrames);

        formData.append('speedRampEnabled', speedRampEnabled);
        formData.append('speedRampCurve', speedRampCurve);

        formData.append('audioEqEnabled', audioEnabled && audioEqEnabled);
        formData.append('audioEqPreset', audioEqPreset);

        formData.append('vCropEnabled', vCropEnabled);
        formData.append('vCropPercent', vCropPercent);
        formData.append('vCropAxis', vCropAxis);

        formData.append('thumbRandomEnabled', thumbRandomEnabled);
        formData.append('thumbIntroSeconds', thumbIntroSeconds);

        formData.append('remuxEnabled', remuxEnabled);
        formData.append('remuxFormat', remuxFormat);

        // ── Interactive Overlays ──────────────────────────────────────────
        formData.append('overlaysEnabled', overlaysEnabled);
        if (overlaysEnabled && overlays.length > 0) {
          const processedOverlays = [];
          const containerWidth = previewContainerRef.current ? previewContainerRef.current.clientWidth : videoDimensions.width;
          const containerHeight = previewContainerRef.current ? previewContainerRef.current.clientHeight : videoDimensions.height;
          
          for (const o of overlays) {
            if (o.type === 'image' && o.file) {
              processedOverlays.push({
                 id: o.id,
                 type: 'image',
                 file: o.file,
                 xPct: containerWidth ? (o.x / containerWidth) * 100 : 0,
                 yPct: containerHeight ? (o.y / containerHeight) * 100 : 0,
                 widthPct: containerWidth ? (o.width / containerWidth) * 100 : 0,
                 heightPct: containerHeight ? (o.height / containerHeight) * 100 : 0
              });
            } else if ((o.type === 'text' || o.type === 'symbol' || o.type === 'shape') && o.content) {
              const canvas = document.createElement('canvas');
              const w = o.width || 100;
              const h = o.height || 50;
              canvas.width = w * 2;
              canvas.height = h * 2;
              const ctx = canvas.getContext('2d');
              ctx.scale(2, 2);
              ctx.textBaseline = 'top';
              ctx.fillStyle = o.color || '#ffffff';
              
              if (o.type === 'shape') {
                  ctx.strokeStyle = o.color || '#ff0000';
                  ctx.fillStyle = o.color || '#ff0000';
                  ctx.lineWidth = 3; 
                  
                  if (o.shapeType === 'circle' || o.shapeType === 'oval') {
                     ctx.beginPath();
                     ctx.ellipse(w/2, h/2, (w/2)*0.9, (h/2)*0.9, 0, 0, 2 * Math.PI);
                     ctx.stroke();
                  } else if (o.shapeType === 'arrow-down') {
                     ctx.beginPath();
                     ctx.moveTo(w*0.4, h*0.1);
                     ctx.lineTo(w*0.6, h*0.1);
                     ctx.lineTo(w*0.6, h*0.6);
                     ctx.lineTo(w*0.8, h*0.6);
                     ctx.lineTo(w*0.5, h*0.9);
                     ctx.lineTo(w*0.2, h*0.6);
                     ctx.lineTo(w*0.4, h*0.6);
                     ctx.closePath();
                     ctx.fill();
                  }
              } else if (o.type === 'symbol') {
                  let fontSize = Math.floor(h * 0.9);
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  ctx.font = `${fontSize}px sans-serif`;
                  ctx.fillText(o.content, w / 2, h / 2);
              } else if (o.type === 'text') {
                  const fontSize = o.fontSize || 48;
                  ctx.font = `${o.isBold !== false ? 'bold ' : ''}${fontSize}px sans-serif`;
                  
                  const paragraphs = o.content.split('\n');
                  const lines = [];
                  for (const p of paragraphs) {
                      const words = p.split(' ');
                      let currentLine = '';
                      for (let i = 0; i < words.length; i++) {
                          const testLine = currentLine + (currentLine ? ' ' : '') + words[i];
                          if (ctx.measureText(testLine).width > w && i > 0) {
                              lines.push(currentLine);
                              currentLine = words[i];
                          } else {
                              currentLine = testLine;
                          }
                      }
                      if (currentLine) lines.push(currentLine);
                  }
                  
                  const lineHeight = fontSize * 1.2;
                  const actualHeight = lines.length * lineHeight;
                  
                  // Add padding to actualHeight and canvas size if bgColor is used
                  const padding = (o.bgColor && o.bgColor !== 'transparent') ? fontSize * 0.2 : 0;
                  
                  // Re-initialize canvas height for text to fit content
                  canvas.width = (w + padding * 2) * 2;
                  canvas.height = (actualHeight + padding * 2) * 2;
                  ctx.scale(2, 2);
                  ctx.textBaseline = 'top';
                  
                  if (o.bgColor && o.bgColor !== 'transparent') {
                      ctx.fillStyle = o.bgColor;
                      ctx.fillRect(0, 0, w + padding * 2, actualHeight + padding * 2);
                  }
                  
                  ctx.fillStyle = o.color || '#ffffff';
                  ctx.font = `${o.isBold !== false ? 'bold ' : ''}${fontSize}px sans-serif`;
                  
                  for (let i = 0; i < lines.length; i++) {
                     ctx.fillText(lines[i], padding, padding + (lineHeight * i));
                  }
                  
                  // Store the calculated height so it's exported correctly
                  o.calculatedHeight = actualHeight + padding * 2;
                  o.calculatedWidth = w + padding * 2;
              }
              
              const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
              
              processedOverlays.push({
                 id: o.id,
                 type: 'image', // Send as image so backend processes it seamlessly
                 file: blob,
                 xPct: containerWidth ? (o.x / containerWidth) * 100 : 0,
                 yPct: containerHeight ? (o.y / containerHeight) * 100 : 0,
                 widthPct: containerWidth ? ((o.calculatedWidth || w) / containerWidth) * 100 : 0,
                 heightPct: containerHeight ? ((o.calculatedHeight || h) / containerHeight) * 100 : 0
              });
            }
          }
          
          if (processedOverlays.length > 0) {
             const overlayConfigs = processedOverlays.map(o => ({
                id: o.id,
                type: o.type,
                xPct: o.xPct,
                yPct: o.yPct,
                widthPct: o.widthPct,
                heightPct: o.heightPct
             }));
             formData.append('overlaysData', JSON.stringify(overlayConfigs));
             
             processedOverlays.forEach((o) => {
                if (o.file) {
                  formData.append(`overlayImage_${o.id}`, o.file, `overlay_${o.id}.png`);
                }
             });
          }
        }

        // ── Feature 20: Magnifying Glass ──────────────────────────────────────
        formData.append('magnifyEnabled', magnifyEnabled);
        if (magnifyEnabled && magnifyCrop && videoDimensions.width > 0) {
          formData.append('magnifyCropX', magnifyCrop.x);
          formData.append('magnifyCropY', magnifyCrop.y);
          formData.append('magnifyCropW', magnifyCrop.width);
          formData.append('magnifyCropH', magnifyCrop.height);
          formData.append('magnifyZoom', magnifyZoom);
          formData.append('magnifyBlur', magnifyBlur);
          if (magnifyRangeEnabled) {
            formData.append('magnifyStart', magnifyStart);
            formData.append('magnifyEnd', magnifyEnd);
          }
        }
      } // end if (mode === 'transform')

      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_URL}/upload`);
        
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setProgress(percent);
            setMessage(`Uploading: ${percent}%`);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (err) {
              reject(new Error('Invalid server response'));
            }
          } else {
            let errorMsg = 'Upload failed';
            try {
              errorMsg = JSON.parse(xhr.responseText).error || errorMsg;
            } catch (e) {}
            reject(new Error(errorMsg));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload (connection closed or timed out)'));
        xhr.onabort = () => reject(new Error('Upload aborted'));
        
        xhr.send(formData);
      });

      setMessage('File queued for processing...');
      setProgress(0); // Reset progress bar for the processing phase
      setActiveJobId(data.jobId);
      pollStatus(data.jobId);

    } catch (err) {
      setError(err.message);
      setProcessing(false);
      processingRef.current = false;
      setActiveJobId(null);
    }
  };

  const handleCancelJob = async () => {
    if (!activeJobId) return;
    try {
      await fetch(`${API_URL}/cancel/${activeJobId}`, { method: 'POST' });
    } catch (e) {
      console.error('Failed to cancel job:', e);
    }
    setProcessing(false);
    processingRef.current = false;
    setActiveJobId(null);
    setProgress(0);
    setMessage('Processing cancelled by user.');
  };

  // ── Download ──────────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!outputUrl || downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    setMessage('Downloading file...');
    try {
      const res = await fetch(outputUrl);
      if (!res.ok) throw new Error('Download failed — server returned ' + res.status);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `processed_${videoFile?.name || 'file'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setMessage('Download complete! ✅');
    } catch (err) {
      setError('Download failed: ' + err.message);
    }
    setDownloading(false);
    downloadingRef.current = false;
  };

  // ── Reset ─────────────────────────────────────────────────────────────
  const resetAll = () => {
    setVideoFile(null);
    setOutputUrl('');
    setError('');
    setMessage('');
    setProgress(0);
    setActiveJobId(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    setMetaTitle(''); setMetaAuthor(''); setMetaComment('');
    setMetaCopyright(''); setMetaCreationTime('');
    setTrimEnabled(false); setTrimStart(''); setTrimEnd('');
    setCropEnabled(false); setCrop(null);
    setWatermarkEnabled(false); setWatermarkCrop(null);
    setActiveDrawMode('none');
    setSpeedEnabled(false); setSpeed(1.0);
    setColorEnabled(false); setColorPreset('none');
    setSaturation(1.0); setBrightness(0.0); setContrast(1.0);
    setCaptionEnabled(false); setCaptionText(''); setCaptionPosition('bottom'); setCaptionSize(36); setCaptionColor('white');
    setAutoSubtitles(false);
    setAudioEnabled(false); setAudioMode('keep');
    setAudioFile(null); setAudioVolume(0.3);
    // New features
    setMirrorEnabled(false);
    setSplitScreenEnabled(false); setSplitDirection('vertical'); setSplitOverlayVideo(null);
    setBorderEnabled(false); setBorderPadding(10); setBorderColor('black');
    setPitchShiftEnabled(false); setPitchShiftSemitones(0);
    setGrainEnabled(false); setGrainIntensity(20);
    setZoomEnabled(false); setZoomDirection('zoom-in'); setZoomIntensity('subtle');
    setFpsEnabled(false); setTargetFps(60);
    setFaceBlurEnabled(false); setFaceBlurStrength(3);
    // Tier 2 new features
    setHueEnabled(false); setHueDegrees(10);
    setTiltEnabled(false); setTiltAngle(1.0);
    setNoiseFloorEnabled(false); setNoiseFloorDb(-38);
    setFrameJitterEnabled(false); setFrameJitterFrames(2);
    setSpeedRampEnabled(false); setSpeedRampCurve('wave');
    setAudioEqEnabled(false); setAudioEqPreset('cut-low');
    setVCropEnabled(false); setVCropPercent(3); setVCropAxis('vertical');
    setThumbRandomEnabled(false); setThumbIntroSeconds(0.5);
    setRemuxEnabled(false); setRemuxFormat('mkv');
    // ── Feature 20: Magnifying Glass ──────────────────────────────────────
    setMagnifyEnabled(false); setMagnifyCrop(null); setMagnifyZoom(2.0); setMagnifyBlur(20);
    setMagnifyRangeEnabled(false); setMagnifyStart(''); setMagnifyEnd('');

  };

  const activeFeatures = [
    trimEnabled, cropEnabled, speedEnabled, colorEnabled, captionEnabled,
    autoSubtitles, audioEnabled, mirrorEnabled, splitScreenEnabled,
    borderEnabled, grainEnabled, zoomEnabled, fpsEnabled, faceBlurEnabled,
    hueEnabled, tiltEnabled, noiseFloorEnabled, frameJitterEnabled,
    speedRampEnabled, audioEqEnabled, vCropEnabled, thumbRandomEnabled, remuxEnabled,
    magnifyEnabled
  ].filter(Boolean).length;

  // ── COLOR PRESETS ─────────────────────────────────────────────────────
  const COLOR_PRESETS = [
    { id: 'none',      label: 'None',      emoji: '⬜' },
    { id: 'warm',      label: 'Warm',      emoji: '🔆' },
    { id: 'cool',      label: 'Cool',      emoji: '❄️' },
    { id: 'vivid',     label: 'Vivid',     emoji: '🌈' },
    { id: 'cinematic', label: 'Cinematic', emoji: '🎬' },
    { id: 'vintage',   label: 'Vintage',   emoji: '📼' },
  ];



  // ── RENDER ────────────────────────────────────────────────────────────
  return (
    <div className="app-container">

      {/* ── Slim Top Header ── */}
      <div className="app-header">
        <div className="app-header-logo">
          <h1>✨ Lumina</h1>
          <span className="app-header-badge">Video Studio</span>
        </div>
        <p className="subtitle">Trim · Reframe · Retime · Recolor · Caption · Remix Audio · Scrub Metadata</p>
      </div>

      {/* ── App Body ── */}
      <div className="app-body">

      {/* Drop Zone */}
      {!videoFile && !outputUrl && (
        <div className="drop-zone-wrapper">
        <div
          className={`drop-zone ${isHovering ? 'active' : ''}`}
          style={{ maxWidth: 560, width: '100%' }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="drop-zone-inner">
            <div className="drop-icon">📁</div>
            <p className="drop-title">Drop your video here</p>
            <p className="drop-hint">or click to browse — MP4, MOV, AVI, MKV, WEBM up to 500MB</p>
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }}
            accept="video/*,.mkv,.avi,.wmv,.flv" />
        </div>
        </div>
      )}

      {/* Workspace Wrapper */}
      {videoFile && !outputUrl && (
        <div className="workspace">
          
          {/* Preview Pane */}
          <div className="preview-pane">
            <div 
              className="video-container" 
              ref={previewContainerRef}
              style={videoDimensions.width ? { aspectRatio: `${videoDimensions.width} / ${videoDimensions.height}` } : {}}
            >
              {previewUrl && (
                  <ReactCrop
                    crop={activeDrawMode === 'watermark' ? watermarkCrop : (activeDrawMode === 'ai-tracker' ? aiTrackerCrop : (activeDrawMode === 'crop' ? crop : (activeDrawMode === 'magnify' ? magnifyCrop : undefined)))}
                    circularCrop={activeDrawMode === 'magnify'}
                    keepSelection={activeDrawMode === 'magnify'}
                    onChange={(c, percentCrop) => {
                      if (activeDrawMode === 'watermark') setWatermarkCrop(percentCrop);
                      else if (activeDrawMode === 'ai-tracker') setAiTrackerCrop(percentCrop);
                      else if (activeDrawMode === 'crop') setCrop(percentCrop);
                      else if (activeDrawMode === 'magnify') setMagnifyCrop(percentCrop);
                    }}
                    disabled={processing || activeDrawMode === 'none'}
                    className={`video-crop-wrapper ${activeDrawMode === 'none' ? 'crop-hidden' : ''}`}
                    style={{ width: '100%', height: '100%', margin: 'auto' }}
                  >
                    <video
                      ref={videoRef}
                      src={previewUrl}
                      className="video-element"
                      style={{ filter: previewFilter, transform: mirrorEnabled ? 'scaleX(-1)' : 'none' }}
                      controls={activeDrawMode === 'none'}
                      loop
                      autoPlay
                      muted
                      onLoadedMetadata={(e) => {
                        setVideoDimensions({
                          width: e.target.videoWidth,
                          height: e.target.videoHeight
                        });
                        setVideoDuration(e.target.duration);
                      }}
                    />
                  </ReactCrop>
              )}
              
              {/* Live Preview for Magnifying Glass */}
              {magnifyEnabled && magnifyCrop && magnifyCrop.width > 0 && magnifyCrop.height > 0 && previewUrl && (() => {
                // All magnifyCrop values are percentages (0-100)
                const cx = magnifyCrop.x + magnifyCrop.width / 2;  // center X in %
                const cy = magnifyCrop.y + magnifyCrop.height / 2; // center Y in %
                const zoom = magnifyZoom;

                const vidW = (10000 / magnifyCrop.width) * zoom;
                const vidH = (10000 / magnifyCrop.height) * zoom;

                const vidLeft = 50 - (cx / 100) * vidW;
                const vidTop = 50 - (cy / 100) * vidH;

                console.log('[MAGNIFY DEBUG]', {
                  crop: magnifyCrop,
                  cx, cy, zoom,
                  vidW, vidH, vidLeft, vidTop,
                  containerPos: { top: `${magnifyCrop.y}%`, left: `${magnifyCrop.x}%`, width: `${magnifyCrop.width}%`, height: `${magnifyCrop.height}%` }
                });

                return (
                  <div
                    ref={magnifyPreviewRef}
                    className="magnify-preview-container"
                    style={{
                      position: 'absolute',
                      top: `${magnifyCrop.y}%`,
                      left: `${magnifyCrop.x}%`,
                      width: `${magnifyCrop.width}%`,
                      height: `${magnifyCrop.height}%`,
                      borderRadius: '50%',
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      zIndex: 10,
                      boxShadow: 'inset 0 0 0 6px red',
                    }}
                  >
                    <video
                      ref={magnifyVideoRef}
                      src={previewUrl}
                      style={{
                        position: 'absolute',
                        width: `${vidW}%`,
                        height: `${vidH}%`,
                        left: `${vidLeft}%`,
                        top: `${vidTop}%`,
                        filter: previewFilter,
                        objectFit: 'fill',
                      }}
                      muted
                    />
                  </div>
                );
              })()}

              {overlaysEnabled && overlays.map(overlay => (
                <Rnd
                  key={overlay.id}
                  bounds="parent"
                  position={{ x: overlay.x, y: overlay.y }}
                  size={{ width: overlay.width, height: overlay.type === 'text' ? 'auto' : overlay.height }}
                  onDragStop={(e, d) => updateOverlay(overlay.id, { x: d.x, y: d.y })}
                  onResizeStop={(e, direction, ref, delta, position) => {
                    if (overlay.type === 'text') {
                      updateOverlay(overlay.id, {
                        width: parseInt(ref.style.width, 10),
                        ...position,
                      });
                    } else {
                      updateOverlay(overlay.id, {
                        width: parseInt(ref.style.width, 10),
                        height: parseInt(ref.style.height, 10),
                        ...position,
                      });
                    }
                  }}
                  className={`overlay-rnd ${overlay.type === 'text' || overlay.type === 'symbol' ? 'overlay-rnd-text' : ''}`}
                >
                  {overlay.type === 'image' && <img src={overlay.content} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} alt="" />}
                  {overlay.type === 'shape' && (
                     <svg width="100%" height="100%" preserveAspectRatio="none" style={{ pointerEvents: 'none' }}>
                       {(overlay.shapeType === 'circle' || overlay.shapeType === 'oval') && (
                         <ellipse cx="50%" cy="50%" rx="45%" ry="45%" fill="none" stroke={overlay.color} strokeWidth="3" />
                       )}
                       {overlay.shapeType === 'arrow-down' && (
                         <polygon points="40,10 60,10 60,60 80,60 50,90 20,60 40,60" fill={overlay.color} transform={`scale(${overlay.width/100}, ${overlay.height/100})`} />
                       )}
                     </svg>
                  )}
                  {(overlay.type === 'text' || overlay.type === 'symbol') && (
                    <div style={{ 
                      width: '100%', 
                      height: '100%', 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: overlay.type === 'symbol' ? 'center' : 'flex-start', 
                      color: overlay.color, 
                      fontWeight: overlay.type === 'text' && overlay.isBold !== false ? 'bold' : 'normal',
                      fontSize: `${overlay.type === 'symbol' ? Math.floor(overlay.height * 0.9) : (overlay.fontSize || 48)}px`,
                      lineHeight: overlay.type === 'symbol' ? 1 : 1.2,
                      paddingTop: 0,
                      textShadow: (!overlay.bgColor || overlay.bgColor === 'transparent') ? '1px 1px 2px black' : 'none',
                      backgroundColor: (overlay.bgColor && overlay.bgColor !== 'transparent') ? overlay.bgColor : 'transparent',
                      padding: (overlay.bgColor && overlay.bgColor !== 'transparent') ? `${(overlay.fontSize || 48) * 0.2}px` : '0',
                      pointerEvents: 'none',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      overflow: 'visible',
                      boxSizing: 'content-box'
                    }}>
                      {overlay.content}
                    </div>
                  )}
                  <button className="overlay-delete-btn" onClick={(e) => { e.stopPropagation(); e.preventDefault(); removeOverlay(overlay.id); }}>✕</button>
                </Rnd>
              ))}
              {captionEnabled && captionText && (
                <div
                  className="caption-overlay"
                  data-position={captionPosition}
                  style={{
                    fontSize: `${captionSize}px`,
                    color: captionColor,
                  }}
                >
                  {captionText}
                </div>
              )}
            </div>
            {previewUrl && (
              <div className="global-timeline-wrapper">
                <VideoTimeline 
                  videoUrl={previewUrl}
                  duration={videoDuration}
                  trimStart={trimStart}
                  trimEnd={trimEnd}
                  onTrimStartChange={(val) => { setTrimStart(val); setTrimEnabled(true); }}
                  onTrimEndChange={(val) => { setTrimEnd(val); setTrimEnabled(true); }}
                />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="controls">

          {/* File info + mode toggle */}
          <div className="file-info-row">
            <div className="file-info-left">
              <div className="file-chip">
                <span>🎥</span>
                <span className="file-chip-name">{videoFile.name}</span>
                <span className="file-chip-size">({(videoFile.size / 1024 / 1024).toFixed(1)} MB)</span>
              </div>
            </div>
            <button className="btn btn-ghost" onClick={resetAll} disabled={processing}>
              ✕ Change
            </button>
          </div>

          {/* Mode Selector */}
          <div className="mode-selector">
            <button
              className={`mode-btn ${mode === 'metadata' ? 'active' : ''}`}
              onClick={() => setMode('metadata')}
              disabled={processing}
            >
              <span>🏷️</span>
              <span>Metadata Only</span>
              <span className="mode-desc">Fast · No re-encode</span>
            </button>
            <button
              className={`mode-btn ${mode === 'transform' ? 'active' : ''}`}
              onClick={() => setMode('transform')}
              disabled={processing}
            >
              <span>🎬</span>
              <span>Full Transform</span>
              <span className="mode-desc">Re-encode · All features</span>
            </button>
          </div>

          {/* Transform Feature Panels (only in transform mode) */}
          {mode === 'transform' && (
            <div className="feature-panels">
              {activeFeatures > 0 && (
                <div className="features-active-bar">
                  {activeFeatures} feature{activeFeatures > 1 ? 's' : ''} active
                </div>
              )}

              {/* Tabs Navigation */}
              <div className="tabs-nav">
                <button className={`tab-btn ${activeTab === 'basic' ? 'active' : ''}`} onClick={() => setActiveTab('basic')}>🛠️ Basic</button>
                <button className={`tab-btn ${activeTab === 'video' ? 'active' : ''}`} onClick={() => setActiveTab('video')}>🎬 Video</button>
                <button className={`tab-btn ${activeTab === 'audio' ? 'active' : ''}`} onClick={() => setActiveTab('audio')}>🎵 Audio</button>
                <button className={`tab-btn ${activeTab === 'anti-ai' ? 'active' : ''}`} onClick={() => setActiveTab('anti-ai')}>🛡️ Anti-AI</button>
                <button className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>📦 Export</button>
              </div>

              {/* Tab Contents */}
              <div className="tab-content">

                {activeTab === 'basic' && (
                  <>
              <AccordionPanel icon="✂️" title="Trim Video" defaultOpen={false} badge={trimEnabled && (trimStart || trimEnd) ? `${trimStart || '0'}s – ${trimEnd || 'end'}` : null}
                enabled={trimEnabled} onToggleEnabled={setTrimEnabled}>
                <p className="panel-hint">Set the start and end time (in seconds) to extract a clip. You can also drag the handles on the main video timeline below!</p>
                <div className="input-row" style={{ marginTop: '1rem' }}>
                  <div className="input-group">
                    <label>Start (seconds)</label>
                    <input
                      type="number" min="0" step="0.1" placeholder="e.g. 5"
                      value={trimStart}
                      onChange={e => setTrimStart(e.target.value)}
                      disabled={processing || !trimEnabled}
                    />
                    {trimStart && <span className="input-aside">{secondsToMMSS(trimStart)}</span>}
                  </div>
                  <div className="input-group">
                    <label>End (seconds)</label>
                    <input
                      type="number" min="0" step="0.1" placeholder="e.g. 30"
                      value={trimEnd}
                      onChange={e => setTrimEnd(e.target.value)}
                      disabled={processing || !trimEnabled}
                    />
                    {trimEnd && <span className="input-aside">{secondsToMMSS(trimEnd)}</span>}
                  </div>
                </div>
              </AccordionPanel>

              <AccordionPanel icon="📐" title="Manual Crop" defaultOpen={false}
                badge={cropEnabled && crop ? `Cropped` : null}
                enabled={cropEnabled} onToggleEnabled={(val) => {
                  setCropEnabled(val);
                  if (val) setActiveDrawMode('crop');
                  else if (watermarkEnabled) setActiveDrawMode('watermark');
                  else setActiveDrawMode('none');
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                  <p className="panel-hint" style={{ margin: 0 }}>Select the area you want to keep.</p>
                  <button 
                    className={`preset-chip ${activeDrawMode === 'crop' ? 'active' : ''}`}
                    onClick={() => setActiveDrawMode('crop')}
                    disabled={!cropEnabled || processing}
                  >
                    {activeDrawMode === 'crop' ? 'Drawing...' : 'Draw Box'}
                  </button>
                </div>
                {cropEnabled && activeDrawMode === 'crop' && !crop && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#f0f0f0', borderRadius: '8px', color: '#555', fontSize: '0.9rem' }}>
                    Tip: Click and drag on the video player above to draw a crop box.
                  </div>
                )}
                {cropEnabled && crop && videoDimensions.width > 0 && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#e6f7ff', borderRadius: '8px', color: '#005bb5', fontSize: '0.9rem' }}>
                    <strong>Crop Area:</strong> {Math.round((crop.width / 100) * videoDimensions.width)} × {Math.round((crop.height / 100) * videoDimensions.height)} px
                  </div>
                )}
              </AccordionPanel>

              <AccordionPanel icon="💧" title="Watermark Remover" defaultOpen={false}
                badge={watermarkEnabled && watermarkCrop ? `Active` : null}
                enabled={watermarkEnabled} onToggleEnabled={(val) => {
                  setWatermarkEnabled(val);
                  if (val) setActiveDrawMode('watermark');
                  else if (cropEnabled) setActiveDrawMode('crop');
                  else setActiveDrawMode('none');
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
                  <p className="panel-hint" style={{ margin: 0 }}>Select the watermark to remove.</p>
                  <button 
                    className={`preset-chip ${activeDrawMode === 'watermark' ? 'active' : ''}`}
                    onClick={() => setActiveDrawMode('watermark')}
                    disabled={!watermarkEnabled || processing}
                  >
                    {activeDrawMode === 'watermark' ? 'Drawing...' : 'Draw Box'}
                  </button>
                </div>
                {watermarkEnabled && activeDrawMode === 'watermark' && !watermarkCrop && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#f0f0f0', borderRadius: '8px', color: '#555', fontSize: '0.9rem' }}>
                    Tip: Click and drag on the video player above to box the watermark.
                  </div>
                )}
                {watermarkEnabled && watermarkCrop && videoDimensions.width > 0 && (
                  <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#e6f7ff', borderRadius: '8px', color: '#005bb5', fontSize: '0.9rem' }}>
                    <strong>Watermark Area:</strong> {Math.round((watermarkCrop.width / 100) * videoDimensions.width)} × {Math.round((watermarkCrop.height / 100) * videoDimensions.height)} px
                  </div>
                )}
              </AccordionPanel>

              <AccordionPanel icon="⚡" title="Speed" defaultOpen={false}
                badge={speedEnabled ? `${speed}×` : null}
                enabled={speedEnabled} onToggleEnabled={setSpeedEnabled}>
                <p className="panel-hint">Adjust playback speed. This changes video frame timing and audio pitch.</p>
                <div className="slider-section">
                  <div className="slider-labels">
                    <span>0.5× Slow-mo</span>
                    <span className="slider-value">{parseFloat(speed).toFixed(2)}×</span>
                    <span>2.0× Fast</span>
                  </div>
                  <input
                    type="range" min="0.5" max="2.0" step="0.01"
                    value={speed}
                    onChange={e => setSpeed(parseFloat(e.target.value))}
                    disabled={processing || !speedEnabled}
                    className="slider"
                  />
                  <div className="speed-presets">
                    {[0.5, 0.75, 0.95, 1.0, 1.05, 1.25, 1.5, 2.0].map(s => (
                      <button key={s} className={`preset-chip ${speed === s ? 'active' : ''}`}
                        onClick={() => setSpeed(s)} disabled={processing || !speedEnabled}>
                        {s}×
                      </button>
                    ))}
                  </div>
                </div>
              </AccordionPanel>


              <AccordionPanel icon="🤖" title="Auto Subtitles (AI)" defaultOpen={false}
                badge={autoSubtitles ? 'Enabled' : null}
                enabled={autoSubtitles} onToggleEnabled={(val) => {
                  setAutoSubtitles(val);
                  if (val) setCaptionEnabled(false);
                }}>
                <p className="panel-hint">
                  Automatically detect the spoken language, translate it to English, and burn the subtitles directly onto the video.
                </p>
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#fff3cd', borderRadius: '8px', color: '#856404', fontSize: '0.85rem' }}>
                  <strong>⚠️ Note:</strong> This uses a local AI model running on your computer. It provides excellent privacy and supports all global languages, but <strong>processing will take significantly longer</strong> depending on your CPU speed.
                </div>
              </AccordionPanel>

              <AccordionPanel icon="🔍" title="Magnifying Glass" defaultOpen={false}
                badge={magnifyEnabled ? 'Active' : null}
                enabled={magnifyEnabled} onToggleEnabled={(val) => {
                  setMagnifyEnabled(val);
                  if (!val) { setActiveDrawMode('none'); }
                }}>
                <p className="panel-hint">Draw a region on the video — that area zooms in and the surrounding frame blurs.</p>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem', marginTop: '0.5rem' }}>
                  <button
                    className={`preset-chip ${activeDrawMode === 'magnify' ? 'active' : ''}`}
                    onClick={() => {
                      setActiveDrawMode(activeDrawMode === 'magnify' ? 'none' : 'magnify');
                    }}
                    disabled={!magnifyEnabled || processing}
                  >
                    {activeDrawMode === 'magnify' ? '✏️ Drawing…' : '🎯 Draw Lens Area'}
                  </button>
                  {activeDrawMode === 'magnify' && !magnifyCrop && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Drag on the video above ↑</span>
                  )}
                  {magnifyCrop && activeDrawMode === 'magnify' && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>✓ Area selected</span>
                  )}
                </div>

                {magnifyCrop && (
                  <div style={{ border: '1px solid var(--border-active)', borderRadius: 'var(--radius)', padding: '0.85rem', background: 'rgba(45,212,191,0.04)' }}>
                    <p style={{ fontSize: '0.8rem', color: 'var(--accent)', marginBottom: '0.75rem', fontWeight: 600 }}>🔍 Configure Lens</p>
                    
                    <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                      <label>Zoom Factor</label>
                      <span className="slider-val">{parseFloat(magnifyZoom).toFixed(1)}×</span>
                      <input type="range" min="1.1" max="4.0" step="0.1"
                        value={magnifyZoom}
                        onChange={e => setMagnifyZoom(parseFloat(e.target.value))}
                        disabled={!magnifyEnabled || processing}
                        className="slider" />
                    </div>
                    <div className="speed-presets" style={{ marginTop: '0.4rem' }}>
                      {[1.5, 2.0, 2.5, 3.0, 4.0].map(z => (
                        <button key={z} className={`preset-chip ${magnifyZoom === z ? 'active' : ''}`}
                          onClick={() => setMagnifyZoom(z)} disabled={!magnifyEnabled || processing}>
                          {z}×
                        </button>
                      ))}
                    </div>

                    <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                      <label>Feather Edge</label>
                      <span className="slider-val">{magnifyBlur}</span>
                      <input type="range" min="0" max="60" step="1"
                        value={magnifyBlur}
                        onChange={e => setMagnifyBlur(parseInt(e.target.value))}
                        disabled={!magnifyEnabled || processing}
                        className="slider" />
                    </div>

                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                      <label className="checkbox-label" style={{ marginBottom: '0.5rem' }}>
                        <input type="checkbox" checked={magnifyRangeEnabled} onChange={e => setMagnifyRangeEnabled(e.target.checked)} disabled={!magnifyEnabled || processing} />
                        Apply to specific time range only
                      </label>
                      {magnifyRangeEnabled && (
                        <div className="input-row">
                          <div className="input-group">
                            <label>Start (s)</label>
                            <input type="number" min="0" step="0.1" placeholder="0" value={magnifyStart} onChange={e => setMagnifyStart(e.target.value)} disabled={!magnifyEnabled || processing} />
                          </div>
                          <div className="input-group">
                            <label>End (s)</label>
                            <input type="number" min="0" step="0.1" placeholder="end" value={magnifyEnd} onChange={e => setMagnifyEnd(e.target.value)} disabled={!magnifyEnabled || processing} />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </AccordionPanel>
                  </>
                )}
                {activeTab === 'video' && (
                  <>

              <AccordionPanel icon="✨" title="Interactive Overlays" defaultOpen={false}
                badge={overlaysEnabled ? `${overlays.length} item(s)` : null}
                enabled={overlaysEnabled} onToggleEnabled={setOverlaysEnabled}>
                <p className="panel-hint">Add draggable, resizable text, images, and symbols to the video.</p>
                <div className="input-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                  <button className="btn btn-secondary" onClick={addTextOverlay} disabled={processing || !overlaysEnabled}>
                    + Add Text
                  </button>
                  <button className="btn btn-secondary" onClick={() => fileOverlayInputRef.current?.click()} disabled={processing || !overlaysEnabled}>
                    + Add Image
                  </button>
                  <input type="file" ref={fileOverlayInputRef} onChange={handleOverlayImageChange} style={{ display: 'none' }} accept="image/*" />
                  
                  <div className="input-group">
                    <select onChange={(e) => { if (e.target.value) { addSymbolOverlay(e.target.value); e.target.value=''; } }} disabled={processing || !overlaysEnabled} className="select-field">
                      <option value="">+ Add Symbol/Shape...</option>
                      <option value="SHAPE:circle:red">○ Circle (Red)</option>
                      <option value="SHAPE:oval:red">⬭ Oval (Red)</option>
                      <option value="SHAPE:arrow-down:red">⬇ Down Arrow (Red)</option>
                      <option value="RED:➔">➔ Arrow Right (Red)</option>
                      <option value="❤️">❤️ Heart</option>
                      <option value="⭐">⭐ Star</option>
                      <option value="🔥">🔥 Fire</option>
                      <option value="✅">✅ Checkmark</option>
                      <option value="⚠️">⚠️ Warning</option>
                      <option value="🎯">🎯 Target</option>
                    </select>
                  </div>
                </div>
                {overlays.length > 0 && (
                  <div style={{ marginTop: '1rem', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.5rem' }}>
                    {overlays.map((obj, i) => (
                      <div key={obj.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem', gap: '0.5rem' }}>
                        <span style={{flex: 1}}>{obj.type.toUpperCase()} Overlay</span>
                        {(obj.type === 'text' || obj.type === 'symbol') && (
                          <textarea className="input-field" style={{flex: 2, padding: '2px 4px', height: '30px', resize: 'vertical', fontFamily: 'inherit'}} value={obj.content} onChange={(e) => updateOverlay(obj.id, { content: e.target.value })} />
                        )}
                        {obj.type === 'text' && (
                          <div style={{display: 'flex', alignItems: 'center', gap: '2px'}}>
                            <input type="number" min="10" max="200" value={obj.fontSize || 48} onChange={(e) => updateOverlay(obj.id, { fontSize: parseInt(e.target.value) || 48 })} style={{width: '45px', padding: '2px', border: '1px solid var(--border)', borderRadius: '4px'}} title="Font Size" />
                            <span style={{fontSize: '0.7rem', color: 'var(--text-muted)'}}>px</span>
                          </div>
                        )}
                        {obj.type === 'text' && (
                          <button 
                            style={{ background: obj.isBold !== false ? 'var(--primary)' : 'var(--bg-lighter)', color: obj.isBold !== false ? 'white' : 'var(--text)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', width: '24px', height: '24px', padding: 0 }} 
                            onClick={() => updateOverlay(obj.id, { isBold: obj.isBold === false ? true : false })}
                            title="Toggle Bold"
                          >B</button>
                        )}
                        <input type="color" value={obj.color || '#ffffff'} onChange={(e) => updateOverlay(obj.id, { color: e.target.value })} style={{width: '24px', height: '24px', padding: '0'}} title="Text Color" />
                        {obj.type === 'text' && (
                          <div style={{display: 'flex', alignItems: 'center', marginLeft: '2px', marginRight: '2px'}}>
                            <label style={{fontSize: '0.65rem', display: 'flex', alignItems: 'center', cursor: 'pointer', background: 'var(--bg-lighter)', padding: '2px 4px', borderRadius: '4px', border: '1px solid var(--border)'}}>
                              <input type="checkbox" checked={!!(obj.bgColor && obj.bgColor !== 'transparent')} onChange={(e) => updateOverlay(obj.id, { bgColor: e.target.checked ? '#000000' : 'transparent' })} style={{marginRight: '2px'}} />
                              BG
                            </label>
                            {obj.bgColor && obj.bgColor !== 'transparent' && (
                              <input type="color" value={obj.bgColor || '#000000'} onChange={(e) => updateOverlay(obj.id, { bgColor: e.target.value })} style={{width: '24px', height: '24px', padding: '0', marginLeft: '2px'}} title="Background Color" />
                            )}
                          </div>
                        )}
                        <button style={{ background: 'none', border: 'none', color: 'var(--error)', cursor: 'pointer' }} onClick={() => removeOverlay(obj.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </AccordionPanel>

              <AccordionPanel icon="🧠" title="AI Object Tracker" defaultOpen={false}
                badge={aiTrackerEnabled ? `${trackedObjects.length} object(s)` : null}
                enabled={aiTrackerEnabled} onToggleEnabled={setAiTrackerEnabled}>
                <p className="panel-hint">Automatically track a selected object using Computer Vision and attach a shape to it.</p>
                <div className="input-row">
                  <div className="input-group">
                    <label>Profile</label>
                    <select value={aiTrackerProfile} onChange={e => setAiTrackerProfile(e.target.value)} disabled={processing || !aiTrackerEnabled} className="select-field">
                      <option value="FAST">Fast (MOSSE)</option>
                      <option value="BALANCED">Balanced (CSRT)</option>
                      <option value="LEGACY">Legacy (KCF)</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Shape</label>
                    <select value={aiTrackerShape} onChange={e => setAiTrackerShape(e.target.value)} disabled={processing || !aiTrackerEnabled} className="select-field">
                      <option value="circle">Circle ⭕</option>
                      <option value="arrow">Arrow ➔</option>
                    </select>
                  </div>
                </div>
                <div className="input-row" style={{marginTop: '0.75rem'}}>
                  <div className="input-group">
                    <label>Color</label>
                    <select value={aiTrackerColor} onChange={e => setAiTrackerColor(e.target.value)} disabled={processing || !aiTrackerEnabled} className="select-field">
                      <option value="red">Red</option>
                      <option value="green">Green</option>
                      <option value="blue">Blue</option>
                      <option value="yellow">Yellow</option>
                      <option value="white">White</option>
                      <option value="black">Black</option>
                    </select>
                  </div>
                  <div className="input-group">
                    <label>Size</label>
                    <input type="number" value={aiTrackerSize} onChange={e => setAiTrackerSize(e.target.value)} disabled={processing || !aiTrackerEnabled} />
                  </div>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <button
                    className={`preset-chip ${activeDrawMode === 'ai-tracker' ? 'active' : ''}`}
                    onClick={() => setActiveDrawMode(activeDrawMode === 'ai-tracker' ? 'none' : 'ai-tracker')}
                    disabled={processing || !aiTrackerEnabled}
                  >
                    {activeDrawMode === 'ai-tracker' ? 'Drawing...' : 'Draw Bounding Box'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ marginLeft: '0.5rem', padding: '0.5rem 1rem' }}
                    disabled={processing || !aiTrackerEnabled || !aiTrackerCrop || activeDrawMode !== 'ai-tracker'}
                    onClick={() => {
                        const newObj = {
                            id: Math.random().toString(36).substring(7),
                            bbox: [aiTrackerCrop.x, aiTrackerCrop.y, aiTrackerCrop.width, aiTrackerCrop.height],
                            timestamp: videoRef.current ? videoRef.current.currentTime : 0,
                            overlay: aiTrackerShape,
                            shape_color: aiTrackerColor,
                            shape_thickness: 2,
                            trackerProfile: aiTrackerProfile,
                            size: aiTrackerSize
                        };
                        setTrackedObjects([...trackedObjects, newObj]);
                        setAiTrackerCrop(null);
                        setActiveDrawMode('none');
                    }}
                  >
                    Add Target
                  </button>
                </div>
                
                {trackedObjects.length > 0 && (
                  <div style={{ marginTop: '1rem', border: '1px solid #ccc', borderRadius: '4px', padding: '0.5rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem' }}>Targets to Track:</h4>
                    {trackedObjects.map((obj, i) => (
                      <div key={obj.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                        <span>Object {i + 1}: {obj.overlay} ({obj.shape_color}) - {Math.round(obj.bbox[2])}x{Math.round(obj.bbox[3])}</span>
                        <button style={{ background: 'none', border: 'none', color: 'red', cursor: 'pointer' }} onClick={() => setTrackedObjects(trackedObjects.filter(o => o.id !== obj.id))}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </AccordionPanel>

              <AccordionPanel icon="🎨" title="Color Grading" defaultOpen={false}
                badge={colorEnabled && colorPreset !== 'none' ? colorPreset : null}
                enabled={colorEnabled} onToggleEnabled={setColorEnabled}>
                <p className="panel-hint">Apply a color preset and fine-tune with sliders. Alters the color hash of every frame.</p>

                <div className="color-presets">
                  {COLOR_PRESETS.map(p => (
                    <button
                      key={p.id}
                      className={`color-preset-btn ${colorPreset === p.id ? 'active' : ''}`}
                      onClick={() => setColorPreset(p.id)}
                      disabled={processing || !colorEnabled}
                    >
                      <span>{p.emoji}</span>
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>

                <div className="slider-group">
                  <div className="slider-row">
                    <label>Saturation</label>
                    <span className="slider-val">{saturation.toFixed(2)}</span>
                    <input type="range" min="0" max="3" step="0.05" value={saturation}
                      onChange={e => setSaturation(parseFloat(e.target.value))}
                      disabled={processing || !colorEnabled} className="slider" />
                  </div>
                  <div className="slider-row">
                    <label>Brightness</label>
                    <span className="slider-val">{brightness.toFixed(2)}</span>
                    <input type="range" min="-0.5" max="0.5" step="0.01" value={brightness}
                      onChange={e => setBrightness(parseFloat(e.target.value))}
                      disabled={processing || !colorEnabled} className="slider" />
                  </div>
                  <div className="slider-row">
                    <label>Contrast</label>
                    <span className="slider-val">{contrast.toFixed(2)}</span>
                    <input type="range" min="0.5" max="2" step="0.05" value={contrast}
                      onChange={e => setContrast(parseFloat(e.target.value))}
                      disabled={processing || !colorEnabled} className="slider" />
                  </div>
                </div>
              </AccordionPanel>
                  </>
                )}
                {activeTab === 'audio' && (
                  <>
              <AccordionPanel icon="🎵" title="Audio & Voiceover" defaultOpen={false}
                badge={audioEnabled ? audioMode : null}
                enabled={audioEnabled} onToggleEnabled={setAudioEnabled}>
                <p className="panel-hint">Modify the audio track — mute, replace, or mix in a background track.</p>
                <div className="audio-mode-grid">
                  {[
                    { id: 'keep',    icon: '🔊', label: 'Keep Original' },
                    { id: 'mute',    icon: '🔇', label: 'Mute Audio' },
                    { id: 'replace', icon: '🔄', label: 'Replace Audio' },
                    { id: 'mix',     icon: '🎚️', label: 'Mix In Track' },
                  ].map(opt => (
                    <button
                      key={opt.id}
                      className={`audio-mode-btn ${audioMode === opt.id ? 'active' : ''}`}
                      onClick={() => setAudioMode(opt.id)}
                      disabled={processing || !audioEnabled}
                    >
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>

                {audioEnabled && (audioMode === 'replace' || audioMode === 'mix') && (
                  <div style={{ marginTop: '1rem' }}>
                    <div
                      className={`audio-drop-zone ${audioFile ? 'has-file' : ''}`}
                      onClick={() => audioInputRef.current?.click()}
                    >
                      {audioFile ? (
                        <>
                          <span>🎵</span>
                          <span>{audioFile.name}</span>
                          <span className="file-chip-size">({(audioFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                        </>
                      ) : (
                        <>
                          <span>📂</span>
                          <span>Upload audio file (MP3, AAC, WAV, M4A)</span>
                        </>
                      )}
                    </div>
                    <input type="file" ref={audioInputRef} accept="audio/*"
                      onChange={e => setAudioFile(e.target.files[0] || null)}
                      style={{ display: 'none' }} />
                  </div>
                )}

                {audioEnabled && audioMode === 'mix' && (
                  <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                    <label>Background Volume</label>
                    <span className="slider-val">{Math.round(audioVolume * 100)}%</span>
                    <input type="range" min="0" max="1" step="0.05" value={audioVolume}
                      onChange={e => setAudioVolume(parseFloat(e.target.value))}
                      disabled={processing || !audioEnabled} className="slider" />
                  </div>
                )}

                {audioEnabled && (
                  <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>🎵 Independent Pitch Shift</label>
                      <label className="toggle-switch" style={{ marginLeft: '0.5rem' }}>
                        <input type="checkbox" checked={pitchShiftEnabled}
                          onChange={e => setPitchShiftEnabled(e.target.checked)} disabled={processing || !audioEnabled} />
                        <span className="toggle-track"><span className="toggle-thumb" /></span>
                      </label>
                    </div>
                    {pitchShiftEnabled && (
                      <>
                        <p className="panel-hint" style={{ margin: '0 0 0.6rem' }}>Shift audio pitch without changing video speed. Changes the audio frequency fingerprint.</p>
                        <div className="slider-row">
                          <label>Semitones</label>
                          <span className="slider-val">{pitchShiftSemitones > 0 ? `+${pitchShiftSemitones}` : pitchShiftSemitones} st</span>
                          <input type="range" min="-6" max="6" step="0.5" value={pitchShiftSemitones}
                            onChange={e => setPitchShiftSemitones(parseFloat(e.target.value))}
                            disabled={processing || !audioEnabled || !pitchShiftEnabled} className="slider" />
                        </div>
                        <div className="speed-presets" style={{ marginTop: '0.5rem' }}>
                          {[-4, -2, -1, 0, 1, 2, 4].map(s => (
                            <button key={s} className={`preset-chip ${pitchShiftSemitones === s ? 'active' : ''}`}
                              onClick={() => setPitchShiftSemitones(s)} disabled={processing || !audioEnabled}>
                              {s > 0 ? `+${s}` : s}st
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>🎛️ Audio EQ Shift</label>
                        <label className="toggle-switch" style={{ marginLeft: '0.5rem' }}>
                          <input type="checkbox" checked={audioEqEnabled}
                            onChange={e => setAudioEqEnabled(e.target.checked)} disabled={processing || !audioEnabled} />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                      </div>
                      {audioEqEnabled && (
                        <>
                          <p className="panel-hint" style={{ margin: '0 0 0.6rem' }}>Reshapes the audio spectral envelope (changes the frequency balance). Defeats spectral shape matching.</p>
                          <div className="input-group">
                            <label>EQ Preset</label>
                            <select value={audioEqPreset} onChange={e => setAudioEqPreset(e.target.value)}
                              disabled={processing || !audioEnabled} className="select-field">
                              <option value="cut-low">Cut Lows (Remove bass)</option>
                              <option value="cut-high">Cut Highs (Remove treble)</option>
                              <option value="boost-mid">Boost Mids (Vocal punch)</option>
                              <option value="scoop-mid">Scoop Mids (V-shape)</option>
                              <option value="telephone">Telephone Effect</option>
                            </select>
                          </div>
                        </>
                      )}
                    </div>

                    <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                        <label style={{ fontWeight: 600, fontSize: '0.9rem' }}>📻 Inject Noise Floor</label>
                        <label className="toggle-switch" style={{ marginLeft: '0.5rem' }}>
                          <input type="checkbox" checked={noiseFloorEnabled}
                            onChange={e => setNoiseFloorEnabled(e.target.checked)} disabled={processing || !audioEnabled} />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                      </div>
                      {noiseFloorEnabled && (
                        <>
                          <p className="panel-hint" style={{ margin: '0 0 0.6rem' }}>Injects sub-perceptual white noise beneath the audio track to break strict spectral fingerprints like AcoustID.</p>
                          <div className="slider-row">
                            <label>Volume (dB)</label>
                            <span className="slider-val">{noiseFloorDb} dB</span>
                            <input type="range" min="-60" max="-20" step="1" value={noiseFloorDb}
                              onChange={e => setNoiseFloorDb(parseInt(e.target.value))}
                              disabled={processing || !audioEnabled} className="slider" />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </AccordionPanel>
                  </>
                )}
                {activeTab === 'anti-ai' && (
                  <>
              <div style={{ marginBottom: '1.5rem', padding: '1.5rem', background: 'linear-gradient(135deg, #f0f7ff, #e6f0ff)', borderRadius: '12px', border: '1px solid #cce0ff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ fontSize: '1.5rem' }}>🛡️</div>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#004085' }}>Master Anti-AI Bypass Preset</h3>
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#0056b3' }}>One-click toggle to enable the ultimate AI confusion suite.</p>
                    </div>
                  </div>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={masterAntiAiEnabled} onChange={(e) => handleMasterAntiAiToggle(e.target.checked)} />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                  </label>
                </div>
                <p style={{ margin: '0.75rem 0 0 0', fontSize: '0.8rem', color: '#4d7a99' }}>
                  <strong>Enables:</strong> Border & Padding, Dynamic Zoom, FPS Conversion, Hue Rotation, Micro-Tilt, Temporal Jitter, Crop Reframe, and Thumbnail Randomizer.
                </p>
              </div>

              <AccordionPanel icon="🔄" title="Horizontal Mirror" defaultOpen={false}
                badge={mirrorEnabled ? 'Active' : null}
                enabled={mirrorEnabled} onToggleEnabled={setMirrorEnabled}>
                <p className="panel-hint">Flips every frame horizontally. Defeats basic scene hashing and confuses face/object recognition AI by reversing spatial orientation.</p>
                
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={protectSubtitles} 
                      onChange={(e) => setProtectSubtitles(e.target.checked)} 
                    />
                    <strong>Cover Original Subtitles</strong> (Places a sleek black box over the bottom 20% to hide backwards text, perfect for Auto-Subtitles)
                  </label>
                </div>

                <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#e6f7ff', borderRadius: '8px', color: '#005bb5', fontSize: '0.85rem' }}>
                  ✅ Live preview reflects the flip. The output video will be permanently mirrored.
                </div>
              </AccordionPanel>

              <AccordionPanel icon="📺" title="Split-Screen Underlay" defaultOpen={false}
                badge={splitScreenEnabled ? splitDirection : null}
                enabled={splitScreenEnabled} onToggleEnabled={setSplitScreenEnabled}>
                <p className="panel-hint">Places the main video in one half of the frame with a blurred version of itself in the other half. Defeats semantic AI by presenting two conflicting visual contexts.</p>
                <div className="audio-mode-grid" style={{ marginTop: '0.75rem' }}>
                  {[
                    { id: 'vertical',   icon: '⬆️', label: 'Top / Bottom' },
                    { id: 'horizontal', icon: '⬅️', label: 'Left / Right' },
                  ].map(opt => (
                    <button key={opt.id}
                      className={`audio-mode-btn ${splitDirection === opt.id ? 'active' : ''}`}
                      onClick={() => setSplitDirection(opt.id)}
                      disabled={processing || !splitScreenEnabled}>
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
                
                <div style={{ marginTop: '1rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.4rem' }}>
                    Optional: Custom Overlay Video
                  </label>
                  <p className="panel-hint" style={{margin: '0 0 0.5rem 0'}}>Upload a second video to play on the blurred section.</p>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="file"
                      ref={splitOverlayInputRef}
                      style={{ display: 'none' }}
                      accept="video/*"
                      onChange={e => {
                        if (e.target.files[0]) setSplitOverlayVideo(e.target.files[0]);
                      }}
                      disabled={processing || !splitScreenEnabled}
                    />
                    <button className="btn btn-secondary" onClick={() => splitOverlayInputRef.current?.click()} disabled={processing || !splitScreenEnabled}>
                      Select Video
                    </button>
                    {splitOverlayVideo && (
                      <div className="file-chip" style={{ margin: 0, padding: '0.2rem 0.5rem' }}>
                        <span className="file-chip-name">{splitOverlayVideo.name}</span>
                        <button className="btn-ghost" style={{ padding: '0 4px', fontSize: '1rem' }} onClick={() => setSplitOverlayVideo(null)}>✕</button>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#fff3cd', borderRadius: '8px', color: '#856404', fontSize: '0.85rem' }}>
                  ⚠️ This feature re-encodes the video. Processing time increases proportionally.
                </div>
              </AccordionPanel>

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="🖼️" title="Border & Padding" defaultOpen={false}
                badge={borderEnabled ? `${borderPadding}%` : null}
                enabled={borderEnabled} onToggleEnabled={setBorderEnabled}>
                <p className="panel-hint">Scales the video down and adds a colored border. Changes the resolution fingerprint and aspect ratio — breaks both pHash and resolution-based detection.</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Padding Size</label>
                  <span className="slider-val">{borderPadding}%</span>
                  <input type="range" min="2" max="25" step="1" value={borderPadding}
                    onChange={e => setBorderPadding(parseInt(e.target.value))}
                    disabled={processing || !borderEnabled} className="slider" />
                </div>
                <div className="input-row" style={{ marginTop: '0.75rem' }}>
                  <div className="input-group">
                    <label>Border Color</label>
                    <select value={borderColor} onChange={e => setBorderColor(e.target.value)}
                      disabled={processing || !borderEnabled} className="select-field">
                      <option value="black">Black</option>
                      <option value="white">White</option>
                      <option value="gray">Gray</option>
                      <option value="blue">Blue</option>
                      <option value="red">Red</option>
                      <option value="green">Green</option>
                    </select>
                  </div>
                </div>
              </AccordionPanel>
              )}

              <AccordionPanel icon="📽️" title="Film Grain / Noise" defaultOpen={false}
                badge={grainEnabled ? `${grainIntensity}` : null}
                enabled={grainEnabled} onToggleEnabled={setGrainEnabled}>
                <p className="panel-hint">Injects temporal pixel noise on every single frame. Completely randomizes the perceptual hash (pHash) of every keyframe, defeating frame-extraction fingerprinting.</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Intensity</label>
                  <span className="slider-val">{grainIntensity}</span>
                  <input type="range" min="1" max="100" step="1" value={grainIntensity}
                    onChange={e => setGrainIntensity(parseInt(e.target.value))}
                    disabled={processing || !grainEnabled} className="slider" />
                </div>
                <div className="speed-presets" style={{ marginTop: '0.5rem' }}>
                  {[{ v: 8, l: 'Subtle' }, { v: 20, l: 'Film' }, { v: 45, l: 'Heavy' }, { v: 80, l: 'Static' }].map(p => (
                    <button key={p.v} className={`preset-chip ${grainIntensity === p.v ? 'active' : ''}`}
                      onClick={() => setGrainIntensity(p.v)} disabled={processing || !grainEnabled}>
                      {p.l}
                    </button>
                  ))}
                </div>
              </AccordionPanel>

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="🔍" title="Zoom & Reframe" defaultOpen={false}
                badge={zoomEnabled ? `${zoomDirection} · ${zoomIntensity}` : null}
                enabled={zoomEnabled} onToggleEnabled={setZoomEnabled}>
                <p className="panel-hint">Scales and reframes the video. Changes spatial pixel distribution on every frame, breaking perceptual hashing and motion vector analysis.</p>
                <div className="audio-mode-grid" style={{ marginTop: '0.75rem' }}>
                  {[
                    { id: 'zoom-in',   icon: '🔎', label: 'Zoom In' },
                    { id: 'zoom-out',  icon: '🔭', label: 'Zoom Out' },
                    { id: 'pan-left',  icon: '⬅️', label: 'Pan Left' },
                    { id: 'pan-right', icon: '➡️', label: 'Pan Right' },
                  ].map(opt => (
                    <button key={opt.id}
                      className={`audio-mode-btn ${zoomDirection === opt.id ? 'active' : ''}`}
                      onClick={() => setZoomDirection(opt.id)}
                      disabled={processing || !zoomEnabled}>
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
                <div className="speed-presets" style={{ marginTop: '0.75rem' }}>
                  {[{ v: 'subtle', l: 'Subtle (5%)' }, { v: 'medium', l: 'Medium (10%)' }, { v: 'heavy', l: 'Heavy (20%)' }].map(p => (
                    <button key={p.v} className={`preset-chip ${zoomIntensity === p.v ? 'active' : ''}`}
                      onClick={() => setZoomIntensity(p.v)} disabled={processing || !zoomEnabled}>
                      {p.l}
                    </button>
                  ))}
                </div>
              </AccordionPanel>
              )}

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="🎞️" title="Frame Rate (FPS) Conversion" defaultOpen={false}
                badge={fpsEnabled ? `${targetFps}fps` : null}
                enabled={fpsEnabled} onToggleEnabled={setFpsEnabled}>
                <p className="panel-hint">Converts the video to a different frame rate. Forces the encoder to drop or blend frames, breaking temporal fingerprinting sequences used by Content ID.</p>
                <div className="speed-presets" style={{ marginTop: '0.75rem' }}>
                  {[12, 15, 24, 25, 30, 60].map(fps => (
                    <button key={fps} className={`preset-chip ${targetFps === fps ? 'active' : ''}`}
                      onClick={() => setTargetFps(fps)} disabled={processing || !fpsEnabled}>
                      {fps}fps
                    </button>
                  ))}
                </div>
              </AccordionPanel>
              )}

              <AccordionPanel icon="🎭" title="Privacy Blur" defaultOpen={false}
                badge={faceBlurEnabled ? `Strength ${faceBlurStrength}` : null}
                enabled={faceBlurEnabled} onToggleEnabled={setFaceBlurEnabled}>
                <p className="panel-hint">Applies a global softening blur that degrades facial recognition AI confidence and introduces pixel-level differences that confuse visual embedding models.</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Blur Strength</label>
                  <span className="slider-val">{faceBlurStrength}/10</span>
                  <input type="range" min="1" max="10" step="1" value={faceBlurStrength}
                    onChange={e => setFaceBlurStrength(parseInt(e.target.value))}
                    disabled={processing || !faceBlurEnabled} className="slider" />
                </div>
                <div className="speed-presets" style={{ marginTop: '0.5rem' }}>
                  {[{ v: 2, l: 'Subtle' }, { v: 4, l: 'Medium' }, { v: 7, l: 'Strong' }, { v: 10, l: 'Max' }].map(p => (
                    <button key={p.v} className={`preset-chip ${faceBlurStrength === p.v ? 'active' : ''}`}
                      onClick={() => setFaceBlurStrength(p.v)} disabled={processing || !faceBlurEnabled}>
                      {p.l}
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', backgroundColor: '#f0f0f0', borderRadius: '8px', color: '#555', fontSize: '0.85rem' }}>
                  💡 Higher strength = stronger blur effect. Subtle settings are less visible to human viewers but still effective against AI models.
                </div>
              </AccordionPanel>

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="🎨" title="Hue Rotation" defaultOpen={false}
                badge={hueEnabled ? `${hueDegrees}°` : null}
                enabled={hueEnabled} onToggleEnabled={setHueEnabled}>
                <p className="panel-hint">Rotates all colors on the color wheel. A small shift (+10°) is unnoticeable to humans but completely changes the color histogram signature extracted by AI.</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Degrees Shift</label>
                  <span className="slider-val">{hueDegrees > 0 ? `+${hueDegrees}` : hueDegrees}°</span>
                  <input type="range" min="-30" max="30" step="1" value={hueDegrees}
                    onChange={e => setHueDegrees(parseInt(e.target.value))}
                    disabled={processing || !hueEnabled} className="slider" />
                </div>
              </AccordionPanel>
              )}

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="📐" title="Micro-Tilt Rotation" defaultOpen={false}
                badge={tiltEnabled ? `${tiltAngle}°` : null}
                enabled={tiltEnabled} onToggleEnabled={setTiltEnabled}>
                <p className="panel-hint">Rotates the frame by a tiny, randomized angle and auto-crops. Visual AI models (CLIP/ViT) are highly sensitive to rotation and fail to match embeddings.</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Rotation Angle</label>
                  <span className="slider-val">{tiltAngle}°</span>
                  <input type="range" min="0.1" max="5.0" step="0.1" value={tiltAngle}
                    onChange={e => setTiltAngle(parseFloat(e.target.value))}
                    disabled={processing || !tiltEnabled} className="slider" />
                </div>
              </AccordionPanel>
              )}

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="✂️" title="Crop Reframe (Edge Removal)" defaultOpen={false}
                badge={vCropEnabled ? `${vCropPercent}%` : null}
                enabled={vCropEnabled} onToggleEnabled={setVCropEnabled}>
                <p className="panel-hint">Crops a percentage from the edges and scales back. Removes black bars and shifts every pixel coordinate, defeating border and layout fingerprinting.</p>
                <div className="input-group" style={{ marginTop: '0.75rem' }}>
                  <label>Crop Axis</label>
                  <select value={vCropAxis} onChange={e => setVCropAxis(e.target.value)}
                    disabled={processing || !vCropEnabled} className="select-field">
                    <option value="vertical">Vertical (Top/Bottom)</option>
                    <option value="horizontal">Horizontal (Left/Right)</option>
                  </select>
                </div>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Crop Percentage</label>
                  <span className="slider-val">{vCropPercent}%</span>
                  <input type="range" min="1" max="15" step="1" value={vCropPercent}
                    onChange={e => setVCropPercent(parseInt(e.target.value))}
                    disabled={processing || !vCropEnabled} className="slider" />
                </div>
              </AccordionPanel>
              )}

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="⏱️" title="Temporal Frame Jitter" defaultOpen={false}
                badge={frameJitterEnabled ? `${frameJitterFrames} frames` : null}
                enabled={frameJitterEnabled} onToggleEnabled={setFrameJitterEnabled}>
                <p className="panel-hint">Duplicates frames at the very beginning to offset every keyframe timestamp. Defeats platforms that extract keyframes at fixed time intervals (e.g., every 2s).</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Jitter Offset</label>
                  <span className="slider-val">{frameJitterFrames} frames</span>
                  <input type="range" min="1" max="5" step="1" value={frameJitterFrames}
                    onChange={e => setFrameJitterFrames(parseInt(e.target.value))}
                    disabled={processing || !frameJitterEnabled} className="slider" />
                </div>
              </AccordionPanel>
              )}

              <AccordionPanel icon="🎢" title="Variable Speed Ramp" defaultOpen={false}
                badge={speedRampEnabled ? speedRampCurve : null}
                enabled={speedRampEnabled} onToggleEnabled={setSpeedRampEnabled}>
                <p className="panel-hint">Applies a dynamic speed curve across the video rather than a flat multiplier. Breaks temporal motion vector sequences and exact duration matching.</p>
                <div className="input-group" style={{ marginTop: '0.75rem' }}>
                  <label>Ramp Curve</label>
                  <select value={speedRampCurve} onChange={e => setSpeedRampCurve(e.target.value)}
                    disabled={processing || !speedRampEnabled} className="select-field">
                    <option value="wave">Sinusoidal Wave (Oscillates ±5%)</option>
                    <option value="slow-fast">Slow Start → Fast End</option>
                    <option value="fast-slow">Fast Start → Slow End</option>
                  </select>
                </div>
              </AccordionPanel>

              {!masterAntiAiEnabled && (
              <AccordionPanel icon="🖼️" title="Thumbnail Randomizer" defaultOpen={false}
                badge={thumbRandomEnabled ? `${thumbIntroSeconds}s` : null}
                enabled={thumbRandomEnabled} onToggleEnabled={setThumbRandomEnabled}>
                <p className="panel-hint">Adds a black frame segment at the start. Since platforms often use the first frame or 0.5s mark as the auto-thumbnail, this defeats thumbnail image similarity hashing.</p>
                <div className="slider-row" style={{ marginTop: '0.75rem' }}>
                  <label>Intro Duration</label>
                  <span className="slider-val">{thumbIntroSeconds}s</span>
                  <input type="range" min="0.1" max="2.0" step="0.1" value={thumbIntroSeconds}
                    onChange={e => setThumbIntroSeconds(parseFloat(e.target.value))}
                    disabled={processing || !thumbRandomEnabled} className="slider" />
                </div>
              </AccordionPanel>
              )}
                  </>
                )}
                {activeTab === 'export' && (
                  <>
              <AccordionPanel icon="📦" title="Container Format Re-Mux" defaultOpen={false}
                badge={remuxEnabled ? remuxFormat.toUpperCase() : null}
                enabled={remuxEnabled} onToggleEnabled={setRemuxEnabled}>
                <p className="panel-hint">Outputs the video in a different container format without re-encoding. Modifies container magic bytes, atom structure, and NAL packaging to break basic file heuristics.</p>
                <div className="audio-mode-grid" style={{ marginTop: '0.75rem' }}>
                  {[
                    { id: 'mkv',  icon: '📦', label: 'MKV' },
                    { id: 'mov',  icon: '🍏', label: 'MOV' },
                    { id: 'avi',  icon: '🎞️', label: 'AVI' },
                    { id: 'webm', icon: '🌐', label: 'WebM' },
                  ].map(opt => (
                    <button key={opt.id}
                      className={`audio-mode-btn ${remuxFormat === opt.id ? 'active' : ''}`}
                      onClick={() => setRemuxFormat(opt.id)}
                      disabled={processing || !remuxEnabled}>
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </AccordionPanel>


                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Metadata Section (always shown) ── */}
          <div className="meta-section">
            <h3 className="meta-title">
              🏷️ {mode === 'transform' ? 'Replace Metadata (Scrub)' : 'Set New Video Metadata'}
            </h3>
            <p className="meta-hint">
              All original metadata (camera, GPS, device info) will be wiped. Fill in clean replacement values below, or leave blank to clear everything.
            </p>
            <div className="meta-grid">
              <div className="meta-field">
                <label htmlFor="meta-title">Title</label>
                <input id="meta-title" type="text" placeholder="e.g. My Video"
                  value={metaTitle} onChange={e => setMetaTitle(e.target.value)} disabled={processing} />
              </div>
              <div className="meta-field">
                <label htmlFor="meta-author">Author / Artist</label>
                <input id="meta-author" type="text" placeholder="e.g. John Doe"
                  value={metaAuthor} onChange={e => setMetaAuthor(e.target.value)} disabled={processing} />
              </div>
              <div className="meta-field">
                <label htmlFor="meta-date">Creation Date</label>
                <input id="meta-date" type="datetime-local"
                  value={metaCreationTime} onChange={e => setMetaCreationTime(e.target.value)} disabled={processing} />
              </div>
              <div className="meta-field">
                <label htmlFor="meta-copyright">Copyright</label>
                <input id="meta-copyright" type="text" placeholder="e.g. © 2025 My Brand"
                  value={metaCopyright} onChange={e => setMetaCopyright(e.target.value)} disabled={processing} />
              </div>
              <div className="meta-field meta-field--full">
                <label htmlFor="meta-comment">Comment / Description</label>
                <input id="meta-comment" type="text" placeholder="e.g. Shot in Dehradun"
                  value={metaComment} onChange={e => setMetaComment(e.target.value)} disabled={processing} />
              </div>
            </div>
          </div>

          {error && <div className="error-banner">⚠️ {error}</div>}

          <div className="controls-footer">
            <button className="btn btn-primary btn-process"
              onClick={processVideo} disabled={processing || !isVideo}>
              {processing ? '⏳ Processing…' : mode === 'transform' ? '🚀 Transform & Scrub Video' : '🚀 Replace Metadata'}
            </button>
            {processing && (
              <div className="progress-container" style={{ marginTop: '0.6rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div className="progress-bar-bg" style={{ flex: 1, margin: 0 }}>
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                  </div>
                  {activeJobId && (
                    <button className="btn btn-ghost btn-sm" onClick={handleCancelJob} style={{ color: '#ff4d4f', padding: '0.3rem 0.6rem' }}>
                      ✕ Cancel
                    </button>
                  )}
                </div>
                <p className="status-text">{message}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Download Section */}
      {outputUrl && (
        <div className="drop-zone-wrapper">
          <div className="download-section" style={{ maxWidth: 500, width: '100%' }}>
            <div className="download-success-icon">✅</div>
            <h3 className="download-title">
              {mode === 'transform' ? 'Video Transformed & Metadata Scrubbed!' : 'Metadata Successfully Replaced!'}
            </h3>
            <p className="download-subtitle">Your video is ready. All original metadata has been wiped.</p>
            <div className="download-actions">
              <button onClick={handleDownload} disabled={downloading} className="btn btn-success">
                {downloading ? '⏳ Downloading…' : '⬇️ Download Processed Video'}
              </button>
              <button className="btn btn-ghost" onClick={resetAll}>
                🔄 Process Another
              </button>
            </div>
          </div>
        </div>
      )}

      </div> {/* end .app-body */}

      <footer className="app-footer" style={{ padding: '1.2rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)', letterSpacing: '0.05em', borderTop: '1px solid var(--border)', background: 'var(--surface)', backdropFilter: 'blur(24px)' }}>
        <span style={{ fontWeight: 600 }}>© {new Date().getFullYear()} All Rights Reserved to Immortall69</span>
      </footer>
    </div>
  );
}

export default App;
