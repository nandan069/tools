import cv2
import time
import os
import json
from typing import Dict, Any, List

from tracking.engine.pipeline_context import PipelineContext
from tracking.engine.smoothing_strategy import EMASmoothing
from tracking.engine.recovery_strategy import ConsecutiveFailureRecovery
from tracking.engine.execution_backend import CPUBackend
from tracking.engine.detector import NullDetector
from tracking.trackers.tracker_registry import TrackerRegistry
from tracking.models.tracking_result import FrameResult, TrackedObjectState, TrackerState

class ActiveTracker:
    def __init__(self, target_id: str, profile: str, start_time: float, end_time: float, bbox_percent: List[float]):
        self.target_id = target_id
        self.profile = profile
        self.start_time = start_time
        self.end_time = end_time
        self.bbox_percent = bbox_percent
        
        self.state = TrackerState.CREATED
        self.tracker_instance = None
        self.smoother_x = EMASmoothing(alpha=0.2)
        self.smoother_y = EMASmoothing(alpha=0.2)
        self.smoother_w = EMASmoothing(alpha=0.2)
        self.smoother_h = EMASmoothing(alpha=0.2)
        self.recovery_strategy = ConsecutiveFailureRecovery(max_failures=5)
        self.last_known_bbox = None
        
        tracker_class = TrackerRegistry.get_tracker(profile)
        self.tracker_instance = tracker_class()

