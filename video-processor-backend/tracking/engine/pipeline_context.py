import json
import logging
from dataclasses import dataclass
from typing import Optional
from tracking.models.manifest import TrackingManifest
from tracking.models.tracking_result import TrackingResultData, TrajectoryData

class PipelineLogger:
    def __init__(self, context: 'PipelineContext'):
        self.context = context
        
    def info(self, msg: str):
        logging.info(msg)
        
    def error(self, msg: str):
        print(f"[ERROR] {msg}")
        self._add_event("Error", {"message": msg})
        
    def exception(self, msg: str):
        import traceback
        err_msg = f"{msg}: {traceback.format_exc()}"
        print(f"[ERROR] {err_msg}")
        self._add_event("Error", {"message": err_msg})
        
    def _add_event(self, event_type: str, details: dict):
        import time
        evt = {"time": time.time(), "type": event_type, **details}
        self.context.manifest.runtime.events.append(evt)

    def event(self, event_type: str, time: float, details: dict = None):
        if details is None:
            details = {}
        evt = {"time": time, "type": event_type, **details}
        self.context.manifest.runtime.events.append(evt)
        logging.info(f"EVENT: {event_type} at {time}s - {details}")

class PipelineContext:
    def __init__(self, manifest_path: str):
        self.manifest_path = manifest_path
        with open(manifest_path, 'r') as f:
            data = json.load(f)
        
        self.manifest = TrackingManifest.from_dict(data)
        self.tracking_data = TrackingResultData()
        self.trajectory_data = TrajectoryData()
        self.logger = PipelineLogger(self)
        
    def validate(self):
        # Semantic validation
        config = self.manifest.config
        if not config.video:
            raise ValueError("Manifest missing video path")
            
        tracker_ids = set()
        for t in config.trackers:
            if t.id in tracker_ids:
                raise ValueError(f"Duplicate target ID: {t.id}")
            tracker_ids.add(t.id)
            if t.start_time >= t.end_time:
                raise ValueError(f"Tracker {t.id} has start_time >= end_time")
            if len(t.bbox_percent) != 4:
                raise ValueError(f"Tracker {t.id} has invalid bbox_percent")
                
        # Populate environment basics
        import sys
        import cv2
        self.manifest.runtime.environment["python"] = sys.version.split(" ")[0]
        self.manifest.runtime.environment["opencv"] = cv2.__version__
        self.manifest.runtime.environment["backend"] = "CPU"
                
    def update_progress(self, stage: str, percent: int):
        self.manifest.runtime.progress[stage] = percent
        import sys
        print(json.dumps({"type": "progress", "stage": stage, "percent": percent}))
        sys.stdout.flush()
        
    def set_status(self, stage: str, status: str):
        self.manifest.runtime.status[stage] = status

    def save(self):
        with open(self.manifest_path, 'w') as f:
            json.dump(self.manifest.to_dict(), f, indent=2)

    def save_checkpoint(self, stage: str):
        import os
        job_dir = os.path.dirname(self.manifest_path)
        checkpoint_path = os.path.join(job_dir, f"manifest.{stage}.json")
        with open(checkpoint_path, 'w') as f:
            json.dump(self.manifest.to_dict(), f, indent=2)
