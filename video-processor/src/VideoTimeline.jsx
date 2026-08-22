import React, { useState, useRef, useEffect, useCallback } from 'react';

function VideoTimeline({
  videoUrl,
  duration,
  trimStart,
  trimEnd,
  onTrimStartChange,
  onTrimEndChange
}) {
  const trackRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  
  const [hoverX, setHoverX] = useState(0);
  const [hoverTime, setHoverTime] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [isDragging, setIsDragging] = useState(null); // 'start' | 'end' | null

  // Ensure start/end have default values
  const currentStart = parseFloat(trimStart) || 0;
  const currentEnd = (trimEnd !== '' && trimEnd !== null && trimEnd !== undefined) ? parseFloat(trimEnd) : duration;
  const safeEnd = currentEnd > 0 ? currentEnd : Math.max(duration, 0.1);

  // Helper to format time
  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${secs.toString().padStart(2, '0')}`;
  };

  // Seeking logic
  const requestRef = useRef(null);
  
  const handleMouseMove = useCallback((e) => {
    if (!trackRef.current || !duration) return;
    const rect = trackRef.current.getBoundingClientRect();
    let x = e.clientX - rect.left;
    x = Math.max(0, Math.min(x, rect.width));
    
    const time = (x / rect.width) * duration;
    
    if (isDragging) {
      if (isDragging === 'start') {
        onTrimStartChange(Math.min(time, safeEnd - 0.5).toFixed(2));
      } else if (isDragging === 'end') {
        onTrimEndChange(Math.max(time, currentStart + 0.5).toFixed(2));
      }
    } else {
      setHoverX(x);
      setHoverTime(time);
      
      // Update hidden video for thumbnail
      if (videoRef.current && videoRef.current.readyState >= 2) {
        // throttle seeking
        if (requestRef.current) cancelAnimationFrame(requestRef.current);
        requestRef.current = requestAnimationFrame(() => {
          if (videoRef.current) {
            videoRef.current.currentTime = time;
          }
        });
      }
    }
  }, [duration, isDragging, onTrimStartChange, onTrimEndChange, safeEnd, currentStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(null);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const drawFrame = () => {
      const c = canvasRef.current;
      if (c && v.videoWidth) {
        // match aspect ratio
        const aspect = v.videoWidth / v.videoHeight;
        c.width = 160;
        c.height = 160 / aspect;
        const ctx = c.getContext('2d');
        ctx.drawImage(v, 0, 0, c.width, c.height);
      }
    };
    v.addEventListener('seeked', drawFrame);
    return () => v.removeEventListener('seeked', drawFrame);
  }, []);

  const handleTrackMouseEnter = () => !isDragging && setIsHovering(true);
  const handleTrackMouseLeave = () => !isDragging && setIsHovering(false);

  // Percentages for rendering
  const startPct = duration ? (currentStart / duration) * 100 : 0;
  const endPct = duration ? (safeEnd / duration) * 100 : 100;

  return (
    <div className="video-timeline-container">
      {/* Hidden elements for thumbnail generation */}
      <video ref={videoRef} src={videoUrl} style={{ display: 'none' }} muted playsInline preload="auto" />
      
      <div 
        className="timeline-track"
        ref={trackRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleTrackMouseEnter}
        onMouseLeave={handleTrackMouseLeave}
        onClick={(e) => {
           if (isDragging) return;
           const rect = trackRef.current.getBoundingClientRect();
           let x = e.clientX - rect.left;
           x = Math.max(0, Math.min(x, rect.width));
           const time = (x / rect.width) * duration;
           // Snap to closer handle
           if (Math.abs(time - currentStart) < Math.abs(time - safeEnd)) {
             onTrimStartChange(time.toFixed(2));
           } else {
             onTrimEndChange(time.toFixed(2));
           }
        }}
      >
        {/* Unselected areas */}
        <div className="timeline-unselected timeline-unselected-left" style={{ width: `${startPct}%` }} />
        <div className="timeline-unselected timeline-unselected-right" style={{ left: `${endPct}%`, width: `${100 - endPct}%` }} />
        
        {/* Selected / Active area */}
        <div className="timeline-active" style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }} />
        
        {/* Handles */}
        <div 
          className="timeline-handle handle-left"
          style={{ left: `${startPct}%` }}
          onMouseDown={(e) => { e.stopPropagation(); setIsDragging('start'); }}
        >
           <div className="handle-grip" />
           <div className="handle-label">{formatTime(currentStart)}</div>
        </div>
        <div 
          className="timeline-handle handle-right"
          style={{ left: `${endPct}%` }}
          onMouseDown={(e) => { e.stopPropagation(); setIsDragging('end'); }}
        >
           <div className="handle-grip" />
           <div className="handle-label">{formatTime(safeEnd)}</div>
        </div>

        {/* Hover Thumbnail */}
        {isHovering && duration > 0 && (
          <div className="timeline-thumbnail-tooltip" style={{ left: `${hoverX}px` }}>
            <canvas ref={canvasRef} className="timeline-thumbnail-canvas" />
            <div className="timeline-thumbnail-time">{formatTime(hoverTime)}</div>
          </div>
        )}
      </div>

    </div>
  );
}

export default VideoTimeline;
