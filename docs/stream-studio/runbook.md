# RUNBOOK (MVP)

蟇ｾ雎｡: Windows (PowerShell) / Python 3.11+

## 1) 繧ｻ繝・ヨ繧｢繝・・

```powershell
# 萓晏ｭ伜ｰ主・ + .env 菴懈・ + 繧ｵ繝ｼ繝占ｵｷ蜍包ｼ医∪縺ｨ繧・ｼ・
.\scripts\run_dev.ps1
```

### 縺ｾ縺ｨ繧√※襍ｷ蜍包ｼ医し繝ｼ繝撰ｼ・

```powershell
.\scripts\run_stack.ps1
```

`.env` 繧堤ｷｨ髮・＠縺ｦ譛菴朱剞縺薙ｌ縺縺大・繧後ｋ:

- `AITUBER_GEMINI_API_KEY`・・oogle AI Studio 縺ｮ Gemini API Key・・
- Google TTS 繧剃ｽｿ縺・ｴ蜷医・縲；oogle Cloud 隱崎ｨｼ・・DC・峨ｒ逕ｨ諢・
- ・井ｻｻ諢擾ｼ鰻Tube Studio 繧貞ｮ滄圀縺ｫ蜍輔°縺吝ｴ蜷医・ `AITUBER_VTUBE_AUTH_TOKEN` 縺ｨ `config/stream-studio/live2d_hotkeys.yaml`

## 1.1) Web UI (Stage / Console)

繧ｵ繝ｼ繝占ｵｷ蜍募ｾ後√ヶ繝ｩ繧ｦ繧ｶ縺ｧ莉･荳九ｒ髢九″縺ｾ縺・

- `http://127.0.0.1:8000/console` (邂｡逅・判髱｢)
	- 繧ｫ繝｡繝ｩ驕ｸ謚樞・繝励Ξ繝薙Η繝ｼ
	- 1遘偵＃縺ｨ縺ｫ繝輔Ξ繝ｼ繝繧・`/vlm/frame` 縺ｸ騾∽ｿ｡・医し繝ｼ繝仙・縺ｧ隕∫ｴ・ょｿ・ｦ√↑縺ｨ縺阪□縺・/web/submit 縺ｫ豺ｻ莉假ｼ・
	- STT: `none(謇句・蜉・` / `webspeech(Web Speech API)`
	- STT邨先棡縺ｯ `/stt/text` 縺ｫ騾∽ｿ｡縺励∵里蟄倥・ `/events` 縺ｨ蜷後§繝輔Ο繝ｼ縺ｧ `pending.json` 繧堤函謌・
	- 蛟呵｣懈価隱・蜊ｴ荳九・譌｢蟄倥・ `/manager/approve` `/manager/reject`

- `http://127.0.0.1:8000/stage` (繧ｹ繝・・繧ｸ/繧ｪ繝ｼ繝舌・繝ｬ繧､)
	- `/overlay_text` 繧呈焚逋ｾms縺斐→縺ｫ蜿門ｾ励＠縺ｦ蟄怜ｹ輔ｒ陦ｨ遉ｺ
	- `tts_queue`・域枚蜊倅ｽ阪・髻ｳ螢ｰ繧ｻ繧ｰ繝｡繝ｳ繝茨ｼ峨ｒ鬆・分縺ｫ `<audio>` 縺ｧ蜀咲函
	- `/motion` 縺ｾ縺溘・謇ｿ隱肴凾 `motion_tags` 縺ｫ蠢懊§縺ｦ Live2D 繝｢繝ｼ繧ｷ繝ｧ繝ｳ繧貞・逕・

OBS 縺ｮ Browser Source 縺ｨ縺励※ `http://127.0.0.1:8000/stage` 繧呈欠螳壹☆繧九→縲∝ｭ怜ｹ・Live2D+髻ｳ螢ｰ繧偵∪縺ｨ繧√※謇ｱ縺医∪縺吶・

## 1.2) TTS (Google Cloud Text-to-Speech)

縺薙・繝励Ο繧ｸ繧ｧ繧ｯ繝医・ Web UI 縺ｯ TTS 繧・Google Cloud Text-to-Speech 縺ｧ陦後＞縺ｾ縺吶・

- `.env`・医∪縺溘・迺ｰ蠅・､画焚・峨↓莉･荳九ｒ逕ｨ諢・
	- `GOOGLE_APPLICATION_CREDENTIALS`・医し繝ｼ繝薙せ繧｢繧ｫ繧ｦ繝ｳ繝・SON縺ｸ縺ｮ繝代せ・・
	- `AITUBER_TTS_PROVIDER=google`
	- `AITUBER_TTS_VOICE=ja-JP-Neural2-B`・井ｻｻ諢擾ｼ・

