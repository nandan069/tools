import json
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

@dataclass
class TrackerConfig:
    id: str
    profile: str
    start_time: float
    end_time: float
    bbox_percent: List[float] # [x, y, w, h] in percentages (0-100)

@dataclass
class LayerConfig:
    id: str
    target_id: str
    type: str
    color: str
    size: float

@dataclass
class ManifestConfig:
    video: str
    trackers: List[TrackerConfig]
    layers: List[LayerConfig]

@dataclass
class ManifestRuntime:
    status: Dict[str, str] = field(default_factory=dict)
    statistics: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, float] = field(default_factory=dict)
    environment: Dict[str, str] = field(default_factory=dict)
    artifacts: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)
    progress: Dict[str, int] = field(default_factory=dict)

@dataclass
class TrackingManifest:
    schema: str
    pipelineVersion: str
    config: ManifestConfig
    runtime: ManifestRuntime
    features: Dict[str, bool] = field(default_factory=dict)

    @staticmethod
    def from_dict(data: dict) -> 'TrackingManifest':
        config_data = data.get('config', {})
        trackers = [TrackerConfig(**t) for t in config_data.get('trackers', [])]
        layers = [LayerConfig(**l) for l in config_data.get('layers', [])]
        config = ManifestConfig(
            video=config_data.get('video', ''),
            trackers=trackers,
            layers=layers
        )

        runtime_data = data.get('runtime', {})
        runtime = ManifestRuntime(
            status=runtime_data.get('status', {}),
            statistics=runtime_data.get('statistics', {}),
            metrics=runtime_data.get('metrics', {}),
            environment=runtime_data.get('environment', {}),
            artifacts=runtime_data.get('artifacts', {}),
            events=runtime_data.get('events', []),
            progress=runtime_data.get('progress', {})
        )
        
        return TrackingManifest(
            schema=data.get('schema', 'tracking-v2.2'),
            pipelineVersion=data.get('pipelineVersion', '2.2.0'),
            config=config,
            runtime=runtime,
            features=data.get('features', {})
        )

    def to_dict(self) -> dict:
        return {
            "schema": self.schema,
            "pipelineVersion": self.pipelineVersion,
            "features": self.features,
            "config": {
                "video": self.config.video,
                "trackers": [t.__dict__ for t in self.config.trackers],
                "layers": [l.__dict__ for l in self.config.layers]
            },
            "runtime": {
                "status": self.runtime.status,
                "statistics": self.runtime.statistics,
                "metrics": self.runtime.metrics,
                "environment": self.runtime.environment,
                "artifacts": self.runtime.artifacts,
                "events": self.runtime.events,
                "progress": self.runtime.progress
            }
        }
