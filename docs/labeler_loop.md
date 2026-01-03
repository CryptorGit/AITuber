# labeler_loop (録音→STT→候補5→選択→保存)

このサブアプリは「録音ボタン中心のデータ収集Webサーバ」です。

- AITuber 本体とは分離して `apps/labeler_loop/` に配置しています
- 秘密情報はコミットしません（`.env/` が gitignored）
- 各ターンで「候補5つ」「勝ち1つ」「負け4つ」を JSONL で必ず保存します

## 構成

- サーバ: `apps/labeler_loop/app.py`（FastAPI）
- UI: `web/labeler_loop/`（1画面）
- データ: `data/labeler_loop/`（`labels.jsonl`, 音声ファイル等）

## 前提

- Python 3.10+（推奨 3.11 / 3.13 でも可）
- ffmpeg（音声を `wav (Linear16, 16kHz, mono)` に変換するため必須）
- Google Cloud 認証（Speech-to-Text）
- Gemini API Key（候補生成）

### ffmpeg (Windows)

- winget: `winget install Gyan.FFmpeg`
- または Chocolatey: `choco install ffmpeg`

インストール後、`ffmpeg -version` が通ることを確認してください。

PATH をいじりたくない場合は、`.env/.env.labeler_loop` に `FFMPEG_PATH`（`ffmpeg.exe` のフルパス）を設定できます。

## セットアップ

このリポジトリは依存をルートの [requirements.txt](requirements.txt) に統合しています。

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 環境変数（.env）

`.env/.env.labeler_loop` を作成して値を入れてください。

- `GOOGLE_APPLICATION_CREDENTIALS` : Speech-to-Text 用のサービスアカウントJSONへのパス
- `GEMINI_API_KEY` : Gemini の API キー（Google AI Studio 等）
- `FFMPEG_PATH` : 任意（`ffmpeg.exe` のフルパス）

## 起動

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir "C:\Users\crypt\source\repos\CryptorGit\AITuber\apps\labeler_loop" --reload --host 127.0.0.1 --port 7861
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
