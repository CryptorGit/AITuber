# RUNBOOK (MVP)

対象: Windows (PowerShell) / Python 3.11+

## 1) セットアップ

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber

# venv (例)
py -3.13 -m venv .venv
cd .
\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 2) .env（最低限）

Secrets は `.env/` から読み込みます（`AITUBER_ENV_FILE` も利用可）。

- `AITUBER_GEMINI_API_KEY`
	- Gemini API Key（互換: `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GEMINI_API_KEY`）
- `GOOGLE_APPLICATION_CREDENTIALS`
	- Google Cloud のサービスアカウント JSON パス（TTS/STT を使う場合）

任意（必要に応じて）:

- `AITUBER_TTS_PROVIDER`（既定: `google`）
- `AITUBER_TTS_VOICE`（既定: `ja-JP-Neural2-B`）
- `AITUBER_VTUBE_WS_URL`（既定: `ws://127.0.0.1:8001`）
- `AITUBER_VTUBE_AUTH_TOKEN`（VTube Studio を実機連携する場合）

## 3) 起動

### 3.1) 開発用（単体）

```powershell
cd .
\scripts\run_dev.ps1
```



- `http://127.0.0.1:8000/console` (邂。逅・判髱「)
	- 繧ォ繝。繝ゥ驕ク謚樞・繝励Ξ繝薙Η繝シ
	- 1遘偵#縺ィ縺ォ繝輔Ξ繝シ繝繧・`/vlm/frame` 縺ク騾∽ソ。・医し繝シ繝仙・縺ァ隕∫エ・€ょソ・ヲ√↑縺ィ縺阪□縺・/web/submit 縺ォ豺サ莉假シ・
	- STT: `none(謇句・蜉・` / `webspeech(Web Speech API)`
	- STT邨先棡縺ッ `/stt/text` 縺ォ騾∽ソ。縺励€∵里蟄倥・ `/events` 縺ィ蜷後§繝輔Ο繝シ縺ァ `pending.json` 繧堤函謌・
	- 蛟呵」懈価隱・蜊エ荳九・譌「蟄倥・ `/manager/approve` `/manager/reject`

- `http://127.0.0.1:8000/stage` (繧ケ繝・・繧ク/繧ェ繝シ繝舌・繝ャ繧、)
	- `/overlay_text` 繧呈焚逋セms縺斐→縺ォ蜿門セ励@縺ヲ蟄怜ケ輔r陦ィ遉コ
	- `tts_queue`・域枚蜊倅ス阪・髻ウ螢ー繧サ繧ー繝。繝ウ繝茨シ峨r鬆・分縺ォ `<audio>` 縺ァ蜀咲函
	- `/motion` 縺セ縺溘・謇ソ隱肴凾 `motion_tags` 縺ォ蠢懊§縺ヲ Live2D 繝「繝シ繧キ繝ァ繝ウ繧貞・逕・

OBS 縺ョ Browser Source 縺ィ縺励※ `http://127.0.0.1:8000/stage` 繧呈欠螳壹☆繧九→縲∝ュ怜ケ・Live2D+髻ウ螢ー繧偵∪縺ィ繧√※謇ア縺医∪縺吶€・

## 1.2) TTS (Google Cloud Text-to-Speech)

縺薙・繝励Ο繧ク繧ァ繧ッ繝医・ Web UI 縺ッ TTS 繧・Google Cloud Text-to-Speech 縺ァ陦後>縺セ縺吶€・

- `.env`・医∪縺溘・迺ー蠅・、画焚・峨↓莉・荳九r逕ィ諢・
	- `GOOGLE_APPLICATION_CREDENTIALS`・医し繝シ繝薙せ繧「繧ォ繧ヲ繝ウ繝・SON縺ク縺ョ繝代せ・・
	- `AITUBER_TTS_PROVIDER=google`
	- `AITUBER_TTS_VOICE=ja-JP-Neural2-B`・井ササ諢擾シ・

