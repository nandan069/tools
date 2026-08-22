from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from enum import Enum

class TrackerState(Enum):
    CREATED = "CREATED"
    INITIALIZED = "INITIALIZED"
    TRACKING = "TRACKING"
    OCCLUDED = "OCCLUDED"
    RECOVERING = "RECOVERING"
    LOST = "LOST"
    FAILED = "FAILED"
    FINISHED = "FINISHED"

@dataclass
class TrackedObjectState:
    id: str
    bbox: List[int] # [x, y, w, h]
    normalized: List[float] # [x, y, w, h] 0.0-1.0
    rotation: float
    confidence: float
    state: str

@dataclass
class FrameResult:
    frame: int
    time: float
    objects: List[TrackedObjectState] = field(default_factory=list)

@dataclass
class TrackingResultData:
    schema: str = "tracking-v2.2"
    video: Dict[str, Any] = field(default_factory=dict)
    frames: List[FrameResult] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "schema": self.schema,
            "video": self.video,
            "frames": [
                {
                    "frame": f.frame,
                    "time": f.time,
                    "objects": [
                        {
                            "id": o.id,
                            "bbox": o.bbox,
                            "normalized": o.normalized,
                            "rotation": o.rotation,
                            "confidence": o.confidence,
                            "state": o.state
                        }
                        for o in f.objects
                    ]
                }
                for f in self.frames
            ]
        }

@dataclass
class TrajectoryData:
    schema: str = "tracking-v2.2"
    trajectories: Dict[str, List[List[float]]] = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        result = {"schema": self.schema}
        for k, v in self.trajectories.items():
            result[k] = v
        return result
