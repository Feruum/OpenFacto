import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openfacto_pdf.__main__ import configuration  # noqa: E402


class WorkerTests(unittest.TestCase):
    def test_configuration_is_bounded(self):
        self.assertEqual(configuration({}), ("127.0.0.1", 8001))
        for value in ("0", "65536", "bad", ""):
            with self.assertRaisesRegex(ValueError, "PDF_WORKER"):
                configuration({"PDF_WORKER_PORT": value})

    def test_startup_check_reports_only_lifecycle_capabilities(self):
        result = subprocess.run(
            [sys.executable, "-m", "openfacto_pdf", "--check"],
            cwd=Path(__file__).resolve().parents[1],
            capture_output=True,
            text=True,
            check=True,
        )
        self.assertEqual(json.loads(result.stdout)["capabilities"], [])

    def test_invalid_configuration_exits_without_secret_values(self):
        result = subprocess.run(
            [sys.executable, "-m", "openfacto_pdf", "--check"],
            cwd=Path(__file__).resolve().parents[1],
            env={**os.environ, "PDF_WORKER_PORT": "SECRET"},
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("SECRET", result.stderr)


if __name__ == "__main__":
    unittest.main()
