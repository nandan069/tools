from typing import Dict, Type
from .renderer_base import RendererBase
from .ass_renderer import ASSRenderer

class RendererFactory:
    _renderers: Dict[str, Type[RendererBase]] = {
        "ASS": ASSRenderer
    }
    
    @classmethod
    def get_renderer(cls, name: str) -> RendererBase:
        if name not in cls._renderers:
            raise ValueError(f"Renderer {name} not found")
        return cls._renderers[name]()
