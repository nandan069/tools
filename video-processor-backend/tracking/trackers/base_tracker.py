from abc import ABC, abstractmethod
from typing import Tuple, Optional, Dict, Any

class BaseTracker(ABC):
    @classmethod
    @abstractmethod
    def capabilities(cls) -> Dict[str, Any]:
        """Return the tracker's capabilities."""
        pass
        
    @abstractmethod
    def initialize(self, frame, bbox: Tuple[int, int, int, int]) -> bool:
        """Initialize the tracker with the first frame and bounding box."""
        pass

    @abstractmethod
    def update(self, frame) -> Tuple[bool, Optional[Tuple[int, int, int, int]]]:
        """
        Update the tracker with a new frame.
        Returns a tuple: (success, bounding_box)
        bounding_box format: (x, y, w, h)
        """
        pass
