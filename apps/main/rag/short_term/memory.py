from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from apps.main.core.storage import tail_jsonl, utc_iso


@dataclass
class ShortTermMemory:
    events_path: Path
    db_path: Optional[Path] = None

    def _resolve_db_path(self) -> Path:
        if self.db_path is not None:
            return self.db_path
        return self.events_path.parent / "rag" / "short_term.sqlite"

    def _connect(self) -> sqlite3.Connection:
        path = self._resolve_db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path))
        conn.row_factory = sqlite3.Row
        return conn

    def init(self) -> None:
        with self._connect() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS short_turns("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "role TEXT, "
                "text TEXT, "
                "ts TEXT"
                ");"
            )
            conn.commit()

    def append(self, *, role: str, text: str, ts: Optional[str] = None) -> Optional[int]:
        t = str(text or "").strip()
        if not t:
            return None
        r = str(role or "").strip() or "user"
        stamp = ts or utc_iso()
        try:
            self.init()
            with self._connect() as conn:
                cur = conn.execute(
                    "INSERT INTO short_turns(role, text, ts) VALUES(?,?,?)",
                    (r, t, stamp),
                )
                conn.commit()
                return int(cur.lastrowid)
        except Exception:
            return None

    def list(self, *, limit: int = 50, newest_first: bool = True) -> List[Dict[str, Any]]:
        try:
            lim = max(0, int(limit))
        except Exception:
            lim = 50
        if lim <= 0:
            return []
        try:
            self.init()
            order = "DESC" if newest_first else "ASC"
            with self._connect() as conn:
                rows = conn.execute(
                    f"SELECT id, role, text, ts FROM short_turns ORDER BY id {order} LIMIT ?",
                    (lim,),
                ).fetchall()
            out: List[Dict[str, Any]] = []
            for row in rows:
                out.append(
                    {
                        "id": int(row["id"]),
                        "role": str(row["role"] or ""),
                        "text": str(row["text"] or ""),
                        "ts": str(row["ts"] or ""),
                    }
                )
            return out
        except Exception:
            return []

    def delete(self, *, row_id: int) -> bool:
        try:
            rid = int(row_id)
        except Exception:
            return False
        if rid <= 0:
            return False
        try:
            self.init()
            with self._connect() as conn:
                cur = conn.execute("DELETE FROM short_turns WHERE id = ?", (rid,))
                conn.commit()
                return cur.rowcount > 0
        except Exception:
            return False

    def recent_text(self, *, max_events: int = 50) -> str:
        try:
            rows = self.list(limit=max_events, newest_first=True)
            if not rows:
                return self._fallback_recent_text(max_events=max_events)
            rows = list(reversed(rows))
            lines = [f"[{r.get('role')}] {r.get('text')}" for r in rows if r.get("text")]
            return "\n".join(lines[-max_events:])
        except Exception:
            return self._fallback_recent_text(max_events=max_events)

    def _fallback_recent_text(self, *, max_events: int = 50) -> str:
        events = tail_jsonl(self.events_path, max_events)
        lines: list[str] = []
        for e in events:
            src = str(e.get("source", ""))
            typ = str(e.get("type", ""))
            msg = str(e.get("message", ""))
            if typ == "input" and msg:
                lines.append(f"[{src}] {msg}")
            elif src in ("manager", "llm", "vlm") and msg:
                lines.append(f"[{src}] {msg}")
        return "\n".join(lines[-max_events:])
