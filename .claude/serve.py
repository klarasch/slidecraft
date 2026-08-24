"""Dev server for slidecraft: static files with Cache-Control: no-store, so reloads never serve stale runtime files."""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()
    def log_message(self, *a):  # quiet
        pass

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ThreadingHTTPServer(("127.0.0.1", port), NoCache).serve_forever()
