from abc import ABC, abstractmethod

class ExecutionBackend(ABC):
    @abstractmethod
    def initialize(self):
        pass
        
    @abstractmethod
    def cleanup(self):
        pass

class CPUBackend(ExecutionBackend):
    def initialize(self):
        # We might set OpenCV to use CPU explicitly or set thread counts
        import cv2
        cv2.setNumThreads(4)
        
    def cleanup(self):
        pass

class GPUBackend(ExecutionBackend):
    def initialize(self):
        # Placeholder for CUDA / OpenCL initialization
        pass
        
    def cleanup(self):
        pass
