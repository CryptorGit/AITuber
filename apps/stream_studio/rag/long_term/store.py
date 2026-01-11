from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple


@dataclass
class LongTermStore:
    db_path: Path

    def _connect(self) -> sqlite3.Connection:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        return conn

    def init(self) -> None:
        with self._connect() as conn:
            # FTS5 is preferred; if unavailable, fall back to a simple table.
            try:
                conn.execute(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS docs USING fts5(doc_id, text, source, created_at);"
                )
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS docs_meta(doc_id TEXT PRIMARY KEY, metadata_json TEXT);"
                )
            except sqlite3.OperationalError:
                conn.execute(
                    "CREATE TABLE IF NOT EXISTS docs_simple(doc_id TEXT PRIMARY KEY, text TEXT, source TEXT, created_at TEXT);"
                )
            conn.commit()

    def _has_table(self, conn: sqlite3.Connection, name: str) -> bool:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1",
            (name,),
        ).fetchone()
        return row is not None

    def upsert(self, *, doc_id: str, text: str, source: str, created_at: str) -> None:
        self.init()
        with self._connect() as conn:
            try:
                # FTS tables do not enforce uniqueness. Ensure a single row per doc_id.
                conn.execute("DELETE FROM docs WHERE doc_id = ?", (doc_id,))
                conn.execute(
                    "INSERT INTO docs(doc_id, text, source, created_at) VALUES(?,?,?,?)",
                    (doc_id, text, source, created_at),
                )
            except sqlite3.OperationalError:
                conn.execute(
                    "INSERT OR REPLACE INTO docs_simple(doc_id, text, source, created_at) VALUES(?,?,?,?)",
                    (doc_id, text, source, created_at),
                )
            conn.commit()

    def search(self, *, query: str, limit: int = 5) -> List[Tuple[str, str]]:
        self.init()
        q = (query or "").strip()
        if not q:
            return []

        with self._connect() as conn:
            # Prefer FTS table if present.
            if self._has_table(conn, "docs"):
                try:
                    rows = conn.execute(
                        "SELECT doc_id, text FROM docs WHERE docs MATCH ? LIMIT ?",
                        (q, limit),
                    ).fetchall()
                    return [(str(r["doc_id"]), str(r["text"])[:240]) for r in rows]
                except sqlite3.OperationalError:
                    # If MATCH isn't available for some reason, fall through.
                    pass

            # Fallback: simple LIKE table (created only when FTS5 isn't available)
            if self._has_table(conn, "docs_simple"):
                rows = conn.execute(
                    "SELECT doc_id, text FROM docs_simple WHERE text LIKE ? LIMIT ?",
                    (f"%{q}%", limit),
                ).fetchall()
                return [(str(r["doc_id"]), str(r["text"])[:240]) for r in rows]

            return []

    def get(self, *, doc_id: str) -> Optional[Dict[str, str]]:
        self.init()
        did = (doc_id or "").strip()
        if not did:
            return None
        with self._connect() as conn:
            if self._has_table(conn, "docs"):
                try:
                    row = conn.execute(
                        "SELECT doc_id, text, source, created_at FROM docs WHERE doc_id = ? LIMIT 1",
                        (did,),
                    ).fetchone()
                    if row:
                        return {
                            "doc_id": str(row["doc_id"]),
                            "text": str(row["text"] or ""),
                            "source": str(row["source"] or ""),
                            "created_at": str(row["created_at"] or ""),
                        }
                except sqlite3.OperationalError:
                    pass
            if self._has_table(conn, "docs_simple"):
                row = conn.execute(
                    "SELECT doc_id, text, source, created_at FROM docs_simple WHERE doc_id = ? LIMIT 1",
                    (did,),
                ).fetchone()
                if row:
                    return {
                        "doc_id": str(row["doc_id"]),
                        "text": str(row["text"] or ""),
                        "source": str(row["source"] or ""),
                        "created_at": str(row["created_at"] or ""),
                    }
        return None

    def list(self, *, limit: int = 100) -> List[Dict[str, str]]:
        self.init()
        try:
            lim = max(1, int(limit))
        except Exception:
            lim = 100
        out: List[Dict[str, str]] = []
        with self._connect() as conn:
            if self._has_table(conn, "docs"):
                try:
                    rows = conn.execute(
                        "SELECT doc_id, text, source, created_at FROM docs ORDER BY created_at DESC LIMIT ?",
                        (lim,),
                    ).fetchall()
                    for row in rows:
                        raw = str(row["text"] or "")
                        out.append(
                            {
                                "doc_id": str(row["doc_id"]),
                                "text": raw[:240],
                                "source": str(row["source"] or ""),
                                "created_at": str(row["created_at"] or ""),
                                "text_len": len(raw),
                            }
                        )
                    return out
                except sqlite3.OperationalError:
                    pass
            if self._has_table(conn, "docs_simple"):
                rows = conn.execute(
                    "SELECT doc_id, text, source, created_at FROM docs_simple ORDER BY created_at DESC LIMIT ?",
                    (lim,),
                ).fetchall()
                for row in rows:
                    raw = str(row["text"] or "")
                    out.append(
                        {
                            "doc_id": str(row["doc_id"]),
                            "text": raw[:240],
                            "source": str(row["source"] or ""),
                            "created_at": str(row["created_at"] or ""),
                            "text_len": len(raw),
                        }
                    )
        return out

    def delete(self, *, doc_id: str) -> bool:
        self.init()
        did = (doc_id or "").strip()
        if not did:
            return False
        with self._connect() as conn:
            before = conn.total_changes
            if self._has_table(conn, "docs"):
                try:
                    conn.execute("DELETE FROM docs WHERE doc_id = ?", (did,))
                except sqlite3.OperationalError:
                    pass
            if self._has_table(conn, "docs_simple"):
                conn.execute("DELETE FROM docs_simple WHERE doc_id = ?", (did,))
            conn.commit()
            return conn.total_changes > before
