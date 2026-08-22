import cv2
import os
import urllib.request
from typing import Tuple, Optional, Dict, Any
from .base_tracker import BaseTracker
from .tracker_registry import TrackerRegistry

@TrackerRegistry.register("NANO")
class NanoTracker(BaseTracker):
    def __init__(self):
        # We will initialize the actual tracker in the initialize() method 
        # so we only download the models if the tracker is actually used.
        self.tracker = None
        
    @classmethod
    def capabilities(cls) -> Dict[str, Any]:
        return {
            "name": "NANO",
            "supportsScale": True,
            "supportsRotation": False,
            "speed": "fast",
            "accuracy": "high"
        }

    def _ensure_models(self):
        models_dir = os.path.join(os.path.dirname(__file__), "..", "models", "nanotrack")
        os.makedirs(models_dir, exist_ok=True)
        
        backbone_path = os.path.join(models_dir, "nanotrack_backbone_sim.onnx")
        head_path = os.path.join(models_dir, "nanotrack_head_sim.onnx")
        
        backbone_url = "https://github.com/HonglinChu/SiamTrackers/raw/c2ff8479624b12ef2dcd830c47f2495a2c4852d4/NanoTrack/models/nanotrackv2/nanotrack_backbone_sim.onnx"
        head_url = "https://github.com/HonglinChu/SiamTrackers/raw/c2ff8479624b12ef2dcd830c47f2495a2c4852d4/NanoTrack/models/nanotrackv2/nanotrack_head_sim.onnx"
        
        if not os.path.exists(backbone_path):
            print(f"Downloading NanoTrack backbone to {backbone_path}...")
            urllib.request.urlretrieve(backbone_url, backbone_path)
            
        if not os.path.exists(head_path):
            print(f"Downloading NanoTrack head to {head_path}...")
            urllib.request.urlretrieve(head_url, head_path)
            
        return backbone_path, head_path

    def initialize(self, frame, bbox: Tuple[int, int, int, int]) -> bool:
        try:
            backbone_path, head_path = self._ensure_models()
            
            params = cv2.TrackerNano_Params()
            params.backbone = backbone_path
            params.neckhead = head_path
            
            self.tracker = cv2.TrackerNano_create(params)
            self.tracker.init(frame, bbox)
            return True
        except Exception as e:
            print(f"Failed to initialize NanoTracker: {e}")
            # Fallback to MIL if Nano fails (e.g. OpenCV version too old)
            self.tracker = cv2.TrackerMIL_create()
            self.tracker.init(frame, bbox)
            return True

    def update(self, frame) -> Tuple[bool, Optional[Tuple[int, int, int, int]]]:
        if not self.tracker:
            return False, None
            
        success, bbox = self.tracker.update(frame)
        if success:
            x, y, w, h = [int(v) for v in bbox]
            return True, (x, y, w, h)
        return False, None
