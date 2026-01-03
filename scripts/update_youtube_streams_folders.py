from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _iter_jsonl_first_obj(path: Path) -> dict | None:
    try:
        with path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                return json.loads(line)
    except OSError:
        return None
    except json.JSONDecodeError:
        return None
    return None


def _url_from_uploader_id(uploader_id: str) -> str:
    # uploader_id is typically like "@TokinoSora"
    if uploader_id.startswith("@"):
        return f"https://www.youtube.com/{uploader_id}/streams"
    return f"https://www.youtube.com/@{uploader_id}/streams"


def _handle_from_url(url: str) -> str | None:
    url = url.strip()
    if not url:
        return None
    # https://www.youtube.com/@Handle/streams
    at = url.find("@")
    if at == -1:
        return None
    after = url[at + 1 :]
    handle = after.split("/")[0]
    handle = "".join(ch for ch in handle if ch.isalnum() or ch in "_-")
    return handle or None


def _read_channels_txt(path: Path) -> list[str]:
    urls: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        urls.append(line)
    return urls


def _write_channels_txt(path: Path, urls: list[str]) -> None:
    path.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")


def _folders_under(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted([p for p in root.iterdir() if p.is_dir()])


def generate_channels(root: Path, overwrite: bool) -> int:
    folders = _folders_under(root)
    if not folders:
        print(f"No folders under: {root}")
        return 0

    total_written = 0
    for folder in folders:
        out = folder / "channels.txt"
        if out.exists() and not overwrite:
            print(f"Skip existing: {out}")
            continue

        urls: list[str] = []
        for jsonl in sorted(folder.glob("*_streams.jsonl")):
            first = _iter_jsonl_first_obj(jsonl)
            uploader_id = None
            if isinstance(first, dict):
                uploader_id = first.get("uploader_id")

            if isinstance(uploader_id, str) and uploader_id:
                urls.append(_url_from_uploader_id(uploader_id))
            else:
                handle_guess = jsonl.name.replace("_streams.jsonl", "")
                urls.append(f"https://www.youtube.com/@{handle_guess}/streams")

        urls = sorted(dict.fromkeys(urls))
        _write_channels_txt(out, urls)
        total_written += 1
        print(f"Wrote {out} ({len(urls)} URLs)")

    print(f"Done. channels.txt written: {total_written}")
    return 0


def update_folder(
    folder: Path,
    chunk_size: int,
    sleep_interval: float,
    max_sleep_interval: float,
    max_channels: int | None = None,
) -> int:
    channels_txt = folder / "channels.txt"
    if not channels_txt.exists():
        return 0

    urls = _read_channels_txt(channels_txt)
    if not urls:
        return 0

    if max_channels is not None:
        urls = urls[: max_channels]

    for url in urls:
        handle = _handle_from_url(url)
        if not handle:
            print(f"Skip (cannot parse handle): {url}")
            continue
        name = handle.lower()
        out_jsonl = folder / f"{name}_streams.jsonl"
        out_csv = folder / f"{name}_streams.csv"

        cmd = [
            sys.executable,
            str(_repo_root() / "scripts" / "scrape_youtube_streams.py"),
            url,
            "--out-jsonl",
            str(out_jsonl.relative_to(_repo_root())),
            "--out-csv",
            str(out_csv.relative_to(_repo_root())),
            "--chunk-size",
            str(chunk_size),
            "--sleep-interval",
            str(sleep_interval),
            "--max-sleep-interval",
            str(max_sleep_interval),
        ]

        print(f"=== {folder.name}/{name} ===")
        subprocess.run(cmd, check=False)

    return 0


def update_all(
    root: Path,
    chunk_size: int,
    sleep_interval: float,
    max_sleep_interval: float,
    folder_name: str | None = None,
    max_channels: int | None = None,
) -> int:
    folders = _folders_under(root)
    if not folders:
        print(f"No folders under: {root}")
        return 0

    if folder_name:
        folders = [f for f in folders if f.name == folder_name]
        if not folders:
            print(f"No matching folder under {root}: {folder_name}")
            return 0

    for folder in folders:
        update_folder(
            folder,
            chunk_size=chunk_size,
            sleep_interval=sleep_interval,
            max_sleep_interval=max_sleep_interval,
            max_channels=max_channels,
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate channels.txt per folder and update streams for all channels in each folder")
    parser.add_argument(
        "--root",
        default="data/finetune/youtube/meta/streams",
        help="Root folder containing subfolders (default: data/finetune/youtube/meta/streams)",
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    p_gen = sub.add_parser("generate", help="Create channels.txt in each subfolder based on existing *_streams.jsonl")
    p_gen.add_argument("--overwrite", action="store_true", help="Overwrite existing channels.txt")

    p_up = sub.add_parser("update", help="Update all folders using channels.txt")
    p_up.add_argument("--chunk-size", type=int, default=50)
    p_up.add_argument("--sleep-interval", type=float, default=0.2)
    p_up.add_argument("--max-sleep-interval", type=float, default=0.6)
    p_up.add_argument("--folder", default=None, help="Only update this subfolder name (e.g. hololive)")
    p_up.add_argument("--max-channels", type=int, default=None, help="Only update the first N channels per folder (smoke test)")

    args = parser.parse_args()
    root = _repo_root() / args.root

    if args.cmd == "generate":
        return generate_channels(root, overwrite=bool(args.overwrite))
    if args.cmd == "update":
        return update_all(
            root,
            chunk_size=int(args.chunk_size),
            sleep_interval=float(args.sleep_interval),
            max_sleep_interval=float(args.max_sleep_interval),
            folder_name=(str(args.folder) if args.folder else None),
            max_channels=(int(args.max_channels) if args.max_channels is not None else None),
        )

    raise AssertionError("unreachable")


if __name__ == "__main__":
    raise SystemExit(main())