逍朱€夂「コ隱搾シ郁ェ崎ィシ/讓ゥ髯舌・繝√ぉ繝・け・・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/tts/health
```

## 1.3) Animation Selector LLM・・TS荳ュ縺ォ陦ィ諠・繝「繝シ繧キ繝ァ繝ウ驕ク謚橸シ・

`/console` 縺ョ "Animation Selector LLM" 繧丹N縺ォ縺吶k縺ィ縲~/stage` 縺碁浹螢ー蜀咲函髢句ァ九→蜷梧凾縺ォ `POST /anim/select` 繧帝撼蜷梧悄縺ァ蜻シ縺ウ蜃コ縺励∪縺吶€・

- 逶ョ逧・ 霑比ソ。逕滓・LLM縺ィ縺ッ蛻・縺ォ縲ゝTS蜀咲函荳ュ縺ォ Live2D 縺ョ `expression` 縺ィ `motion` 繧帝∈縺カ
- 邨ゆコ・ `tts_queue` 縺ョ譛€蠕後・髻ウ螢ー縺檎オゅo縺」縺溘ち繧、繝溘Φ繧ー縺ァ縲~reset_after_tts=true` 縺ョ蝣エ蜷・`exp_01` 縺ィ `IDLE_DEFAULT` 縺ォ蠕ゥ蟶ー

邁。譏薙ユ繧ケ繝・

- `/console` 縺ァ `Test /anim/select` 繧呈款縺呻シ・PI繧ュ繝シ譛ェ險ュ螳壹・蝣エ蜷医・螳牙・縺ェ繝輔か繝シ繝ォ繝舌ャ繧ッJSON・・
- `/stage` 縺ョ繝悶Λ繧ヲ繧カDevTools console 縺ォ `anim/select request/response` 縺ィ `anim/reset` 繝ュ繧ー縺悟・繧・

## 2) 繧オ繝シ繝千「コ隱・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/state
Invoke-RestMethod http://127.0.0.1:8000/overlay_text
```

### 險域クャ繝ュ繧ー

`data/stream-studio/events.jsonl` 縺ォ `type=timing` 縺瑚ソス險倥&繧後∪縺呻シ亥酔荳€ `request_id` 縺ァ逶ク髢「・峨€・
繝悶Λ繧ヲ繧カ console 縺ォ縺ッ `[aituber/perf]` 縺悟・縺セ縺吶€・

## 3) RAG・・hort/Long・峨r謚募・・・ebUI 繧ゅ@縺上・ API・・

