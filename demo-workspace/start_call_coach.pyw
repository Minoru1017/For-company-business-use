# Launch Call Coach local assistant (no console window on Windows)
import os
import sys
import traceback

os.chdir(os.path.dirname(os.path.abspath(__file__)))


def _show_error(msg: str) -> None:
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, msg, "Call Coach 本機助手", 0x10)
    except Exception:
        pass


try:
    import runpy

    runpy.run_path("demo_app.py", run_name="__main__")
except SystemExit:
    raise
except Exception:
    detail = traceback.format_exc().strip()
    _show_error(
        "無法啟動本機助手。\n\n"
        "請改雙擊 start_call_coach.cmd（命令指令檔，不是 Python 圖示那個），"
        "黑窗出現且顯示「本機助手」後，回到 Call Coach 重新整理。\n\n"
        f"錯誤詳情：\n{detail[-1200:]}"
    )
    raise SystemExit(1) from None
