# labeler_loop (録音→STT→候補5→選択→保存)

このサブアプリは「録音ボタン中心のデータ収集Webサーバ」です。

- 既存の AITuber 本体には手を入れず、`apps/labeler_loop/` 以下に隔離しています
- 秘密情報はコミットしません（`.env` と `.gitignore`）
- 各ターンで「候補5つ」「勝ち1つ」「負け4つ」を JSONL で必ず保存します

## 構成

- `backend/` : FastAPI サーバ
- `web/labeler_loop/` : 1画面UI（既存の `web/` 配下に集約）
- `data/labeler_loop/` : 収集データ（`labels.jsonl`, 音声ファイル等） ※既存の `data/` 配下

## 前提

- Python 3.10+（推奨 3.11）
- ffmpeg（音声を `wav (Linear16, 16kHz, mono)` に変換するため必須）
- Google Cloud 認証（Speech-to-Text）
- Gemini API Key（候補生成）

### ffmpeg (Windows)

- winget: `winget install Gyan.FFmpeg`
- または Chocolatey: `choco install ffmpeg`

インストール後、`ffmpeg -version` が通ることを確認してください。

もし PATH をいじりたくない場合は、`.env/.env.labeler_loop` に `FFMPEG_PATH`（`ffmpeg.exe` のフルパス）を設定しても動きます。

## セットアップ

```powershell
cd apps/labeler_loop
py -3.13 -m venv ..\..\..\.venv\labeler_loop
..\..\..\.venv\labeler_loop\Scripts\pip install -r requirements.txt
```

### 環境変数（`.env`）

`.env/.env.labeler_loop` を作成して、値を入れてください。

- `GOOGLE_APPLICATION_CREDENTIALS` : Speech-to-Text 用のサービスアカウントJSONへのパス
- `GEMINI_API_KEY` : Gemini の API キー（Google AI Studio 等）

※ `.env` はコミットしません。

## 起動

```powershell
cd apps/labeler_loop
..\..\..\.venv\labeler_loop\Scripts\python -m uvicorn app:app --reload --port 7861
```

ブラウザで `http://127.0.0.1:7861/` を開きます。

## 手動テスト手順（3つ）

1) 録音→STT→候補→選択→保存が1回通る
- [録音開始]→話す→[録音停止]
- STTがテキストボックスに出る
- 候補が5つ出る
- 1つ選んで[送信]
- `data/labeler_loop/labels.jsonl` に1行増える

2) 連続で5ターン回して labels.jsonl が増える
- 上を5回繰り返す
- `labels.jsonl` の行数が5増える
- 各行に candidates(5) と winner_index がある

3) JSON崩れ/音声変換失敗時にUIにエラーが出て保存されない
- `ffmpeg` をPATHから外す（または存在しない状態で起動）→録音停止
- UIにエラーが出て candidates が出ない
- [送信]しても保存されない（`labels.jsonl` が増えない）
