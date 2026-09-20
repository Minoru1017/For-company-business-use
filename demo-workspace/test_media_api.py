#!/usr/bin/env python3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest import mock

from http.server import ThreadingHTTPServer

import demo_app
import demo_core
import security


class MediaApiTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        inp = self.root / "input"
        inp.mkdir()
        self.media = inp / "demo.mp4"
        self.media.write_bytes(b"0123456789" * 100)
        self.patcher = mock.patch.object(demo_core, "ROOT", self.root)
        self.patcher.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), demo_app.Handler)
        self.port = self.server.server_address[1]
        self.port_patcher = mock.patch.object(demo_app, "PORT", self.port)
        self.port_patcher.start()
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.port_patcher.stop()
        self.patcher.stop()
        self.tmp.cleanup()

    def _get(self, path: str, headers: dict | None = None) -> tuple[int, dict[str, str], bytes]:
        base = {**headers} if headers else {}
        base.setdefault("Host", f"127.0.0.1:{self.port}")
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", headers=base)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def test_resolve_input_mp4(self) -> None:
        path = demo_core.resolve_input_mp4("demo.mp4")
        self.assertEqual(path.name, "demo.mp4")

    def test_media_list_json(self) -> None:
        status, _, body = self._get(
            "/api/media",
            {security.TOKEN_HEADER: security.API_TOKEN},
        )
        self.assertEqual(status, 200)
        data = __import__("json").loads(body.decode())
        self.assertTrue(data["ok"])
        self.assertEqual(data["files"][0]["name"], "demo.mp4")

    def test_media_range_with_query_token(self) -> None:
        status, headers, body = self._get(
            f"/api/media/demo.mp4?token={security.API_TOKEN}",
            {"Range": "bytes=0-9"},
        )
        self.assertEqual(status, 206)
        self.assertEqual(headers.get("Accept-Ranges"), "bytes")
        self.assertEqual(headers.get("Content-Range"), "bytes 0-9/1000")
        self.assertEqual(body, b"0123456789")

    def test_media_requires_token(self) -> None:
        status, _, _ = self._get("/api/media/demo.mp4")
        self.assertEqual(status, 401)


if __name__ == "__main__":
    unittest.main()
