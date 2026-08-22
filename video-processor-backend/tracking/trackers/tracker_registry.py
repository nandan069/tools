from typing import Dict, Type, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from .base_tracker import BaseTracker

class TrackerRegistry:
    _trackers: Dict[str, Type['BaseTracker']] = {}

    @classmethod
    def register(cls, name: str):
        def wrapper(tracker_class: Type['BaseTracker']):
            cls._trackers[name] = tracker_class
            return tracker_class
        return wrapper

    @classmethod
    def get_tracker(cls, name: str) -> Type['BaseTracker']:
        # Map frontend profiles to specific trackers
        name_map = {
            "BALANCED": "NANO",
            "FAST": "KCF",
            "ACCURATE": "NANO"
        }
        mapped_name = name_map.get(name.upper(), name.upper())
        
        if mapped_name not in cls._trackers:
            raise ValueError(f"Tracker '{name}' (mapped to '{mapped_name}') is not registered.")
        return cls._trackers[mapped_name]

    @classmethod
    def get_capabilities(cls, name: str) -> Dict[str, Any]:
        tracker_class = cls.get_tracker(name)
        return tracker_class.capabilities()
