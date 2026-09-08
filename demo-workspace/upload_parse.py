"""Stream multipart/form-data file uploads without the removed cgi module (Python 3.13+)."""
from __future__ import annotations

import re
from typing import BinaryIO


def _boundary(content_type: str) -> bytes:
    match = re.search(r"boundary=([^;\s]+)", content_type, re.I)
    if not match:
        raise ValueError("multipart 缺少 boundary")
    return match.group(1).strip().strip('"').encode("ascii", "ignore")


def _readline(rfile: BinaryIO) -> bytes:
    out = b""
    while True:
        ch = rfile.read(1)
        if not ch:
            return out
        out += ch
        if out.endswith(b"\r\n"):
            return out


def stream_multipart_file(
    rfile: BinaryIO,
    content_type: str,
    dest: BinaryIO,
    *,
    field_name: str = "file",
    max_bytes: int,
) -> str:
    """Read one file field from multipart body into dest. Returns the filename."""
    delimiter = b"--" + _boundary(content_type)
    filename: str | None = None
    written = 0

    while True:
        line = _readline(rfile)
        if not line:
            raise ValueError("未選擇檔案")
        if line.startswith(delimiter):
            if line.rstrip(b"\r\n") == delimiter + b"--":
                break
            headers: list[str] = []
            while True:
                hline = _readline(rfile)
                if hline in (b"\r\n", b""):
                    break
                headers.append(hline.decode("utf-8", errors="replace"))
            header_text = "".join(headers)
            if f'name="{field_name}"' not in header_text:
                _skip_part(rfile, delimiter)
                continue
            match = re.search(r'filename="([^"]*)"', header_text)
            if not match or not match.group(1).strip():
                raise ValueError("未選擇檔案")
            filename = match.group(1).strip()
            written += _copy_until_boundary(rfile, dest, delimiter, max_bytes - written)
            break

    if not filename:
        raise ValueError("未選擇檔案")
    return filename


def _skip_part(rfile: BinaryIO, delimiter: bytes) -> None:
    end = b"\r\n" + delimiter
    buf = b""
    while True:
        chunk = rfile.read(65536)
        if not chunk:
            return
        buf = (buf + chunk)[-len(end) :]
        if end in buf or delimiter in chunk:
            return


def _copy_until_boundary(
    rfile: BinaryIO,
    dest: BinaryIO,
    delimiter: bytes,
    max_bytes: int,
) -> int:
    end = b"\r\n" + delimiter
    tail = b""
    written = 0
    while True:
        chunk = rfile.read(256 * 1024)
        if not chunk:
            if tail:
                data = tail.rstrip(b"\r\n")
                if len(data) > max_bytes:
                    raise OSError("超過上傳大小上限")
                dest.write(data)
                return written + len(data)
            return written
        data = tail + chunk
        pos = data.find(end)
        if pos >= 0:
            part = data[:pos]
            if len(part) > max_bytes:
                raise OSError("超過上傳大小上限")
            dest.write(part)
            return written + len(part)
        keep = len(end) + 4
        if len(data) > keep:
            body = data[:-keep]
            if len(body) > max_bytes:
                raise OSError("超過上傳大小上限")
            dest.write(body)
            written += len(body)
            tail = data[-keep:]
        else:
            tail = data
