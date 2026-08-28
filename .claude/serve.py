"""Dev server for slaydy: static files with Cache-Control: no-store, so reloads never serve stale runtime files."""
import os, sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, *a):  # quiet
        pass

# args: a number is the port, anything else the directory to serve.
# An explicit port wins over the harness-assigned PORT (autoPort) and the default.
port, root = int(os.environ.get("PORT", 8765)), None
for a in sys.argv[1:]:
    if a.isdigit():
        port = int(a)
    else:
        root = a
handler = partial(NoCache, directory=root) if root else NoCache
ThreadingHTTPServer(("127.0.0.1", port), handler).serve_forever()
