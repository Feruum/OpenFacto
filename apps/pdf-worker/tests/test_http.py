import io
import json
import os
import sys
import unittest
from http.client import HTTPResponse
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openfacto_pdf.__main__ import Handler  # noqa: E402


class MemoryTransport:
    def __init__(self, request):
        self.request = request
        self.output = bytearray()

    def makefile(self, mode, *args):
        return io.BytesIO(self.request if mode == "rb" else self.output)

    def sendall(self, data):
        self.output.extend(data)


def request(method, path):
    transport = MemoryTransport(f"{method} {path} HTTP/1.0\r\nHost: localhost\r\n\r\n".encode())
    Handler(transport, ("127.0.0.1", 0), None)
    response = HTTPResponse(MemoryTransport(bytes(transport.output)))
    response.begin()
    body = response.read()
    return response, body


class HttpBoundaryTests(unittest.TestCase):
    @patch.dict(os.environ, {"PDF_WORKER_TOKEN": ""})
    def test_health_routes_serialize_real_http_without_claiming_pdf_capabilities(self):
        for path in ("/health/live", "/health/ready"):
            with self.subTest(path=path):
                response, body = request("GET", path)
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(body), {"status": "ok", "capabilities": []})
                self.assertEqual(response.getheader("Content-Length"), str(len(body)))
                self.assertEqual(response.getheader("Cache-Control"), "no-store")
                self.assertEqual(response.getheader("Content-Type"), "application/json")

    def test_unimplemented_jobs_do_not_accept_work(self):
        response, body = request("POST", "/jobs")
        self.assertEqual(response.status, 501)
        self.assertEqual(json.loads(body), {"code": "NOT_IMPLEMENTED"})

    def test_unknown_paths_return_json_not_document_content(self):
        response, body = request("GET", "/private.pdf")
        self.assertEqual(response.status, 404)
        self.assertEqual(json.loads(body), {"code": "NOT_FOUND"})
