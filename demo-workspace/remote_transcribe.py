"""Company-side client for the remote transcription Worker (see ``worker_server.py``).

Flow: health check → upload the WAV with a percent bar → poll the job and relay every WhisperX
log line (so ``progress_tracker`` parses the same ``>>Performing…`` / ``Progress: xx%`` markers it
already knows) → download the SRT → delete the job on the worker. Pure stdlib, works over
Tailscale (``http://100.x.y.z:8766``) or a Cloudflare Tunnel (``https://…``).
"""
from __future__ import annotations

import http.client
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import security

LogFn = Callable[[str], None]

CANCEL_EXIT = 130
HEALTH_TIMEOUT_S = 15
UPLOAD_CHUNK = 1024 * 1024
POLL_INTERVAL_S = 1.0
POLL_TIMEOUT_S = 30
# A home connection may drop for a bit; keep trying before giving up on a running job.
POLL_MAX_OUTAGE_S = 3 * 60
HEARTBEAT_S = 60


class WorkerError(Exception):
    pass


def _headers(token: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {security.WORKER_TOKEN_HEADER: token, "Accept": "application/json"}
    if extra:
        headers.update(extra)
    return headers


def _request(method: str, url: str, token: str, *, timeout: float, body: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers=_headers(token))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _json_or_message(status: int, body: bytes) -> dict:
    try:
        data = json.loads(body.decode("utf-8", errors="replace"))
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if status == 401:
        data.setdefault("message", "Worker Token 不正確（請重新貼上家用主機 Worker 視窗顯示的 Token）")
    elif status == 404 and not data.get("message"):
        data["message"] = "遠端主機回應 404 — 網址可能不是 Call Coach Worker（請確認埠號／tunnel 網址）"
    elif status >= 400 and not data.get("message"):
        data["message"] = f"遠端主機回應 HTTP {status}"
    return data


def describe_connection_error(exc: Exception, worker_url: str) -> str:
    text = str(exc)
    hints = "請確認：① 家用主機的 Worker 視窗已開著 ② Tailscale 兩端都已登入（或 Cloudflare Tunnel 在跑） ③ 網址與埠號正確"
    if isinstance(exc, urllib.error.URLError):
        text = str(exc.reason)
    return f"無法連線遠端主機 {worker_url}：{text}。{hints}"


def fetch_health(worker_url: str, token: str, *, timeout: float = HEALTH_TIMEOUT_S) -> dict:
    """GET /worker/health; raises WorkerError with a user-facing message on any failure."""
    try:
        status, body = _request("GET", f"{worker_url}/worker/health", token, timeout=timeout)
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        raise WorkerError(describe_connection_error(e, worker_url)) from e
    data = _json_or_message(status, body)
    if status != 200 or not data.get("ok"):
        raise WorkerError(data.get("message") or f"遠端主機回應 HTTP {status}")
    if data.get("worker") != "call-coach":
        raise WorkerError("這個網址不是 Call Coach Worker（請確認填的是 Worker 的網址，而不是別的服務）")
    return data


def _upload(
    audio: Path,
    worker_url: str,
    token: str,
    *,
    log: LogFn,
    cancel_check: Callable[[], bool],
    on_percent: Callable[[float], None] | None = None,
) -> str:
    """POST the audio in 1 MB chunks (so we can show percent and honour cancel). Returns job_id."""
    parsed = urlparse(worker_url)
    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    size = audio.stat().st_size
    conn = conn_cls(parsed.hostname or "", parsed.port, timeout=POLL_TIMEOUT_S)
    try:
        conn.putrequest("POST", "/worker/jobs")
        for k, v in _headers(token, {"X-Job-Name": audio.name, "Content-Type": "audio/wav"}).items():
            conn.putheader(k, v)
        conn.putheader("Content-Length", str(size))
        conn.endheaders()
        sent = 0
        with audio.open("rb") as f:
            while True:
                if cancel_check():
                    raise _Cancelled()
                chunk = f.read(UPLOAD_CHUNK)
                if not chunk:
                    break
                conn.send(chunk)
                sent += len(chunk)
                if on_percent:
                    on_percent(sent / size * 100 if size else 100.0)
        resp = conn.getresponse()
        body = resp.read()
        data = _json_or_message(resp.status, body)
        if resp.status not in (200, 201) or not data.get("job_id"):
            raise WorkerError(data.get("message") or f"上傳失敗（HTTP {resp.status}）")
        queued = int(data.get("queued") or 0)
        if queued > 1:
            log(f"[遠端] 前面還有 {queued - 1} 個工作在排隊，會依序處理")
        return str(data["job_id"])
    except (OSError, http.client.HTTPException) as e:
        raise WorkerError(describe_connection_error(e, worker_url)) from e
    finally:
        conn.close()


class _Cancelled(Exception):
    pass


def _cancel_remote(worker_url: str, token: str, job_id: str) -> None:
    try:
        _request("POST", f"{worker_url}/worker/jobs/{job_id}/cancel", token, timeout=10, body=b"")
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        pass


def _delete_remote(worker_url: str, token: str, job_id: str) -> None:
    try:
        _request("POST", f"{worker_url}/worker/jobs/{job_id}/delete", token, timeout=10, body=b"")
    except (urllib.error.URLError, OSError, http.client.HTTPException):
        pass


def _poll(
    worker_url: str,
    token: str,
    job_id: str,
    *,
    log: LogFn,
    cancel_check: Callable[[], bool],
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> dict:
    since = 0
    last_ok = clock()
    last_line_at = clock()
    warned_outage = False
    while True:
        if cancel_check():
            raise _Cancelled()
        try:
            status, body = _request("GET", f"{worker_url}/worker/jobs/{job_id}?since={since}", token, timeout=POLL_TIMEOUT_S)
        except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
            if clock() - last_ok > POLL_MAX_OUTAGE_S:
                raise WorkerError(describe_connection_error(e, worker_url)) from e
            if not warned_outage:
                log("[遠端] 與遠端主機連線中斷，持續重試中（最多 3 分鐘）…")
                warned_outage = True
            sleep(min(5.0, POLL_INTERVAL_S * 3))
            continue
        data = _json_or_message(status, body)
        if status != 200 or not data.get("ok"):
            raise WorkerError(data.get("message") or f"查詢工作狀態失敗（HTTP {status}）")
        last_ok = clock()
        if warned_outage:
            log("[遠端] 已重新連上遠端主機")
            warned_outage = False
        lines = data.get("lines") or []
        for line in lines:
            log(str(line))
        if lines:
            last_line_at = clock()
        elif clock() - last_line_at >= HEARTBEAT_S:
            log(f"[遠端] 遠端主機仍在處理中（狀態：{data.get('state')}）…")
            last_line_at = clock()
        since = int(data.get("next") or since)
        state = str(data.get("state") or "")
        if state in ("done", "failed", "cancelled"):
            return data
        sleep(POLL_INTERVAL_S)


def _download_srt(worker_url: str, token: str, job_id: str) -> str:
    try:
        status, body = _request("GET", f"{worker_url}/worker/jobs/{job_id}/srt", token, timeout=POLL_TIMEOUT_S * 2)
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:
        raise WorkerError(describe_connection_error(e, worker_url)) from e
    if status != 200:
        raise WorkerError(_json_or_message(status, body).get("message") or f"下載 SRT 失敗（HTTP {status}）")
    text = body.decode("utf-8", errors="replace")
    if not text.strip():
        raise WorkerError("遠端主機回傳的 SRT 是空的（音檔可能沒有語音）")
    return text


def run_remote_transcribe(
    audio: Path,
    output_srt: Path,
    *,
    worker_url: str,
    token: str,
    log: LogFn,
    cancel_check: Callable[[], bool],
    duration_s: float = 0.0,
    progress=None,
    sleep: Callable[[float], None] = time.sleep,
) -> int:
    """Transcribe ``audio`` on the remote Worker and write ``output_srt``. Returns an exit code."""
    from progress_tracker import estimate_remote_minutes

    worker_url = worker_url.rstrip("/")
    started = time.monotonic()
    job_id: str | None = None
    try:
        health = fetch_health(worker_url, token)
        gpu = bool(health.get("gpu_available"))
        where = f"{health.get('name', '遠端主機')}｜{health.get('gpu') or 'CPU'}｜{health.get('model')}"
        log(f"[遠端] 已連上 Worker：{where}")
        if not gpu:
            log("[提醒] 遠端主機沒有可用 GPU，速度不會比公司電腦快（請在該主機重新安裝 GPU 版）")
        if health.get("busy"):
            log(f"[遠端] 遠端主機正在處理其他工作（排隊 {int(health.get('queued') or 0)} 件），會接續處理")
        if health.get("whisperx_ok") is False:
            raise WorkerError("遠端主機尚未安裝 WhisperX，請在該主機執行 start_worker.cmd 完成安裝")
        if health.get("hf_token_ok") is False:
            raise WorkerError("遠端主機尚未設定 HF_TOKEN（分軌模型授權），請在該主機的 .env 填入")
        if progress is not None:
            low, high = estimate_remote_minutes(duration_s, gpu=gpu)
            progress.set_eta_minutes(low, high)
            log(f"預估總耗時約 {low}～{high} 分鐘（含上傳）")

        size_mb = audio.stat().st_size / (1024**2)
        log(f"[遠端] 上傳 {size_mb:.1f} MB 音訊到 {worker_url}（音訊只會存在你自己的主機，轉錄完即刪除）…")
        if progress is not None:
            progress.phase("upload", f"{size_mb:.0f} MB")
        job_id = _upload(
            audio,
            worker_url,
            token,
            log=log,
            cancel_check=cancel_check,
            on_percent=(lambda p: progress.set_percent(p)) if progress is not None else None,
        )
        log(f"[遠端] 上傳完成（{int(time.monotonic() - started)} 秒），遠端開始辨識…")

        if progress is not None:
            progress.phase("transcribe")
            relay = progress.wrap_whisperx_log(log, 0)
        else:
            relay = log
        result = _poll(worker_url, token, job_id, log=relay, cancel_check=cancel_check, sleep=sleep)
        state = result.get("state")
        if state == "cancelled":
            log("[已取消] 遠端工作已取消")
            return CANCEL_EXIT
        if state != "done":
            log(f"[錯誤] 遠端轉錄失敗（exit code {result.get('exit_code')}）— 詳細原因請看上方 [Worker] 記錄")
            return int(result.get("exit_code") or 1)

        srt = _download_srt(worker_url, token, job_id)
        output_srt.parent.mkdir(parents=True, exist_ok=True)
        output_srt.write_text(srt, encoding="utf-8")
        if progress is not None:
            progress.part_done(0)
        log(f"[遠端] 完成：耗時 {int(time.monotonic() - started)} 秒 → {output_srt.name}")
        return 0
    except _Cancelled:
        if job_id:
            _cancel_remote(worker_url, token, job_id)
        log("[已取消] 已通知遠端主機停止")
        return CANCEL_EXIT
    except WorkerError as e:
        log(f"[錯誤] {e}")
        return 1
    finally:
        if job_id:
            _delete_remote(worker_url, token, job_id)
