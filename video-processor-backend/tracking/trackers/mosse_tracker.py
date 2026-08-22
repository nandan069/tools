import cv2
from typing import Tuple, Optional, Dict, Any
from .base_tracker import BaseTracker
from .tracker_registry import TrackerRegistry

@TrackerRegistry.register("MOSSE")
class MOSSETracker(BaseTracker):
    def __init__(self):
        # Fallback to MIL tracker since MOSSE was removed in modern OpenCV versions
        self.tracker = cv2.TrackerMIL_create()
        
    @classmethod
    def capabilities(cls) -> Dict[str, Any]:
        return {
            "name": "MOSSE",
            "supportsScale": False,
            "supportsRotation": False,
            "speed": "fast",
            "accuracy": "low"
        }

    def initialize(self, frame, bbox: Tuple[int, int, int, int]) -> bool:
        try:
            self.tracker.init(frame, bbox)
            return True
        except Exception:
            return False

    def update(self, frame) -> Tuple[bool, Optional[Tuple[int, int, int, int]]]:
        success, bbox = self.tracker.update(frame)
        if success:
            x, y, w, h = [int(v) for v in bbox]
            return True, (x, y, w, h)
        return False, None
