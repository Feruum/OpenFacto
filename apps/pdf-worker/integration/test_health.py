import json
import os
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from openfacto_pdf.__main__ import Handler


class HealthIntegrationTests(unittest.TestCase):
    @patch.dict(os.environ, {"PDF_WORKER_TOKEN": ""})
    def test_real_http_lifecycle_and_unimplemented_job_boundary(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=2)
        try:
            for path in ("/health/live", "/health/ready"):
                connection.request("GET", path)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read()), {"status": "ok", "capabilities": []})
            connection.request("POST", "/jobs")
            response = connection.getresponse()
            self.assertEqual(response.status, 501)
            response.read()
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
