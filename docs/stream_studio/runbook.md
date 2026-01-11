# RUNBOOK (MVP)

対象: Windows (PowerShell) / Python 3.11+

## 1) セットアップ

```powershell
# 依存導入 + .env 作成 + サーバ起動（まとめ）
.\scripts\run_dev.ps1
```

### まとめて起動（サーバ）

```powershell
.\scripts\run_stack.ps1
```

`.env` を編集して最低限これだけ入れる:

- `AITUBER_GEMINI_API_KEY`（Google AI Studio の Gemini API Key）
- Google TTS を使う場合は、Google Cloud 認証（ADC）を用意
- （任意）VTube Studio を実際に動かす場合は `AITUBER_VTUBE_AUTH_TOKEN` と `config/stream_studio/live2d_hotkeys.yaml`

## 1.1) Web UI (Stage / Console)

サーバ起動後、ブラウザで以下を開きます:

- `http://127.0.0.1:8000/console` (管理画面)
	- カメラ選択→プレビュー
	- 1秒ごとにフレームを `/vlm/frame` へ送信（サーバ側で要約。必要なときだけ /web/submit に添付）
	- STT: `none(手入力)` / `webspeech(Web Speech API)`
	- STT結果は `/stt/text` に送信し、既存の `/events` と同じフローで `pending.json` を生成
	- 候補承認/却下は既存の `/manager/approve` `/manager/reject`

- `http://127.0.0.1:8000/stage` (ステージ/オーバーレイ)
	- `/overlay_text` を数百msごとに取得して字幕を表示
	- `tts_queue`（文単位の音声セグメント）を順番に `<audio>` で再生
	- `/motion` または承認時 `motion_tags` に応じて Live2D モーションを再生

OBS の Browser Source として `http://127.0.0.1:8000/stage` を指定すると、字幕+Live2D+音声をまとめて扱えます。

## 1.2) TTS (Google Cloud Text-to-Speech)

このプロジェクトの Web UI は TTS を Google Cloud Text-to-Speech で行います。

- `.env`（または環境変数）に以下を用意
	- `GOOGLE_APPLICATION_CREDENTIALS`（サービスアカウントJSONへのパス）
	- `AITUBER_TTS_PROVIDER=google`
	- `AITUBER_TTS_VOICE=ja-JP-Neural2-B`（任意）

疎通確認（認証/権限のチェック）:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/tts/health
```

## 2) サーバ確認

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/state
Invoke-RestMethod http://127.0.0.1:8000/overlay_text
```

### 計測ログ

`data/stream_studio/events.jsonl` に `type=timing` が追記されます（同一 `request_id` で相関）。
ブラウザ console には `[aituber/perf]` が出ます。

## 3) RAG（Short/Long）を投入（WebUI もしくは API）

WebUI（`/console`）の RAG セクションから追加/削除できます。

API例（Short RAG）:

```powershell
$body = @{ rag_type = "short"; title = "persona"; text = "あなたは落ち着いた口調の配信者AI。" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/rag/add -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:8000/rag/list?type=short"
```

API例（Long RAG）:

```powershell
$body = @{ rag_type = "long"; title = "world"; text = "この配信は…" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/rag/add -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:8000/rag/list?type=long"
```

旧: `/rag/long_term/upsert` は互換目的で残していますが、WebUI運用は `/rag/add` を推奨します。

## 4) VLM（スクショ/画像）

### 4.1 画像パス指定で要約（テスト用）

```powershell
$body = @{ path = "tests/image_test.jpg" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/vlm/summary_from_path -ContentType application/json -Body $body
```

### 4.2 スクショ取得→要約

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/vlm/capture
Invoke-RestMethod http://127.0.0.1:8000/vlm/summary
```

## 5) デモ（スタブ入力→承認→OBS/TTS/Live2D）

```powershell
.\scripts\demo_stub.ps1
```

## 5.1) API疎通スモーク（テキスト + 画像 + 音声 + API応答）

`/health` →（任意）画像要約 → `/events` → `/manager/approve` をまとめて確認します。

```powershell
.\scripts\smoke_api.ps1 -IncludeVlm -ImagePath "tests/image_test.jpg"
```

生成物（gitignore対象）
- `data/stream_studio/events.jsonl`
- `data/stream_studio/manager/pending.json`
- `data/stream_studio/state.json`
- `data/stream_studio/obs/overlay.txt`
- `data/stream_studio/audio/*.wav`

## 6) VTube Studio ホットキー設定

1. VTube Studio 側で API を有効化し、トークンを発行
2. `.env` の `AITUBER_VTUBE_AUTH_TOKEN` に設定
3. Hotkey一覧を取得（接続確認）

```powershell
Invoke-RestMethod http://127.0.0.1:8000/live2d/hotkeys
```

4. `config/stream_studio/live2d_hotkeys.yaml` の各タグに hotkeyID を貼り付け

## 7) トラブルシュート

- `Import could not be resolved` がIDEに出る
	- `.venv` に依存が入っていない可能性。`run_dev.ps1` を再実行
- Geminiが使えない
	- `AITUBER_GEMINI_API_KEY` 未設定だとフォールバックで動く
	- `ClientError: 429 RESOURCE_EXHAUSTED` は Gemini API のクォータ超過（課金/上限/レート）なので、キー側の設定が必要
- VLM が `(vlm not configured: skipped)` になる
	- `AITUBER_GEMINI_API_KEY` を設定して再実行
- 音声が出ない（Google TTS）
	- `http://127.0.0.1:8000/tts/health` が `ok: True` か確認（認証/権限）
	- `GOOGLE_APPLICATION_CREDENTIALS` が設定されているか
	- `AITUBER_TTS_VOICE` を確認（例: `ja-JP-Neural2-B`）
- VTube Studio が失敗する
	- token/hotkeyID未設定だとスキップしてログに残す

### 参考: 現在の疎通状態（秘密は出さない）

```powershell
Invoke-RestMethod http://127.0.0.1:8000/diagnostics
```
