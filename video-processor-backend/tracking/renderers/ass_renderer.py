import os
import json
from .renderer_base import RendererBase
from tracking.engine.pipeline_context import PipelineContext

class ASSRenderer(RendererBase):
    
    def _format_time(self, seconds: float) -> str:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = seconds % 60
        return f"{hours}:{minutes:02d}:{secs:05.2f}"
        
    def _hex_to_ass_bgr(self, hex_str: str) -> str:
        hex_str = str(hex_str).lstrip('#').lower()
        if hex_str == 'red': return "&H0000FF&"
        if hex_str == 'green': return "&H00FF00&"
        if hex_str == 'blue': return "&HFF0000&"
        if hex_str == 'yellow': return "&H00FFFF&"
        if hex_str == 'white': return "&HFFFFFF&"
        if hex_str == 'black': return "&H000000&"
        if hex_str == 'magenta': return "&HFF00FF&"
        if hex_str == 'cyan': return "&HFFFF00&"
        
        if len(hex_str) == 6:
            r, g, b = hex_str[0:2], hex_str[2:4], hex_str[4:6]
            return f"&H{b}{g}{r}&"
        return "&H0000FF&" # Default red

    def render(self, context: PipelineContext):
        import time
        start_time = time.time()
        context.set_status("rendering", "running")
        context.logger.info("ASS Renderer started.")
        
        job_dir = os.path.dirname(context.manifest_path)
        tracking_json_path = os.path.join(job_dir, context.manifest.runtime.artifacts.get("tracking", "tracking.json"))
        
        with open(tracking_json_path, 'r') as f:
            tracking_data = json.load(f)
            
        fps = tracking_data.get('video', {}).get('fps', 30)
        width = tracking_data.get('video', {}).get('width', 1920)
        height = tracking_data.get('video', {}).get('height', 1080)
        
        if "ass" not in context.manifest.runtime.artifacts:
            context.manifest.runtime.artifacts["ass"] = []
            
        header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CircleStyle,Arial,50,&H000000FF&,&H000000FF&,&H000000FF&,&H00000000&,0,0,0,0,100,100,0,0,1,5,0,5,0,0,0,1
Style: ArrowStyle,Arial,120,&H000000FF&,&H000000FF&,&H00000000&,&H00000000&,0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

        for layer in context.manifest.config.layers:
            target_id = layer.target_id
            ass_color = self._hex_to_ass_bgr(layer.color)
            size = layer.size
            
            ass_path = os.path.join(job_dir, f"{layer.id}.ass")
            
            with open(ass_path, 'w') as f_out:
                f_out.write(header)
                
                # Iterate through frames
                for frame_data in tracking_data.get('frames', []):
                    t_start = frame_data['time']
                    t_end = t_start + (1.0 / fps)
                    
                    for obj in frame_data.get('objects', []):
                        if obj['id'] == target_id and obj['state'] == "TRACKING":
                            bbox = obj['bbox']
                            x, y, w, h = bbox
                            cx = int(x + w/2)
                            cy = int(y + h/2)
                            
                            start_str = self._format_time(t_start)
                            end_str = self._format_time(t_end)
                            
                            if layer.type == 'circle':
                                # Ascent for Arial Fontsize 50 is approximately 45 pixels.
                                # Using \an7 places the top of the bounding box at (cx, cy).
                                radius = int(max(w, h) / 2)
                                text = f"{{\\pos({cx},{cy + radius})\\1a&HFF&\\3a&H00&\\3c{ass_color}\\p1}}m 0 {-radius} b {radius} {-radius} {radius} {radius} 0 {radius} b {-radius} {radius} {-radius} {-radius} 0 {-radius}{{\\p0}}"
                                f_out.write(f"Dialogue: 0,{start_str},{end_str},CircleStyle,,0,0,0,,{text}\n")
                            elif layer.type == 'arrow':
                                # Arrow points down at the top of the bounding box.
                                offset = int(h / 2) + 20
                                # For text, \an2 (bottom-center) aligns the bottom of the bounding box to the given pos.
                                # The bottom of the bounding box includes Descent (approx 10px).
                                text = f"{{\\an2\\pos({cx},{cy - offset})\\1a&H00&\\1c{ass_color}}}▼"
                                f_out.write(f"Dialogue: 0,{start_str},{end_str},ArrowStyle,,0,0,0,,{text}\n")
                                
            context.manifest.runtime.artifacts["ass"].append(f"{layer.id}.ass")
            
        render_time = time.time() - start_time
        context.manifest.runtime.metrics["renderMs"] = render_time * 1000
        
        context.update_progress("rendering", 100)
        context.set_status("rendering", "completed")
        context.save()
        context.logger.info("ASS Renderer finished.")
