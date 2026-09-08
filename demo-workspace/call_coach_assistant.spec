# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Call Coach local assistant (Windows onedir build)."""

block_cipher = None

a = Analysis(
    ["demo_app.py"],
    pathex=["."],
    binaries=[],
    datas=[
        ("demo_app", "demo_app"),
        (".env.example", "."),
    ],
    hiddenimports=[
        "app_paths",
        "demo_core",
        "security",
        "upload_parse",
        "job_log",
        "tkinter",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="CallCoachAssistant",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="CallCoachAssistant",
)
