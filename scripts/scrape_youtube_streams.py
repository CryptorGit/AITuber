import argparse
import csv
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import re
from typing import Iterable


def _find_yt_dlp_exe(repo_root: Path) -> str:
    venv_exe = repo_root / ".venv" / "Scripts" / "yt-dlp.exe"
    if venv_exe.exists():
        return str(venv_exe)

    venv_exe = repo_root / ".venv" / "bin" / "yt-dlp"
    if venv_exe.exists():
        return str(venv_exe)

    return "yt-dlp"


def _run_yt_dlp(cmd: list[str]) -> str:
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp failed ({proc.returncode})\nSTDERR:\n{proc.stderr.strip()}\n")
    return proc.stdout


def _run_yt_dlp_best_effort(cmd: list[str]) -> tuple[str, str, int]:
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0 and proc.stderr.strip():
        print(proc.stderr.strip(), file=sys.stderr)
    return proc.stdout, proc.stderr, proc.returncode


def _iter_json_lines(text: str) -> Iterable[dict]:
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        yield json.loads(line)


def _iso_utc_from_unix(ts: int | None) -> str | None:
    if ts is None:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    value = value.replace("\t", " ")
    return " ".join(value.split())


@dataclass(frozen=True)
class StreamEntry:
    video_id: str
    url: str


_YT_DLP_ERR_RE = re.compile(r"\[youtube\]\s+(?P<id>[A-Za-z0-9_-]{11}):\s+(?P<msg>.+)")


def _parse_yt_dlp_errors(stderr: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in (stderr or "").splitlines():
        m = _YT_DLP_ERR_RE.search(line)
        if not m:
            continue
        out[m.group("id")] = _sanitize_text(m.group("msg")) or ""
    return out


def _extract_stream_ids(yt_dlp_exe: str, channel_streams_url: str) -> list[StreamEntry]:
    cmd = [
        yt_dlp_exe,
        "--flat-playlist",
        "--dump-json",
        "--no-warnings",
        "--ignore-errors",
        channel_streams_url,
    ]
    stdout = _run_yt_dlp(cmd)

    entries: list[StreamEntry] = []
    for obj in _iter_json_lines(stdout):
        video_id = obj.get("id")
        if not video_id:
            continue
        url = obj.get("url") or f"https://www.youtube.com/watch?v={video_id}"
        if url.startswith("https://") or url.startswith("http://"):
            entries.append(StreamEntry(video_id=video_id, url=url))
        else:
            entries.append(StreamEntry(video_id=video_id, url=f"https://www.youtube.com/watch?v={video_id}"))

    dedup: dict[str, StreamEntry] = {}
    for e in entries:
        dedup.setdefault(e.video_id, e)
    return list(dedup.values())


def _read_existing_ids(jsonl_path: Path) -> set[str]:
    if not jsonl_path.exists():
        return set()

    ids: set[str] = set()
    with jsonl_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            video_id = obj.get("video_id") or obj.get("id")
            if video_id:
                ids.add(str(video_id))
    return ids


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _chunks_entries(items: list[StreamEntry], size: int) -> Iterable[list[StreamEntry]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _append_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False))
            f.write("\n")


def _write_csv(csv_path: Path, jsonl_path: Path) -> None:
    rows: list[dict] = []
    if jsonl_path.exists():
        with jsonl_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    fieldnames = [
        "video_id",
        "url",
        "upload_date",
        "timestamp",
        "uploaded_at_utc",
        "title",
        "uploader",
        "uploader_id",
        "was_live",
        "live_status",
        "duration",
    ]

    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in rows:
            writer.writerow({k: r.get(k) for k in fieldnames})


