from abc import ABC, abstractmethod
from tracking.engine.pipeline_context import PipelineContext

class RendererBase(ABC):
    @abstractmethod
    def render(self, context: PipelineContext):
        pass
