# labeler-loop（音声→STT→候補生成→ラベリング）

`apps/labeler-loop/` は、音声入力から

1) 音声を `wav (16kHz, mono, Linear16)` に変換
2) Speech-to-Text で文字起こし
3) Gemini で候補テキストを生成
4) Web UI で「どの候補が良いか」を選び、理由タグ付きで `labels.jsonl` に保存

…というループを回すための小さなツールです。

## ディレクトリ

- サーバ: `apps/labeler-loop/app.py`（FastAPI）
- UI: `web/labeler-loop/`
- データ: `data/labeler-loop/`
	- `labels.jsonl`
	- `audio/`

## 前提

- Python 3.11+（プロジェクト全体の venv と共通）
- `ffmpeg`（音声変換）
- Google Cloud 認証（Speech-to-Text を使う場合）
- Gemini API Key（候補生成を使う場合）

## .env（最低限）

`.env/` から読み込みます。

- `GOOGLE_APPLICATION_CREDENTIALS` : Speech-to-Text 用サービスアカウント JSON
- `GEMINI_API_KEY`（または `GOOGLE_API_KEY`）: Gemini API Key
- `FFMPEG_PATH` : `ffmpeg.exe` へのフルパス（PATH 未設定の場合）

## 起動

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
cd .

- winget: `winget install Gyan.FFmpeg`
- 縺セ縺溘・ Chocolatey: `choco install ffmpeg`

繧、繝ウ繧ケ繝医・繝ォ蠕後€~ffmpeg -version` 縺碁€壹k縺薙→繧堤「コ隱阪@縺ヲ縺上□縺輔>縲・

PATH 繧偵>縺倥j縺溘¥縺ェ縺・エ蜷医・縲~.env/.env.labeler-loop` 縺ォ `FFMPEG_PATH`・・ffmpeg.exe` 縺ョ繝輔Ν繝代せ・峨r險ュ螳壹〒縺阪∪縺吶€・

## 繧サ繝・ヨ繧「繝・・

縺薙・繝ェ繝昴ず繝医Μ縺ッ萓晏ュ倥r繝ォ繝シ繝医・ [requirements.txt](requirements.txt) 縺ォ邨ア蜷医@縺ヲ縺・∪縺吶€・

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 迺ー蠅・、画焚・・env・・

`.env/.env.labeler-loop` 繧剃ス懈・縺励※蛟、繧貞・繧後※縺上□縺輔>縲・

- `GOOGLE_APPLICATION_CREDENTIALS` : Speech-to-Text 逕ィ縺ョ繧オ繝シ繝薙せ繧「繧ォ繧ヲ繝ウ繝・SON縺ク縺ョ繝代せ
- `GEMINI_API_KEY` : Gemini 縺ョ API 繧ュ繝シ・・oogle AI Studio 遲会シ・
- `FFMPEG_PATH` : 莉サ諢擾シ・ffmpeg.exe` 縺ョ繝輔Ν繝代せ・・

## 襍キ蜍・

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir "C:\Users\crypt\source\repos\CryptorGit\AITuber\apps\labeler-loop" --reload --host 127.0.0.1 --port 7861
```

繝悶Λ繧ヲ繧カ縺ァ `http://127.0.0.1:7861/` 繧帝幕縺阪∪縺吶€・

## 謇句虚繝・せ繝域焔鬆・シ・縺、・・

1) 骭イ髻ウ竊担TT竊貞€呵」懌・驕ク謚樞・菫晏ュ倥′1蝗樣€壹k
- [骭イ髻ウ髢句ァ犠竊定ゥア縺吮・[骭イ髻ウ蛛懈ュ「]
- STT縺後ユ繧ュ繧ケ繝医・繝・け繧ケ縺ォ蜃コ繧・
- 蛟呵」懊′5縺、蜃コ繧・
- 1縺、驕ク繧薙〒[騾∽ソ。]
- `data/labeler-loop/labels.jsonl` 縺ォ1陦悟「励∴繧・

2) 騾」邯壹〒5繧ソ繝シ繝ウ蝗槭@縺ヲ labels.jsonl 縺悟「励∴繧・
- 荳翫r5蝗樒ケー繧願ソ斐☆
- `labels.jsonl` 縺ョ陦梧焚縺・蠅励∴繧・
- 蜷・。後↓ candidates(5) 縺ィ winner_index 縺後≠繧・

3) JSON蟠ゥ繧・髻ウ螢ー螟画鋤螟ア謨玲凾縺ォUI縺ォ繧ィ繝ゥ繝シ縺悟・縺ヲ菫晏ュ倥&繧後↑縺・
- `ffmpeg` 繧単ATH縺九i螟悶☆・医∪縺溘・蟄伜惠縺励↑縺・憾諷九〒襍キ蜍包シ俄・骭イ髻ウ蛛懈ュ「
- UI縺ォ繧ィ繝ゥ繝シ縺悟・縺ヲ candidates 縺悟・縺ェ縺・
- [騾∽ソ。]縺励※繧ゆソ晏ュ倥&繧後↑縺・シ・labels.jsonl` 縺悟「励∴縺ェ縺・シ・
