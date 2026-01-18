from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "stream-studio"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from fastapi.testclient import TestClient
from server.main import app


class TestTetrisApi(unittest.TestCase):
    def test_checkpoints(self) -> None:
        client = TestClient(app)
        r = client.get("/api/tetris/checkpoints")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(data.get("ok"))

    def test_console_tetris_redirect(self) -> None:
        client = TestClient(app)
        r = client.get("/console/tetris")
        self.assertIn(r.status_code, (200, 307, 308))


if __name__ == "__main__":
    unittest.main()
