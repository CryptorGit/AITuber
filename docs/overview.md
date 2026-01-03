# Overview

このプロジェクトは **ゲーム/エミュ連携を扱いません**。

目的は「配信の主役AI」を動かすためのベース基盤（骨組み）を整えることです。

## パイプライン

1. LLM (Director)
- 入力: ユーザー1行入力（将来は chat/system/manager に拡張）
- 出力: `text`, `emotion`, `motion_tags` を固定スキーマで返す

2. TTS
- 入力: `text`
- 出力: `audio_path`（現状はダミーWAV）

3. Live2D / VTube Studio
- 入力: `motion_tags`
- 出力: VTube Studio に送信（現状はログ出力）

## ディレクトリ
- `apps/core`: 設定・型・ログ
- `apps/llm`: director（LLMスタブ）
- `apps/tts`: TTSスタブ
- `apps/live2d`: VTube Studioスタブ + motion tag routing
- `apps/orchestrator`: LLM→TTS→Live2D の統合
