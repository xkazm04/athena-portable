"""Smallest possible frame stream to a webview: MJPEG over HTTP (multipart/x-mixed-replace).

A webview shows it with a plain <img src="http://127.0.0.1:5182/stream">. Producers push RGB
uint8 frames whenever they have them (FlashHead lands 24-28 frames at once per chunk; Ditto one
at a time); a player thread releases them at a fixed fps, so chunked generation still plays as a
steady clock. Frames the player has not shown yet are the jitter buffer; its depth is reported.

    srv = MjpegServer(port=5182, fps=25).start()
    srv.push(frame_rgb)          # any thread
    ...
    srv.stop()

Audio is not carried: the page plays the WAV itself and starts it when the first frame shows
(the server exposes /status with frames shown, so a page can align audio to frame 0).
"""

from __future__ import annotations

import io
import json
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

PAGE = b"""<!doctype html><meta charset=utf-8><title>t2-neural stream</title>
<body style="margin:0;background:#111;display:grid;place-items:center;height:100vh">
<img src="/stream" style="max-height:100vh"></body>"""


class MjpegServer:
    def __init__(self, port: int = 5182, fps: float = 25.0, quality: int = 88):
        self.port, self.fps, self.quality = port, fps, quality
        self.q: queue.Queue = queue.Queue()
        self.latest: bytes | None = None
        self.cond = threading.Condition()
        self.shown = 0
        self.first_shown_at: float | None = None
        self.max_depth = 0
        self._stop = threading.Event()

    def push(self, rgb) -> None:
        self.q.put(rgb)
        self.max_depth = max(self.max_depth, self.q.qsize())

    def _player(self) -> None:
        period = 1.0 / self.fps
        nxt = None
        while not self._stop.is_set():
            try:
                rgb = self.q.get(timeout=0.1)
            except queue.Empty:
                nxt = None  # underrun: restart the clock when frames return
                continue
            now = time.perf_counter()
            nxt = now if nxt is None else nxt
            if nxt > now:
                time.sleep(nxt - now)
            buf = io.BytesIO()
            Image.fromarray(rgb).save(buf, format="JPEG", quality=self.quality)
            with self.cond:
                self.latest = buf.getvalue()
                self.shown += 1
                if self.first_shown_at is None:
                    self.first_shown_at = time.perf_counter()
                self.cond.notify_all()
            nxt += period

    def start(self) -> "MjpegServer":
        srv = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.path == "/status":
                    body = json.dumps({"shown": srv.shown, "queued": srv.q.qsize(),
                                       "max_depth": srv.max_depth}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if self.path != "/stream":
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    self.wfile.write(PAGE)
                    return
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=f")
                self.end_headers()
                last = -1
                try:
                    while not srv._stop.is_set():
                        with srv.cond:
                            srv.cond.wait_for(lambda: srv.shown != last or srv._stop.is_set(), timeout=1)
                            jpg, last = srv.latest, srv.shown
                        if jpg is None:
                            continue
                        self.wfile.write(b"--f\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                         + str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", self.port), H)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        threading.Thread(target=self._player, daemon=True).start()
        return self

    def drain(self, timeout: float = 30.0) -> None:
        end = time.perf_counter() + timeout
        while not self.q.empty() and time.perf_counter() < end:
            time.sleep(0.05)

    def stop(self) -> None:
        self._stop.set()
        with self.cond:
            self.cond.notify_all()
        self.httpd.shutdown()
        self.httpd.server_close()
