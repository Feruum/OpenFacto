import argparse
import json
import os
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def configuration(environ):
    host = environ.get("PDF_WORKER_HOST", "127.0.0.1")
    try:
        port = int(environ.get("PDF_WORKER_PORT", "8001"))
        if not 1 <= port <= 65535 or not host.strip():
            raise ValueError
    except ValueError:
        raise ValueError("Invalid PDF_WORKER_HOST or PDF_WORKER_PORT; see .env.example") from None
    return host, port


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/health/live", "/health/ready"):
            self.respond(200, {"status": "ok", "capabilities": []})
        else:
            self.respond(404, {"code": "NOT_FOUND"})

    def do_POST(self):
        self.respond(501, {"code": "NOT_IMPLEMENTED"})

    def respond(self, status, body):
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Never log URLs, payloads or document text.
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Validate configuration and exit")
    args = parser.parse_args()
    try:
        host, port = configuration(os.environ)
    except ValueError as error:
        parser.exit(1, f"{error}\n")
    if args.check:
        print(json.dumps({"service": "pdf-worker", "status": "ok", "capabilities": []}))
        return
    server = ThreadingHTTPServer((host, port), Handler)
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: threading.Thread(target=server.shutdown).start())
    print(json.dumps({"service": "pdf-worker", "event": "ready", "port": port}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