WebUI・・/console`・峨・ RAG 繧サ繧ッ繧キ繝ァ繝ウ縺九i霑ス蜉/蜑企勁縺ァ縺阪∪縺吶€・

API萓具シ・hort RAG・・

```powershell
$body = @{ rag_type = "short"; title = "persona"; text = "縺ゅ↑縺溘・關ス縺。逹€縺・◆蜿」隱ソ縺ョ驟堺ソ。閠・I縲・ } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/rag/add -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:8000/rag/list?type=short"
```

API萓具シ・ong RAG・・

```powershell
$body = @{ rag_type = "long"; title = "world"; text = "縺薙・驟堺ソ。縺ッ窶ヲ" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/rag/add -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:8000/rag/list?type=long"
```

譌ァ: `/rag/long_term/upsert` 縺ッ莠呈鋤逶ョ逧・〒谿九@縺ヲ縺・∪縺吶′縲仝ebUI驕狗畑縺ッ `/rag/add` 繧呈耳螂ィ縺励∪縺吶€・

## 4) VLM・医せ繧ッ繧キ繝ァ/逕サ蜒擾シ・

### 4.1 逕サ蜒上ヱ繧ケ謖・ョ壹〒隕∫エ・シ医ユ繧ケ繝育畑・・

```powershell
$body = @{ path = "tests/image_test.jpg" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/vlm/summary_from_path -ContentType application/json -Body $body
```

### 4.2 繧ケ繧ッ繧キ繝ァ蜿門セ冷・隕∫エ・

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/vlm/capture
Invoke-RestMethod http://127.0.0.1:8000/vlm/summary
```

## 5) 繝・Δ・医せ繧ソ繝門・蜉帚・謇ソ隱坂・OBS/TTS/Live2D・・

```powershell
.\scripts\demo_stub.ps1
```

## 5.1) API逍朱€壹せ繝「繝シ繧ッ・医ユ繧ュ繧ケ繝・+ 逕サ蜒・+ 髻ウ螢ー + API蠢懃ュ費シ・

`/health` 竊抵シ井ササ諢擾シ臥判蜒剰ヲ∫エ・竊・`/events` 竊・`/manager/approve` 繧偵∪縺ィ繧√※遒コ隱阪@縺セ縺吶€・

```powershell
.\scripts\smoke_api.ps1 -IncludeVlm -ImagePath "tests/image_test.jpg"
```

逕滓・迚ゥ・・itignore蟇セ雎。・・
- `data/stream-studio/events.jsonl`
- `data/stream-studio/manager/pending.json`
- `data/stream-studio/state.json`
- `data/stream-studio/obs/overlay.txt`
- `data/stream-studio/audio/*.wav`

## 6) VTube Studio 繝帙ャ繝医く繝シ險ュ螳・

1. VTube Studio 蛛エ縺ァ API 繧呈怏蜉ケ蛹悶@縲√ヨ繝シ繧ッ繝ウ繧堤匱陦・
2. `.env` 縺ョ `AITUBER_VTUBE_AUTH_TOKEN` 縺ォ險ュ螳・
3. Hotkey荳€隕ァ繧貞叙蠕暦シ域磁邯夂「コ隱搾シ・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/live2d/hotkeys
```

4. `config/stream-studio/live2d_hotkeys.yaml` 縺ョ蜷・ち繧ー縺ォ hotkeyID 繧定イシ繧贋サ倥¢

## 7) 繝医Λ繝悶Ν繧キ繝・繝シ繝・

- `Import could not be resolved` 縺栗DE縺ォ蜃コ繧・
	- `.venv` 縺ォ萓晏ュ倥′蜈・縺」縺ヲ縺・↑縺・庄閭ス諤ァ縲Arun_dev.ps1` 繧貞・螳溯。・
- Gemini縺御スソ縺医↑縺・
	- `AITUBER_GEMINI_API_KEY` 譛ェ險ュ螳壹□縺ィ繝輔か繝シ繝ォ繝舌ャ繧ッ縺ァ蜍輔¥
	- `ClientError: 429 RESOURCE_EXHAUSTED` 縺ッ Gemini API 縺ョ繧ッ繧ゥ繝シ繧ソ雜・℃・郁ェイ驥・荳企剞/繝ャ繝シ繝茨シ峨↑縺ョ縺ァ縲√く繝シ蛛エ縺ョ險ュ螳壹′蠢・ヲ・
- VLM 縺・`(vlm not configured: skipped)` 縺ォ縺ェ繧・
	- `AITUBER_GEMINI_API_KEY` 繧定ィュ螳壹@縺ヲ蜀榊ョ溯。・
- 髻ウ螢ー縺悟・縺ェ縺・シ・oogle TTS・・
	- `http://127.0.0.1:8000/tts/health` 縺・`ok: True` 縺狗「コ隱搾シ郁ェ崎ィシ/讓ゥ髯撰シ・
	- `GOOGLE_APPLICATION_CREDENTIALS` 縺瑚ィュ螳壹&繧後※縺・k縺・
	- `AITUBER_TTS_VOICE` 繧堤「コ隱搾シ井セ・ `ja-JP-Neural2-B`・・
- VTube Studio 縺悟、ア謨励☆繧・
	- token/hotkeyID譛ェ險ュ螳壹□縺ィ繧ケ繧ュ繝・・縺励※繝ュ繧ー縺ォ谿九☆

### 蜿り€・ 迴セ蝨ィ縺ョ逍朱€夂憾諷具シ育ァ伜ッ・・蜃コ縺輔↑縺・シ・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/diagnostics
```
