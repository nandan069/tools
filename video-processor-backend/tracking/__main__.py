import argparse
import sys
from tracking.engine.pipeline_context import PipelineContext
from tracking.engine.tracking_engine import TrackingEngine
from tracking.renderers.renderer_factory import RendererFactory

def main():
    parser = argparse.ArgumentParser(description="AI Tracker V2.2 Pipeline")
    parser.add_argument("--manifest", required=True, help="Path to manifest.json")
    parser.add_argument("--render-all", action="store_true", help="Run renderers after tracking")
    args = parser.parse_args()

    context = PipelineContext(args.manifest)
    
    # Validation
    try:
        context.validate()
        context.save_checkpoint("initial")
    except Exception as e:
        context.set_status("tracking", "failed")
        context.logger.exception("Validation failed")
        context.save()
        sys.exit(1)
        
    # Execute Tracking
    try:
        engine = TrackingEngine(context)
        engine.run()
        context.save_checkpoint("tracking")
    except Exception as e:
        context.set_status("tracking", "failed")
        context.logger.exception("Tracking failed")
        context.save()
        sys.exit(1)
        
    # Execute Rendering
    if args.render_all:
        try:
            renderer = RendererFactory.get_renderer("ASS")
            renderer.render(context)
            context.save_checkpoint("completed")
        except Exception as e:
            context.set_status("rendering", "failed")
            context.logger.exception("Rendering failed")
            context.save()
            sys.exit(1)
            
if __name__ == "__main__":
    main()
