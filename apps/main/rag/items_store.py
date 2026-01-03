from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class RagItemsStore:
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
                CREATE TABLE IF NOT EXISTS rag_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  rag_type TEXT NOT NULL,
                  title TEXT,
                  text TEXT NOT NULL,
                  created_at TEXT NOT NULL
                )
                """
            )
            con.execute("CREATE INDEX IF NOT EXISTS idx_rag_items_type_created ON rag_items(rag_type, created_at)")
            con.commit()

    @staticmethod
    def _normalize_type(t: str) -> str:
        tt = (t or "").strip().lower()
        return "short" if tt == "short" else "long" if tt == "long" else ""

    def add(self, *, rag_type: str, title: str, text: str, created_at: str) -> int:
        rt = self._normalize_type(rag_type)
        if not rt:
            raise ValueError("invalid_rag_type")
        body = (text or "").strip()
        if not body:
            raise ValueError("missing_text")

        self.init()
        with self._connect() as con:
            cur = con.execute(
                "INSERT INTO rag_items(rag_type, title, text, created_at) VALUES(?,?,?,?)",
                (rt, (title or "").strip(), body, created_at),
            )
            con.commit()
            return int(cur.lastrowid)

    def delete(self, *, row_id: int) -> bool:
        self.init()
        with self._connect() as con:
            cur = con.execute("DELETE FROM rag_items WHERE id = ?", (int(row_id),))
            con.commit()
            return int(cur.rowcount or 0) > 0

    def list(self, *, rag_type: str, limit: int = 200) -> List[Dict[str, Any]]:
        rt = self._normalize_type(rag_type)
        if not rt:
            raise ValueError("invalid_rag_type")
        lim = max(1, min(1000, int(limit)))

        self.init()
        with self._connect() as con:
            rows = con.execute(
                "SELECT id, rag_type, title, text, created_at FROM rag_items WHERE rag_type = ? ORDER BY id DESC LIMIT ?",
                (rt, lim),
            ).fetchall()
            out: List[Dict[str, Any]] = []
            for r in rows:
                out.append(
                    {
                        "id": int(r["id"]),
                        "rag_type": str(r["rag_type"]),
                        "title": str(r["title"] or ""),
                        "text": str(r["text"] or ""),
                        "created_at": str(r["created_at"] or ""),
                    }
                )
            return out

    def get_concat_text(self, *, rag_type: str, limit: int = 50) -> str:
        items = self.list(rag_type=rag_type, limit=limit)
        # Reverse so oldest->newest for readability.
        items = list(reversed(items))
        chunks: List[str] = []
        for it in items:
            title = (it.get("title") or "").strip()
            text = (it.get("text") or "").strip()
            if not text:
                continue
            if title:
                chunks.append(f"- {title}\n{text}")
            else:
                chunks.append(text)
        return "\n\n".join(chunks).strip()
