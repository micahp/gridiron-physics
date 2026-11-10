"""Dev server for the viewer: serves a folder and never lets the browser keep a copy.

    python scripts/dev-server.py [port] [root]      (defaults: 8141, the repo root)

`Cache-Control: no-cache` only makes a browser re-check a file; with `Last-Modified` or `ETag` present it still
keeps a copy and can reuse it, which is how an old model or script survived a rebuild. This sends `no-store` and
drops the validators, so every load fetches fresh files. ES modules, the GLB and the data files included.
"""
import functools
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class Server(ThreadingHTTPServer):
    request_queue_size = 256   # the default (5) drops connections when a page fires ~100 requests at once
    daemon_threads = True


class NoCacheHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        # never answer "304 not modified": ignore any validator the client sends, so it always gets the file
        for name in ('If-Modified-Since', 'If-None-Match'):
            if name in self.headers:
                del self.headers[name]
        return super().send_head()

    def send_header(self, keyword, value):
        if keyword.lower() in ('last-modified', 'etag'):   # nothing for a browser to revalidate against or reuse
            return
        super().send_header(keyword, value)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8141
    root = sys.argv[2] if len(sys.argv) > 2 else str(Path(__file__).resolve().parent.parent)
    print(f'serving {root} on http://127.0.0.1:{port} (no caching)', flush=True)
    Server(('127.0.0.1', port), functools.partial(NoCacheHandler, directory=root)).serve_forever()


if __name__ == '__main__':
    main()
