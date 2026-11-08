import argparse
import hmac
import json
import os
import signal
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .parse import MAX_BYTES

SLOTS = threading.BoundedSemaphore(2)


def capabilities():
    return ["pdf-text"] if len(os.environ.get("PDF_WORKER_TOKEN", "")) >= 32 else []


class BoundedServer(ThreadingHTTPServer):
    # Limit threads even for clients that never finish sending headers.
    connections = threading.BoundedSemaphore(8)

    def process_request(self, request, client_address):
        if not self.connections.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            request.settimeout(10)
            super().process_request(request, client_address)
        except BaseException:
            self.connections.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connections.release()


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
            self.respond(200, {"status": "ok", "capabilities": capabilities()})
        else:
            self.respond(404, {"code": "NOT_FOUND"})

    def do_POST(self):
        if self.path == "/jobs":
            return self.respond(501, {"code": "NOT_IMPLEMENTED"})
        if self.path != "/v1/extract":
            return self.respond(404, {"code": "NOT_FOUND"})
        token = os.environ.get("PDF_WORKER_TOKEN", "")
        if len(token) < 32:
            return self.respond(503, {"code": "PARSER_DISABLED"})
        if not hmac.compare_digest(
            self.headers.get("Authorization", "").encode(), ("Bearer " + token).encode()
        ):
            return self.respond(401, {"code": "UNAUTHORIZED"})
        if self.headers.get_content_type() != "application/pdf":
            return self.respond(415, {"code": "PDF_REQUIRED"})
        lengths = self.headers.get_all("Content-Length", [])
        if (self.headers.get("Transfer-Encoding") or len(lengths) != 1
                or len(lengths[0]) > 10 or not lengths[0].isascii() or not lengths[0].isdigit()):
            return self.respond(400, {"code": "INVALID_LENGTH"})
        length = int(lengths[0])
        if not 1 <= length <= MAX_BYTES:
            return self.respond(413, {"code": "SIZE_LIMIT"})
        if not SLOTS.acquire(blocking=False):
            return self.respond(429, {"code": "BUSY"})
        try:
            self.connection.settimeout(10)
            data = self.rfile.read(length)
            if len(data) != length or not data.startswith(b"%PDF-"):
                return self.respond(422, {"code": "INVALID_PDF"})
            result = subprocess.run(
                [sys.executable, "-I", str(Path(__file__).with_name("parse.py").resolve())],
                input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                env={k: os.environ[k] for k in ("SystemRoot", "WINDIR") if k in os.environ},
                timeout=20, check=False,
            )
            if result.returncode == 2:
                return self.respond(422, {"code": "INVALID_OR_UNREADABLE_PDF"})
            if result.returncode != 0:
                return self.respond(503, {"code": "PARSER_UNAVAILABLE"})
            parsed = json.loads(result.stdout)
            return self.respond(422 if "pageDiagnostics" in parsed else 200, parsed)
        except (subprocess.TimeoutExpired, TimeoutError):
            return self.respond(408, {"code": "TIME_LIMIT"})
        finally:
            SLOTS.release()

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
        print(json.dumps({"service": "pdf-worker", "status": "ok", "capabilities": capabilities()}))
        return
    server = BoundedServer((host, port), Handler)
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: threading.Thread(target=server.shutdown).start())
    print(json.dumps({"service": "pdf-worker", "event": "ready", "port": port}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
