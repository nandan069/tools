from abc import ABC, abstractmethod
from typing import List, Dict, Any

class Detector(ABC):
    @abstractmethod
    def detect(self, frame) -> List[Dict[str, Any]]:
        pass

class NullDetector(Detector):
    def detect(self, frame) -> List[Dict[str, Any]]:
        return []

class YOLODetector(Detector):
    def detect(self, frame) -> List[Dict[str, Any]]:
        # Stub
        return []

class SAMDetector(Detector):
    def detect(self, frame) -> List[Dict[str, Any]]:
        # Stub
        return []

class MediaPipeDetector(Detector):
    def detect(self, frame) -> List[Dict[str, Any]]:
        # Stub
        return []
