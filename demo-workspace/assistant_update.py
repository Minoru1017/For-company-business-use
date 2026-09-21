"""Check GitHub Releases for a newer Call Coach Assistant installer."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from app_paths import is_frozen

ROOT = Path(__file__).resolve().parent

GITHUB_REPO = "Minoru1017/For-company-business-use"
RELEASES_LATEST_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
SETUP_ASSET_NAME = "CallCoachAssistant-Setup.exe"
TAG_VERSION_RE = re.compile(r"assistant-v(\d+\.\d+\.\d+)", re.I)
VERSION_TXT_RE = re.compile(r"v(\d+\.\d+\.\d+)", re.I)

ALLOWED_SETUP_URL_PREFIXES = (
    f"https://github.com/{GITHUB_REPO}/releases/download/",
    f"https://github.com/{GITHUB_REPO}/releases/latest/download/",
)

_cache: dict | None = None
_cache_at = 0.0
CACHE_TTL_S = 6 * 3600


def parse_semver(text: str) -> tuple[int, int, int] | None:
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def compare_semver(a: str, b: str) -> int:
    """Return -1 if a<b, 0 if equal, 1 if a>b."""
    pa, pb = parse_semver(a), parse_semver(b)
    if not pa or not pb:
        return 0
    if pa < pb:
        return -1
    if pa > pb:
        return 1
    return 0


def read_installed_version(root: Path | None = None) -> str | None:
    root = root or ROOT
    version_file = root / "VERSION.txt"
    if version_file.is_file():
        text = version_file.read_text(encoding="utf-8", errors="replace")
        m = VERSION_TXT_RE.search(text)
        if m:
            return m.group(1)
    pkg = root.parent / "package.json"
    if not is_frozen() and pkg.is_file():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            ver = str(data.get("version", "")).strip()
            return ver if parse_semver(ver) else None
        except (OSError, json.JSONDecodeError):
            pass
    return None


def is_allowed_setup_download_url(url: str) -> bool:
    url = (url or "").strip()
    if not url.startswith("https://"):
        return False
    return any(url.startswith(p) for p in ALLOWED_SETUP_URL_PREFIXES)


def setup_download_url_override() -> str:
    from demo_core import load_env

    return load_env().get("CALL_COACH_ASSISTANT_SETUP_URL", "").strip()


def skip_update_check() -> bool:
    from demo_core import load_env

    flag = load_env().get("CALL_COACH_SKIP_UPDATE_CHECK", "").strip().lower()
    return flag in ("1", "true", "yes", "on")


def _fetch_latest_release() -> dict:
    req = urllib.request.Request(
        RELEASES_LATEST_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "CallCoachAssistant-UpdateCheck",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _pick_setup_asset(release: dict) -> str | None:
    for asset in release.get("assets") or []:
        if asset.get("name") == SETUP_ASSET_NAME:
            url = asset.get("browser_download_url")
            if url:
                return str(url)
    return None


def check_for_update(*, force_refresh: bool = False, root: Path | None = None) -> dict:
    """Return update metadata for /api/update/check."""
    global _cache, _cache_at
    current = read_installed_version(root)
    release_page = f"https://github.com/{GITHUB_REPO}/releases/latest"
    base = {
        "ok": True,
        "current": current,
        "latest": current,
        "update_available": False,
        "download_url": None,
        "release_page_url": release_page,
        "release_name": None,
        "skipped": skip_update_check(),
    }
    if skip_update_check():
        base["message"] = "已設定 CALL_COACH_SKIP_UPDATE_CHECK"
        return base
    if not current:
        base["ok"] = False
        base["message"] = "無法讀取目前助手版本（VERSION.txt）"
        return base

    now = time.time()
    if not force_refresh and _cache and (now - _cache_at) < CACHE_TTL_S:
        release = _cache
    else:
        try:
            release = _fetch_latest_release()
            _cache = release
            _cache_at = now
        except urllib.error.HTTPError as e:
            return {
                **base,
                "ok": False,
                "message": f"無法查詢 GitHub Release（HTTP {e.code}）",
            }
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            return {**base, "ok": False, "message": f"無法連線 GitHub：{e}"}

    tag = str(release.get("tag_name") or "")
    m = TAG_VERSION_RE.search(tag)
    latest = m.group(1) if m else None
    if not latest:
        name = str(release.get("name") or "")
        parsed = parse_semver(name)
        latest = f"{parsed[0]}.{parsed[1]}.{parsed[2]}" if parsed else None
    if not latest:
        return {**base, "ok": False, "message": f"無法解析 Release 版本（tag={tag}）"}

    download = setup_download_url_override() or _pick_setup_asset(release)
    if download and not is_allowed_setup_download_url(download):
        download = None

    update_available = compare_semver(current, latest) < 0
    return {
        "ok": True,
        "current": current,
        "latest": latest,
        "update_available": update_available,
        "download_url": download,
        "release_page_url": str(release.get("html_url") or release_page),
        "release_name": str(release.get("name") or tag),
        "skipped": False,
    }


def open_setup_download(url: str) -> None:
    """Open official Setup.exe download in the default browser / handler."""
    import os
    import sys

    url = url.strip()
    if not is_allowed_setup_download_url(url):
        raise ValueError("僅允許從本專案 GitHub Releases 下載安裝包")
    if sys.platform == "win32":
        os.startfile(url)  # type: ignore[attr-defined]
    else:
        import webbrowser

        webbrowser.open(url)
