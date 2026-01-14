from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class TurnsStore:
    db_path: Path

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(str(self.db_path))
        con.row_factory = sqlite3.Row
        return con

    def init(self) -> None:
        with self._connect() as con:
            con.execute(
                """
                CREATE TABLE IF NOT EXISTS turns (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  user_text TEXT NOT NULL,
                  assistant_text TEXT NOT NULL,
                  created_at TEXT NOT NULL
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_turns_created ON turns(created_at)")
            con.commit()

    def add_turn(self, *, user_text: str, assistant_text: str, created_at: str, max_keep: int) -> int:
        u = (user_text or "").strip()
        a = (assistant_text or "").strip()
        if not u or not a:
            raise ValueError("missing_text")

        self.init()
        with self._connect() as con:
            cur = con.execute(
                "INSERT INTO turns(user_text, assistant_text, created_at) VALUES(?,?,?)",
                (u, a, created_at),
            )
            con.commit()

            # Best-effort retention
            try:
                keep = max(1, min(5000, int(max_keep)))
                con.execute(
                    "DELETE FROM turns WHERE id NOT IN (SELECT id FROM turns ORDER BY id DESC LIMIT ?)",
                    (keep,),
                )
                con.commit()
            except Exception:
                pass

            return int(cur.lastrowid)

    def list(self, *, limit: int = 200) -> List[Dict[str, Any]]:
        lim = max(1, min(2000, int(limit)))
        self.init()
        with self._connect() as con:
            rows = con.execute(
                "SELECT id, user_text, assistant_text, created_at FROM turns ORDER BY id DESC LIMIT ?",
                (lim,),
            ).fetchall()
            out: List[Dict[str, Any]] = []
            for r in rows:
                out.append(
                    {
                        "id": int(r["id"]),
                        "user_text": str(r["user_text"] or ""),
                        "assistant_text": str(r["assistant_text"] or ""),
                        "created_at": str(r["created_at"] or ""),
                    }
                )
            return out

    def delete(self, *, row_id: int) -> bool:
        self.init()
        with self._connect() as con:
            cur = con.execute("DELETE FROM turns WHERE id = ?", (int(row_id),))
            con.commit()
            return int(cur.rowcount or 0) > 0

    def clear(self) -> None:
        self.init()
        with self._connect() as con:
            con.execute("DELETE FROM turns")
            con.commit()

    def get_prompt_context(self, *, turns_to_prompt: int) -> str:
        n = max(0, min(100, int(turns_to_prompt)))
        if n <= 0:
            return ""
        items = self.list(limit=n)
        items = list(reversed(items))
        parts: List[str] = []
        for it in items:
            u = (it.get("user_text") or "").strip()
            a = (it.get("assistant_text") or "").strip()
            if u:
                parts.append(f"User: {u}")
            if a:
                parts.append(f"Assistant: {a}")
        return "\n".join(parts).strip()