def _fetch_video_metadata(
    yt_dlp_exe: str,
    video_urls: list[str],
    sleep_interval: float,
    max_sleep_interval: float,
    cookies_from_browser: str | None,
    cookies_file: str | None,
) -> tuple[list[dict], dict[str, str]]:
    with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", newline="\n") as tf:
        batch_path = Path(tf.name)
        for url in video_urls:
            tf.write(url)
            tf.write("\n")

    try:
        cmd = [
            yt_dlp_exe,
            "--dump-json",
            "--no-warnings",
            "--ignore-errors",
            "--no-playlist",
            "--skip-download",
            "--sleep-interval",
            str(sleep_interval),
            "--max-sleep-interval",
            str(max_sleep_interval),
            "--batch-file",
            str(batch_path),
        ]
        if cookies_from_browser:
            cmd.extend(["--cookies-from-browser", cookies_from_browser])
        if cookies_file:
            cmd.extend(["--cookies", cookies_file])

        stdout, stderr, _code = _run_yt_dlp_best_effort(cmd)
        return [obj for obj in _iter_json_lines(stdout)], _parse_yt_dlp_errors(stderr)
    finally:
        try:
            batch_path.unlink(missing_ok=True)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch all past live streams URLs from a YouTube channel /streams tab and write URL + date metadata."
    )
    parser.add_argument(
        "channel_streams_url",
        help="e.g. https://www.youtube.com/@usadapekora/streams",
    )
    parser.add_argument(
        "--out-jsonl",
        default="data/finetune/youtube/meta/streams.jsonl",
        help="Output JSONL path (default: data/finetune/youtube/meta/streams.jsonl)",
    )
    parser.add_argument(
        "--out-csv",
        default="data/finetune/youtube/meta/streams.csv",
        help="Output CSV path (default: data/finetune/youtube/meta/streams.csv)",
    )
    parser.add_argument(
        "--out-failed-jsonl",
        default=None,
        help="Optional JSONL path to record entries that could not be fetched (age-restricted/members-only/upcoming).",
    )
    parser.add_argument("--chunk-size", type=int, default=50)
    parser.add_argument("--sleep-interval", type=float, default=0.5)
    parser.add_argument("--max-sleep-interval", type=float, default=1.5)
    parser.add_argument(
        "--cookies-from-browser",
        default=None,
        help="Optional. e.g. chrome, edge, firefox (see yt-dlp docs). Enables age-restricted videos if logged in.",
    )
    parser.add_argument(
        "--cookies",
        default=None,
        help="Optional cookies file (Netscape format). Alternative to --cookies-from-browser.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    yt_dlp_exe = _find_yt_dlp_exe(repo_root)

    out_jsonl = repo_root / args.out_jsonl
    out_csv = repo_root / args.out_csv
    out_failed_jsonl = (repo_root / args.out_failed_jsonl) if args.out_failed_jsonl else None

    existing_failed_ids: set[str] = set()
    if out_failed_jsonl is not None:
        existing_failed_ids = _read_existing_ids(out_failed_jsonl)

    all_entries = _extract_stream_ids(yt_dlp_exe, args.channel_streams_url)
    existing_ids = _read_existing_ids(out_jsonl)

    remaining_entries = [e for e in all_entries if e.video_id not in existing_ids]
    if not remaining_entries:
        _write_csv(out_csv, out_jsonl)
        print(f"No new entries. CSV refreshed: {out_csv}")
        return 0

    total = len(remaining_entries)
    done = 0

    for entry_chunk in _chunks_entries(remaining_entries, args.chunk_size):
        url_chunk = [e.url for e in entry_chunk]
        expected_ids = {e.video_id: e.url for e in entry_chunk}

        objs, err_map = _fetch_video_metadata(
            yt_dlp_exe,
            url_chunk,
            sleep_interval=args.sleep_interval,
            max_sleep_interval=args.max_sleep_interval,
            cookies_from_browser=args.cookies_from_browser,
            cookies_file=args.cookies,
        )

        rows: list[dict] = []
        returned_ids: set[str] = set()
        for obj in objs:
            video_id = obj.get("id")
            if not video_id:
                continue
            if str(video_id) in existing_ids:
                continue
            returned_ids.add(str(video_id))

            timestamp = obj.get("timestamp") or obj.get("release_timestamp")
            upload_date = obj.get("upload_date") or obj.get("release_date")

            rows.append(
                {
                    "video_id": video_id,
                    "url": obj.get("webpage_url") or obj.get("original_url") or f"https://www.youtube.com/watch?v={video_id}",
                    "title": _sanitize_text(obj.get("title")),
                    "uploader": _sanitize_text(obj.get("uploader")),
                    "uploader_id": _sanitize_text(obj.get("uploader_id")),
                    "was_live": obj.get("was_live"),
                    "live_status": obj.get("live_status"),
                    "duration": obj.get("duration"),
                    "upload_date": upload_date,
                    "timestamp": timestamp,
                    "uploaded_at_utc": _iso_utc_from_unix(timestamp),
                }
            )
            existing_ids.add(str(video_id))

        if rows:
            _append_jsonl(out_jsonl, rows)

        if out_failed_jsonl is not None:
            missing = [vid for vid in expected_ids.keys() if vid not in returned_ids and vid not in existing_ids]
            if missing:
                failed_rows: list[dict] = []
                for vid in missing:
                    if vid in existing_failed_ids:
                        continue
                    failed_rows.append(
                        {
                            "video_id": vid,
                            "url": expected_ids.get(vid) or f"https://www.youtube.com/watch?v={vid}",
                            "reason": err_map.get(vid) or None,
                            "source": args.channel_streams_url,
                        }
                    )
                    existing_failed_ids.add(vid)
                _append_jsonl(out_failed_jsonl, failed_rows)

        done += len(url_chunk)
        print(f"Processed {min(done, total)}/{total} items...")

    _write_csv(out_csv, out_jsonl)
    print(f"Done. JSONL: {out_jsonl}")
    print(f"Done. CSV:  {out_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
