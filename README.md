# AITuber

このリポジトリは「配信の主役AI」を動かすためのベース基盤（骨組み）です。

- LLM（Gemini） + RAG（短期/長期） + VLM（スクショ要約）
- TTS（Google Cloud Text-to-Speech）
- Live2D/VTube Studio + OBS オーバーレイ
- Manager 承認フロー（出力の確認/修正/却下）

※ゲーム/エミュ/BizHawk/RL は扱いません。

## Quickstart

```powershell
# 依存導入 + .env 作成 + サーバ起動
cd .
\scripts\run_dev.ps1

# サーバをまとめて起動（Gemini + Google TTS を含む）
cd .
\scripts\run_stack.ps1

# ブラウザ: Web UI
# - http://127.0.0.1:8000/console (管理/操作)
# - http://127.0.0.1:8000/stage (OBS Browser Source 向け)

# Google TTS 疎通確認（認証/権限）
Invoke-RestMethod http://127.0.0.1:8000/tts/health

# 別ターミナルで、スタブ入力 → 承認 → OBS/TTS/Live2D まで通す（LLM互換の固定JSON）
cd .
\scripts\demo_stub.ps1
```

## Perf / 計測

- サーバは `data/stream-studio/events.jsonl` に `type=timing` を追記します（同一 `request_id` で相関）。
- ブラウザ console に `[aituber/perf]` が出ます（送信→字幕反映、音声再生開始など）。

## Docs

- [docs/stream-studio/overview.md](docs/stream-studio/overview.md)
- [docs/stream-studio/runbook.md](docs/stream-studio/runbook.md)
- [docs/stream-studio/ARCHITECTURE.md](docs/stream-studio/ARCHITECTURE.md)
- [docs/stream-studio/schemas.md](docs/stream-studio/schemas.md)
- [docs/tetris-ai/overview.md](docs/tetris-ai/overview.md)

