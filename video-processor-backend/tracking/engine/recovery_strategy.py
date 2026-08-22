from abc import ABC, abstractmethod
from typing import Optional, List

class RecoveryStrategy(ABC):
    @abstractmethod
    def attempt_recovery(self, frame, last_known_bbox) -> Optional[List[int]]:
        pass

class ConsecutiveFailureRecovery(RecoveryStrategy):
    def __init__(self, max_failures: int = 5):
        self.max_failures = max_failures
        self.current_failures = 0
        
    def attempt_recovery(self, frame, last_known_bbox) -> Optional[List[int]]:
        self.current_failures += 1
        if self.current_failures <= self.max_failures:
            # We haven't completely given up yet, but we don't have a new bbox.
            # In a real system, we might expand the search window. 
            # For this simple strategy, we just return the last known bbox as a guess
            # to let the tracker try again next frame around that area.
            return last_known_bbox
        return None

class TemplateMatchRecovery(RecoveryStrategy):
    def attempt_recovery(self, frame, last_known_bbox) -> Optional[List[int]]:
        # Stub
        return None

class OpticalFlowRecovery(RecoveryStrategy):
    def attempt_recovery(self, frame, last_known_bbox) -> Optional[List[int]]:
        # Stub
        return None

class DetectorRecovery(RecoveryStrategy):
    def attempt_recovery(self, frame, last_known_bbox) -> Optional[List[int]]:
        # Stub
        return None
