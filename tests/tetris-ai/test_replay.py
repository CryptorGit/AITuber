from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "tetris-ai"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from record.replay import encode_board, decode_board


class TestReplay(unittest.TestCase):
    def test_encode_decode(self) -> None:
        board = [[0 for _ in range(10)] for _ in range(20)]
        board[19][0] = 3
        board[18][5] = 7
        payload = encode_board(board)
        out = decode_board(payload, width=10, height=20)
        self.assertEqual(out[19][0], 3)
        self.assertEqual(out[18][5], 7)


if __name__ == "__main__":
    unittest.main()
