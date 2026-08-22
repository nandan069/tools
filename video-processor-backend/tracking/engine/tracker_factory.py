import cv2
from ..trackers.base_tracker import BaseTracker
from ..trackers.csrt_tracker import CSRTTracker

class TrackerFactory:
    @staticmethod
    def create_tracker(profile="BALANCED"):
        """
        Creates a tracker based on the provided profile.
        FAST -> MOSSE (or MIL if unavailable)
        BALANCED -> CSRT
        LEGACY -> KCF
        """
        profile = profile.upper()
        if profile == "BALANCED":
            return CSRTTracker()
        
        # For this implementation, we will fallback to OpenCV's built-in MIL 
        # or CSRT if others are not compiled in the cv2 binary.
        try:
            if profile == "LEGACY":
                return _create_kcf()
            elif profile == "FAST":
                return _create_mosse()
        except Exception:
            pass
            
        # Default fallback
        return CSRTTracker()

def _create_kcf():
    class KCFTracker(BaseTracker):
        def __init__(self):
            try:
                self.t = cv2.TrackerKCF_create()
            except AttributeError:
                try:
                    self.t = cv2.legacy.TrackerKCF_create()
                except AttributeError:
                    self.t = cv2.TrackerMIL_create()
        def init(self, f, b): self.t.init(f, b)
        def update(self, f): return self.t.update(f)
        @property
        def name(self): return "KCF"
    return KCFTracker()

def _create_mosse():
    class MOSSETracker(BaseTracker):
        def __init__(self):
            try:
                self.t = cv2.legacy.TrackerMOSSE_create()
            except AttributeError:
                self.t = cv2.TrackerMIL_create()
        def init(self, f, b): self.t.init(f, b)
        def update(self, f): return self.t.update(f)
        @property
        def name(self): return "MOSSE"
    return MOSSETracker()
