from __future__ import annotations

import sys
from pathlib import Path
import unittest

APP_ROOT = Path(__file__).resolve().parents[2] / "apps" / "tetris-ai"
if str(APP_ROOT) not in sys.path:
    sys.path.insert(0, str(APP_ROOT))

from env.tetris_env import _empty_board, _clear_lines, TetrisEnv


class TestEnvRules(unittest.TestCase):
    def test_line_clear(self) -> None:
        board = _empty_board()
        board[-1] = [1] * 10
        cleared = _clear_lines(board)
        self.assertEqual(cleared, 1)
        self.assertEqual(sum(board[-1]), 0)

    def test_srs_rotate(self) -> None:
        env = TetrisEnv(seed=0)
        rot, x, y, ok = env.srs_rotate(piece="T", rot=0, x=4, y=0, direction=1)
        self.assertTrue(ok)
        self.assertEqual(rot, 1)


if __name__ == "__main__":
    unittest.main()
