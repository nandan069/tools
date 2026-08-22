from abc import ABC, abstractmethod
from typing import List

class SmoothingStrategy(ABC):
    @abstractmethod
    def smooth(self, current_val: float, new_val: float) -> float:
        pass

class EMASmoothing(SmoothingStrategy):
    def __init__(self, alpha: float = 0.15):
        self.alpha = alpha
        self.last_smoothed = None
        
    def smooth(self, current_val: float, new_val: float) -> float:
        if self.last_smoothed is None:
            self.last_smoothed = new_val
        else:
            self.last_smoothed = (self.alpha * new_val) + ((1 - self.alpha) * self.last_smoothed)
        return self.last_smoothed

class KalmanSmoothing(SmoothingStrategy):
    def smooth(self, current_val: float, new_val: float) -> float:
        # Stub
        return new_val

class SavitzkyGolaySmoothing(SmoothingStrategy):
    def smooth(self, current_val: float, new_val: float) -> float:
        # Stub
        return new_val
