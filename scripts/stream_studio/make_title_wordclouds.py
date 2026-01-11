from __future__ import annotations

import argparse
import csv
import math
import os
import random
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _default_font_path() -> str | None:
    # Prefer Japanese-capable fonts on Windows.
    candidates = [
        r"C:\\Windows\\Fonts\\meiryo.ttc",
        r"C:\\Windows\\Fonts\\meiryob.ttc",
        r"C:\\Windows\\Fonts\\msgothic.ttc",
        r"C:\\Windows\\Fonts\\YuGothR.ttc",
        r"C:\\Windows\\Fonts\\YuGothB.ttc",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _try_tokenize_jp(text: str) -> list[str] | None:
    try:
        from janome.tokenizer import Tokenizer  # type: ignore
    except Exception:
        return None

    tokenizer = Tokenizer()
    tokens: list[str] = []
    for tok in tokenizer.tokenize(text):
        surface = tok.surface
        pos = tok.part_of_speech.split(",", 1)[0]
        # Keep mostly content-bearing tokens.
        if pos not in {"名詞", "動詞", "形容詞"}:
            continue
        if len(surface) <= 1:
            continue
        tokens.append(surface)
    return tokens


_RE_FALLBACK = re.compile(r"[A-Za-z0-9_]{2,}|[\u3040-\u30FF\u4E00-\u9FFF]{2,}")


def tokenize_title(title: str) -> list[str]:
    title = title.strip()
    if not title:
        return []
    jp = _try_tokenize_jp(title)
    if jp is not None:
        return jp
    return _RE_FALLBACK.findall(title)


def _stopwords() -> set[str]:
    # Minimal stopword list; extend as needed.
    jp = {
        "ホロライブ",
        "にじさんじ",
        "配信",
        "雑談",
        "切り抜き",
        "アーカイブ",
        "初見",
        "実況",
        "生放送",
        "歌",
        "歌枠",
        "耐久",
        "参加型",
        "同時視聴",
        "コラボ",
        "ライブ",
        "攻略",
        "最終回",
        "続き",
        "今日",
        "明日",
        "本日",
        "今回",
        "です",
        "ます",
        "する",
        "した",
        "して",
        "いる",
        "やる",
        "やって",
        "できる",
        "よう",
        "こと",
        "これ",
        "それ",
        "あれ",
        "こちら",
        "ため",
        "そして",
        "でも",
        "から",
        "まで",
        "など",
    }
    en = {
        "the",
        "and",
        "for",
        "with",
        "this",
        "that",
        "from",
        "into",
        "lets",
        "let",
        "live",
        "stream",
        "streaming",
        "game",
        "part",
        "day",
        "new",
    }
    return {w.lower() for w in (jp | en)}


def build_frequencies(titles: list[str]) -> Counter[str]:
    stops = _stopwords()
    counter: Counter[str] = Counter()
    for t in titles:
        for token in tokenize_title(t):
            token_norm = token.strip().lower()
            if not token_norm:
                continue
            if token_norm in stops:
                continue
            if token_norm.isdigit():
                continue
            counter[token_norm] += 1
    return counter


@dataclass(frozen=True)
class Placed:
    x0: int
    y0: int
    x1: int
    y1: int

    def overlaps(self, other: "Placed") -> bool:
        return not (self.x1 <= other.x0 or self.x0 >= other.x1 or self.y1 <= other.y0 or self.y0 >= other.y1)


def _scale_font_size(freq: int, f_min: int, f_max: int, size_min: int, size_max: int) -> int:
    if f_max <= f_min:
        return size_max
    # log scale is usually nicer for word clouds
    a = math.log(freq) - math.log(f_min)
    b = math.log(f_max) - math.log(f_min)
    t = 0.0 if b == 0 else max(0.0, min(1.0, a / b))
    return int(round(size_min + (size_max - size_min) * t))


def render_wordcloud(
    freq: Counter[str],
    out_path: Path,
    font_path: str,
    width: int = 1600,
    height: int = 1000,
    max_words: int = 180,
    seed: int = 1337,
) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)

    items = [(w, c) for (w, c) in freq.most_common(max_words) if c > 0]
    if not items:
        return

    random.seed(seed)
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    counts = [c for _, c in items]
    f_min, f_max = min(counts), max(counts)

    placed: list[Placed] = []
    margin = 6

    # A small palette (no hard-coded branding colors; just readable).
    palette = [
        (15, 23, 42),
        (30, 64, 175),
        (88, 28, 135),
        (4, 120, 87),
        (124, 45, 18),
        (51, 65, 85),
    ]

    for idx, (word, count) in enumerate(items):
        size = _scale_font_size(count, f_min, f_max, size_min=18, size_max=120)
        angle = 0
        # Occasionally rotate a word for variety.
        if idx % 13 == 0:
            angle = 90

        placed_this = False
        for attempt in range(600):
            # Gradually shrink if it doesn't fit.
            s = max(12, int(size * (0.98 ** (attempt // 40))))
            try:
                font = ImageFont.truetype(font_path, s)
            except OSError:
                font = ImageFont.load_default()

            bbox = draw.textbbox((0, 0), word, font=font)
            w = bbox[2] - bbox[0]
            h = bbox[3] - bbox[1]
            if angle == 90:
                w, h = h, w

            if w + 2 * margin >= width or h + 2 * margin >= height:
                continue

            x0 = random.randint(margin, width - w - margin)
            y0 = random.randint(margin, height - h - margin)
            rect = Placed(x0 - margin, y0 - margin, x0 + w + margin, y0 + h + margin)

            if any(rect.overlaps(p) for p in placed):
                continue

            color = palette[idx % len(palette)]
            if angle == 0:
                draw.text((x0, y0), word, fill=color, font=font)
            else:
                tmp = Image.new("RGBA", (w, h), (255, 255, 255, 0))
                tmp_draw = ImageDraw.Draw(tmp)
                tmp_draw.text((0, 0), word, fill=color + (255,), font=font)
                tmp = tmp.rotate(90, expand=True)
                img.paste(tmp, (x0, y0), tmp)

            placed.append(rect)
            placed_this = True
            break

        if not placed_this:
            # Skip words that can't be placed without overlap.
            continue

    img.save(out_path)


def iter_stream_csv_files(streams_root: Path) -> list[Path]:
    return sorted(streams_root.glob("**/*_streams.csv"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate per-channel word clouds from YouTube stream titles")
    parser.add_argument("--streams-root", default="data/stream_studio/finetune/youtube/meta/streams")
    parser.add_argument("--out-root", default="data/stream_studio/finetune/youtube/meta/wordclouds")
    parser.add_argument("--font-path", default=None)
    parser.add_argument("--overwrite", action="store_true")
    parser.add_argument("--max-files", type=int, default=None)
    args = parser.parse_args()

    repo = _repo_root()
    streams_root = repo / args.streams_root
    out_root = repo / args.out_root
    out_root.mkdir(parents=True, exist_ok=True)

    font_path = args.font_path or _default_font_path()
    if not font_path:
        print("ERROR: No Japanese-capable font found. Provide --font-path (e.g. C:/Windows/Fonts/meiryo.ttc)")
        return 2

    files = iter_stream_csv_files(streams_root)
    if args.max_files is not None:
        files = files[: int(args.max_files)]
    if not files:
        print(f"No *_streams.csv found under: {streams_root}")
        return 0

    created = 0
    for csv_path in files:
        rel = csv_path.relative_to(streams_root)
        out_dir = out_root / rel.parent
        stem = csv_path.name.replace("_streams.csv", "")
        out_png = out_dir / f"{stem}_title_wordcloud.png"
        if out_png.exists() and not args.overwrite:
            continue

        titles: list[str] = []
        with csv_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames or "title" not in reader.fieldnames:
                continue
            for row in reader:
                t = (row.get("title") or "").strip()
                if t:
                    titles.append(t)

        freq = build_frequencies(titles)
        if not freq:
            continue

        render_wordcloud(freq, out_png, font_path=font_path)
        created += 1
        print(f"Wrote {out_png.relative_to(repo)}")

    print(f"Done. wordclouds written: {created}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
