import json
import os
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import patch

import pymupdf

from openfacto_pdf.__main__ import Handler
from openfacto_pdf.parse import MAX_BYTES


class ExtractionBoundary(unittest.TestCase):
    def setUp(self):
        self.token = "fixture-parser-token-for-loopback-only"
        self.environment = patch.dict(os.environ, {"PDF_WORKER_TOKEN": self.token})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def send(self, data, **override):
        client = HTTPConnection("127.0.0.1", self.server.server_port, timeout=30)
        self.addCleanup(client.close)
        headers = {"Content-Type": "application/pdf", "Authorization": "Bearer " + self.token}
        headers.update(override)
        client.request("POST", "/v1/extract", data, headers=headers)
        result = client.getresponse()
        return result.status, result.read()

    def test_extracts_real_pages_in_isolated_process(self):
        with pymupdf.open() as doc:
            doc.new_page().insert_text((50, 50), "Schedule")
            doc.new_page().insert_text((50, 50), "Registration opens at 9 am.")
            status, data = self.send(doc.tobytes())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data), {"pageCount": 2, "pages": [
            {"page": 1, "text": "Schedule"},
            {"page": 2, "text": "Registration opens at 9 am."}
        ]})

    def test_reports_mixed_or_all_scanned_pages_without_partial_text(self):
        for mixed in (True, False):
            with self.subTest(mixed=mixed), pymupdf.open() as doc:
                if mixed:
                    doc.new_page().insert_text((50, 50), "Confidential document contents")
                scan = doc.new_page()
                bitmap = pymupdf.Pixmap(pymupdf.csGRAY, (0, 0, 2, 2), False)
                bitmap.clear_with(128)
                scan.insert_image(scan.rect, pixmap=bitmap, keep_proportion=False)
                if mixed:
                    scan.insert_text((20, 20), "2")
                    doc.new_page()
                status, data = self.send(doc.tobytes())
                self.assertEqual(status, 422)
                expected = ([{"page": 2, "status": "needs_ocr"},
                             {"page": 3, "status": "needs_text"}] if mixed
                            else [{"page": 1, "status": "needs_ocr"}])
                self.assertEqual(json.loads(data), {"code": "PDF_PAGES_NEED_TEXT",
                                 "pageCount": len(doc), "pageDiagnostics": expected})

    def test_auth_size_and_content_type_checked_before_parsing(self):
        self.assertEqual(self.send(b"", Authorization="Bearer incorrect")[0], 401)
        self.assertEqual(self.send(b"x", **{"Content-Length": str(MAX_BYTES + 1)})[0], 413)
        self.assertEqual(self.send(b"https://invalid/private", **{"Content-Type": "text/plain"})[0],
                         415)
        self.assertEqual(self.send(b"%PDF-broken secret")[0], 422)
        self.assertEqual(self.send(b"file:///private.pdf")[0], 422)

    def test_encrypted_pdf_rejected_without_echoing_contents(self):
        with pymupdf.open() as doc:
            doc.new_page().insert_text((50, 50), "secret")
            data = doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="owner",
                               user_pw="reader")
            status, message = self.send(data)
        self.assertEqual(status, 422)
        self.assertNotIn(b"secret", message)
