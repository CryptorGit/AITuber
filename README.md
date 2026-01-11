# AITuber

このプロジェクトは **配信の主役AI（LLM + RAG(短期/長期) + VLM(スクショ要約) + TTS + Live2D/VTube Studio + OBSテロップ + Manager承認）** を動かすための基盤です。

**ゲーム、エミュレータ、BizHawk、RL/学習、テレメトリ等は扱いません。**

## Quickstart

```powershell
# 依存導入 + .env 作成 + サーバ起動
.\scripts\run_dev.ps1

# サーバをまとめて起動（Gemini + Google TTS）
.\scripts\run_stack.ps1

# ブラウザ: Web UI
# - http://127.0.0.1:8000/console (管理画面)
# - http://127.0.0.1:8000/stage (OBS Browser Source向け)

# Google TTS 疎通確認（認証/権限）
Invoke-RestMethod http://127.0.0.1:8000/tts/health

# 別ターミナルで、スタブ入力→承認→OBS/TTS/Live2D まで通す（CLI互換）
.\scripts\demo_stub.ps1
```

## Perf / 計測

- サーバ: `data/stream_studio/events.jsonl` に `type=timing` が追記されます（同一 `request_id` で相関）
- ブラウザ console: `[aituber/perf]` が出ます（送信→字幕反映、音声再生開始など）

## Docs

- [docs/stream_studio/overview.md](docs/stream_studio/overview.md)
- [docs/stream_studio/runbook.md](docs/stream_studio/runbook.md)
- [docs/stream_studio/ARCHITECTURE.md](docs/stream_studio/ARCHITECTURE.md)
- [docs/stream_studio/schemas.md](docs/stream_studio/schemas.md)
- [docs/stream_studio/ROADMAP.md](docs/stream_studio/ROADMAP.md)