逍朱夂｢ｺ隱搾ｼ郁ｪ崎ｨｼ/讓ｩ髯舌・繝√ぉ繝・け・・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/tts/health
```

## 1.3) Animation Selector LLM・・TS荳ｭ縺ｫ陦ｨ諠・繝｢繝ｼ繧ｷ繝ｧ繝ｳ驕ｸ謚橸ｼ・

`/console` 縺ｮ "Animation Selector LLM" 繧丹N縺ｫ縺吶ｋ縺ｨ縲～/stage` 縺碁浹螢ｰ蜀咲函髢句ｧ九→蜷梧凾縺ｫ `POST /anim/select` 繧帝撼蜷梧悄縺ｧ蜻ｼ縺ｳ蜃ｺ縺励∪縺吶・

- 逶ｮ逧・ 霑比ｿ｡逕滓・LLM縺ｨ縺ｯ蛻･縺ｫ縲ゝTS蜀咲函荳ｭ縺ｫ Live2D 縺ｮ `expression` 縺ｨ `motion` 繧帝∈縺ｶ
- 邨ゆｺ・ `tts_queue` 縺ｮ譛蠕後・髻ｳ螢ｰ縺檎ｵゅｏ縺｣縺溘ち繧､繝溘Φ繧ｰ縺ｧ縲～reset_after_tts=true` 縺ｮ蝣ｴ蜷・`exp_01` 縺ｨ `IDLE_DEFAULT` 縺ｫ蠕ｩ蟶ｰ

邁｡譏薙ユ繧ｹ繝・

- `/console` 縺ｧ `Test /anim/select` 繧呈款縺呻ｼ・PI繧ｭ繝ｼ譛ｪ險ｭ螳壹・蝣ｴ蜷医・螳牙・縺ｪ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯJSON・・
- `/stage` 縺ｮ繝悶Λ繧ｦ繧ｶDevTools console 縺ｫ `anim/select request/response` 縺ｨ `anim/reset` 繝ｭ繧ｰ縺悟・繧・

## 2) 繧ｵ繝ｼ繝千｢ｺ隱・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/state
Invoke-RestMethod http://127.0.0.1:8000/overlay_text
```

### 險域ｸｬ繝ｭ繧ｰ

`data/stream-studio/events.jsonl` 縺ｫ `type=timing` 縺瑚ｿｽ險倥＆繧後∪縺呻ｼ亥酔荳 `request_id` 縺ｧ逶ｸ髢｢・峨・
繝悶Λ繧ｦ繧ｶ console 縺ｫ縺ｯ `[aituber/perf]` 縺悟・縺ｾ縺吶・

## 3) RAG・・hort/Long・峨ｒ謚募・・・ebUI 繧ゅ＠縺上・ API・・

