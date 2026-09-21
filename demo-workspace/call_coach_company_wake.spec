# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — company PC wake / DeskIn launcher only."""

block_cipher = None

a = Analysis(
    ["company_wake_app.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=[
        "company_wake_config",
        "wol_utils",
        "tkinter",
        "tkinter.ttk",
        "tkinter.scrolledtext",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["demo_core", "whisperx"],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="CallCoachCompanyWake",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