class TrackingEngine:
    def __init__(self, context: PipelineContext):
        self.context = context
        self.execution_backend = CPUBackend()
        self.detector = NullDetector()
        self.active_trackers: Dict[str, ActiveTracker] = {}
        
    def _percent_to_pixel(self, bbox_percent: List[float], width: int, height: int) -> List[int]:
        px = int(bbox_percent[0] * width / 100.0)
        py = int(bbox_percent[1] * height / 100.0)
        pw = int(bbox_percent[2] * width / 100.0)
        ph = int(bbox_percent[3] * height / 100.0)
        return [px, py, pw, ph]
        
    def run(self):
        self.context.set_status("tracking", "running")
        self.context.logger.info("Tracking Engine started.")
        self.execution_backend.initialize()
        
        video_path = self.context.manifest.config.video
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            self.context.logger.event("TrackerFailed", 0.0, {"error": f"Cannot open video {video_path}"})
            self.context.set_status("tracking", "failed")
            return
            
        fps = cap.get(cv2.CAP_PROP_FPS)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        self.context.tracking_data.video = {"fps": fps, "width": width, "height": height}
        
        for t in self.context.manifest.config.trackers:
            self.active_trackers[t.id] = ActiveTracker(t.id, t.profile, t.start_time, t.end_time, t.bbox_percent)
            self.context.logger.event("TrackerInitialized", t.start_time, {"target_id": t.id})
            
        frame_idx = 0
        start_time_real = time.time()
        
        debug_mode = self.context.manifest.features.get("debug", False)
        out_video = None
        if debug_mode:
            job_dir = os.path.dirname(self.context.manifest_path)
            debug_path = os.path.join(job_dir, "debug.mp4")
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out_video = cv2.VideoWriter(debug_path, fourcc, fps, (width, height))
            self.context.manifest.runtime.artifacts["debug"] = "debug.mp4"
            
        while True:
            ret, frame = cap.read()
            if not ret:
                break
                
            current_time = frame_idx / fps
            frame_result = FrameResult(frame=frame_idx, time=current_time, objects=[])
            
            # Update each active tracker
            for target_id, at in self.active_trackers.items():
                if current_time < at.start_time or current_time > at.end_time:
                    if at.state != TrackerState.CREATED and at.state != TrackerState.FINISHED:
                        at.state = TrackerState.FINISHED
                        self.context.logger.event("TrackerFinished", current_time, {"target_id": target_id})
                    continue
                    
                # Optimization: Resize frame for faster tracking
                scale = 1.0
                max_width = 640
                if width > max_width:
                    scale = max_width / width
                    track_frame = cv2.resize(frame, (int(width * scale), int(height * scale)))
                else:
                    track_frame = frame
                
                # Initialize tracker on first active frame
                if at.state == TrackerState.CREATED:
                    px, py, pw, ph = self._percent_to_pixel(at.bbox_percent, width, height)
                    # Scale initial bbox
                    s_bbox = (int(px * scale), int(py * scale), int(pw * scale), int(ph * scale))
                    success = at.tracker_instance.initialize(track_frame, s_bbox)
                    if success:
                        at.state = TrackerState.TRACKING
                        self.context.logger.event("TrackerStarted", current_time, {"target_id": target_id, "bbox": s_bbox})
                    else:
                        at.state = TrackerState.FAILED
                        self.context.logger.event("TrackerFailed", current_time, {"target_id": target_id})
                        continue
                    
                # Update tracking
                if at.state in [TrackerState.TRACKING, TrackerState.RECOVERING]:
                    success, s_bbox_result = at.tracker_instance.update(track_frame)
                    
                    if success:
                        # Unscale the result bbox
                        bbox = (
                            s_bbox_result[0] / scale,
                            s_bbox_result[1] / scale,
                            s_bbox_result[2] / scale,
                            s_bbox_result[3] / scale
                        )
                        if at.state == TrackerState.RECOVERING:
                            self.context.logger.event("TrackerRecovered", current_time, {"target_id": target_id})
                            # Reset recovery logic (simulated by resetting current_failures inside recovery_strategy in a full impl)
                            at.recovery_strategy.current_failures = 0
                        at.state = TrackerState.TRACKING
                        at.last_known_bbox = bbox
                        
                        # Smooth
                        sx = int(at.smoother_x.smooth(bbox[0] if bbox[0] else bbox[0], bbox[0]))
                        sy = int(at.smoother_y.smooth(bbox[1] if bbox[1] else bbox[1], bbox[1]))
                        sw = int(at.smoother_w.smooth(bbox[2] if bbox[2] else bbox[2], bbox[2]))
                        sh = int(at.smoother_h.smooth(bbox[3] if bbox[3] else bbox[3], bbox[3]))
                        
                        s_bbox = [sx, sy, sw, sh]
                        n_bbox = [sx/width, sy/height, sw/width, sh/height]
                        
                        obj_state = TrackedObjectState(
                            id=target_id,
                            bbox=s_bbox,
                            normalized=n_bbox,
                            rotation=0.0,
                            confidence=0.9, # Mock confidence for OpenCV trackers
                            state=at.state.value
                        )
                        frame_result.objects.append(obj_state)
                        
                        # Store trajectory
                        if target_id not in self.context.trajectory_data.trajectories:
                            self.context.trajectory_data.trajectories[target_id] = []
                        cx = sx + (sw / 2)
                        cy = sy + (sh / 2)
                        self.context.trajectory_data.trajectories[target_id].append([cx, cy])
                        
                        if debug_mode and out_video:
                            cv2.rectangle(frame, (sx, sy), (sx+sw, sy+sh), (0,255,0), 2)
                            cv2.putText(frame, target_id, (sx, sy-10), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0,255,0), 2)
                            
                    else:
                        recovered_bbox = at.recovery_strategy.attempt_recovery(frame, at.last_known_bbox)
                        if recovered_bbox:
                            at.state = TrackerState.RECOVERING
                            if at.recovery_strategy.current_failures == 1: # Only log first time it enters recovering
                                self.context.logger.event("TrackerLost", current_time, {"target_id": target_id})
                            # Fallback re-init
                            at.tracker_instance.initialize(frame, recovered_bbox)
                        else:
                            at.state = TrackerState.LOST
                            
            if len(frame_result.objects) > 0:
                self.context.tracking_data.frames.append(frame_result)
                
            if debug_mode and out_video:
                out_video.write(frame)
                
            frame_idx += 1
            if frame_idx % 30 == 0:
                progress = int((frame_idx / total_frames) * 100)
                self.context.update_progress("tracking", progress)
                
        cap.release()
        if out_video:
            out_video.release()
            
        processing_time = time.time() - start_time_real
        self.context.manifest.runtime.statistics["trackingFPS"] = frame_idx / processing_time if processing_time > 0 else 0
        self.context.manifest.runtime.statistics["processingTime"] = processing_time
        self.context.manifest.runtime.metrics["trackingMs"] = processing_time * 1000
        
        # Save output JSONs
        job_dir = os.path.dirname(self.context.manifest_path)
        
        tracking_json_path = os.path.join(job_dir, "tracking.json")
        with open(tracking_json_path, 'w') as f:
            json.dump(self.context.tracking_data.to_dict(), f, indent=2)
        self.context.manifest.runtime.artifacts["tracking"] = "tracking.json"
            
        trajectory_json_path = os.path.join(job_dir, "trajectory.json")
        with open(trajectory_json_path, 'w') as f:
            json.dump(self.context.trajectory_data.to_dict(), f, indent=2)
        self.context.manifest.runtime.artifacts["trajectory"] = "trajectory.json"
        
        self.context.update_progress("tracking", 100)
        self.context.set_status("tracking", "completed")
        self.context.save()
        self.execution_backend.cleanup()
        self.context.logger.info("Tracking Engine finished.")