WebUI・・/console`・峨・ RAG 繧ｻ繧ｯ繧ｷ繝ｧ繝ｳ縺九ｉ霑ｽ蜉/蜑企勁縺ｧ縺阪∪縺吶・

API萓具ｼ・hort RAG・・

```powershell
$body = @{ rag_type = "short"; title = "persona"; text = "縺ゅ↑縺溘・關ｽ縺｡逹縺・◆蜿｣隱ｿ縺ｮ驟堺ｿ｡閠・I縲・ } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/rag/add -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:8000/rag/list?type=short"
```

API萓具ｼ・ong RAG・・

```powershell
$body = @{ rag_type = "long"; title = "world"; text = "縺薙・驟堺ｿ｡縺ｯ窶ｦ" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/rag/add -ContentType application/json -Body $body
Invoke-RestMethod "http://127.0.0.1:8000/rag/list?type=long"
```

譌ｧ: `/rag/long_term/upsert` 縺ｯ莠呈鋤逶ｮ逧・〒谿九＠縺ｦ縺・∪縺吶′縲仝ebUI驕狗畑縺ｯ `/rag/add` 繧呈耳螂ｨ縺励∪縺吶・

## 4) VLM・医せ繧ｯ繧ｷ繝ｧ/逕ｻ蜒擾ｼ・

### 4.1 逕ｻ蜒上ヱ繧ｹ謖・ｮ壹〒隕∫ｴ・ｼ医ユ繧ｹ繝育畑・・

```powershell
$body = @{ path = "tests/image_test.jpg" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/vlm/summary_from_path -ContentType application/json -Body $body
```

### 4.2 繧ｹ繧ｯ繧ｷ繝ｧ蜿門ｾ冷・隕∫ｴ・

```powershell
Invoke-RestMethod -Method Post http://127.0.0.1:8000/vlm/capture
Invoke-RestMethod http://127.0.0.1:8000/vlm/summary
```

## 5) 繝・Δ・医せ繧ｿ繝門・蜉帚・謇ｿ隱坂・OBS/TTS/Live2D・・

```powershell
.\scripts\demo_stub.ps1
```

## 5.1) API逍朱壹せ繝｢繝ｼ繧ｯ・医ユ繧ｭ繧ｹ繝・+ 逕ｻ蜒・+ 髻ｳ螢ｰ + API蠢懃ｭ費ｼ・

`/health` 竊抵ｼ井ｻｻ諢擾ｼ臥判蜒剰ｦ∫ｴ・竊・`/events` 竊・`/manager/approve` 繧偵∪縺ｨ繧√※遒ｺ隱阪＠縺ｾ縺吶・

```powershell
.\scripts\smoke_api.ps1 -IncludeVlm -ImagePath "tests/image_test.jpg"
```

逕滓・迚ｩ・・itignore蟇ｾ雎｡・・
- `data/stream-studio/events.jsonl`
- `data/stream-studio/manager/pending.json`
- `data/stream-studio/state.json`
- `data/stream-studio/obs/overlay.txt`
- `data/stream-studio/audio/*.wav`

## 6) VTube Studio 繝帙ャ繝医く繝ｼ險ｭ螳・

1. VTube Studio 蛛ｴ縺ｧ API 繧呈怏蜉ｹ蛹悶＠縲√ヨ繝ｼ繧ｯ繝ｳ繧堤匱陦・
2. `.env` 縺ｮ `AITUBER_VTUBE_AUTH_TOKEN` 縺ｫ險ｭ螳・
3. Hotkey荳隕ｧ繧貞叙蠕暦ｼ域磁邯夂｢ｺ隱搾ｼ・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/live2d/hotkeys
```

4. `config/stream-studio/live2d_hotkeys.yaml` 縺ｮ蜷・ち繧ｰ縺ｫ hotkeyID 繧定ｲｼ繧贋ｻ倥￠

## 7) 繝医Λ繝悶Ν繧ｷ繝･繝ｼ繝・

- `Import could not be resolved` 縺栗DE縺ｫ蜃ｺ繧・
	- `.venv` 縺ｫ萓晏ｭ倥′蜈･縺｣縺ｦ縺・↑縺・庄閭ｽ諤ｧ縲Ａrun_dev.ps1` 繧貞・螳溯｡・
- Gemini縺御ｽｿ縺医↑縺・
	- `AITUBER_GEMINI_API_KEY` 譛ｪ險ｭ螳壹□縺ｨ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ縺ｧ蜍輔￥
	- `ClientError: 429 RESOURCE_EXHAUSTED` 縺ｯ Gemini API 縺ｮ繧ｯ繧ｩ繝ｼ繧ｿ雜・℃・郁ｪｲ驥・荳企剞/繝ｬ繝ｼ繝茨ｼ峨↑縺ｮ縺ｧ縲√く繝ｼ蛛ｴ縺ｮ險ｭ螳壹′蠢・ｦ・
- VLM 縺・`(vlm not configured: skipped)` 縺ｫ縺ｪ繧・
	- `AITUBER_GEMINI_API_KEY` 繧定ｨｭ螳壹＠縺ｦ蜀榊ｮ溯｡・
- 髻ｳ螢ｰ縺悟・縺ｪ縺・ｼ・oogle TTS・・
	- `http://127.0.0.1:8000/tts/health` 縺・`ok: True` 縺狗｢ｺ隱搾ｼ郁ｪ崎ｨｼ/讓ｩ髯撰ｼ・
	- `GOOGLE_APPLICATION_CREDENTIALS` 縺瑚ｨｭ螳壹＆繧後※縺・ｋ縺・
	- `AITUBER_TTS_VOICE` 繧堤｢ｺ隱搾ｼ井ｾ・ `ja-JP-Neural2-B`・・
- VTube Studio 縺悟､ｱ謨励☆繧・
	- token/hotkeyID譛ｪ險ｭ螳壹□縺ｨ繧ｹ繧ｭ繝・・縺励※繝ｭ繧ｰ縺ｫ谿九☆

### 蜿り・ 迴ｾ蝨ｨ縺ｮ逍朱夂憾諷具ｼ育ｧ伜ｯ・・蜃ｺ縺輔↑縺・ｼ・

```powershell
Invoke-RestMethod http://127.0.0.1:8000/diagnostics
```
