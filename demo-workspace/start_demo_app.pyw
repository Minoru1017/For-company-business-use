# Launch DEMO transcription assistant (no console window on Windows)
import os
import runpy

os.chdir(os.path.dirname(os.path.abspath(__file__)))
runpy.run_path("demo_app.py", run_name="__main__")
