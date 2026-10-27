#!/usr/bin/env python3
"""خادم المعرض الحي لتصورات التقارير الرسمية — منفذ 4173 على كل الواجهات.

يحلّ محل `python -m http.server` لثلاثة أسباب:
  ① يرسل `charset=utf-8` صريحاً (العربية في عناوين الصفحة وأسماء الملفات).
  ② ThreadingHTTPServer: طلبات الصور الخمس المتوازية لا تُعلّق بعضها.
  ③ Cache-Control: no-store: أي إعادة توليد للصور تظهر فوراً في المعاينة.
"""
import functools
import http.server
import socketserver
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PORT = 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def guess_type(self, path):
        if path.endswith(".html"):
            return "text/html; charset=utf-8"
        if path.endswith(".mjs") or path.endswith(".js"):
            return "text/javascript; charset=utf-8"
        if path.endswith(".png"):
            return "image/png"
        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        # لا X-Frame-Options / CSP: المعاينة تُعرض داخل إطار المنصة.
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"[{self.log_date_time_string()}] {fmt % args}", flush=True)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    handler = functools.partial(Handler)
    with Server(("0.0.0.0", PORT), handler) as httpd:
        print(f"✓ معرض تصورات التقارير: http://0.0.0.0:{PORT}/  (الجذر: {ROOT})", flush=True)
        httpd.serve_forever()
