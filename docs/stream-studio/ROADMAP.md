# ROADMAP (AITuber: YouTube繝ｩ繧､繝夜・菫｡蜷代￠AI繧｢繧ｷ繧ｹ繧ｿ繝ｳ繝・

縺薙・繝ｪ繝昴ず繝医Μ縺ｯ縲碁・菫｡縺ｮ荳ｻ蠖ｹAI縲阪ｒ譛蟆乗ｧ区・縺九ｉ谿ｵ髫守噪縺ｫ閧ｲ縺ｦ繧九◆繧√・蝓ｺ逶､縺ｧ縺吶・
譁ｹ驥昴→縺励※ **BizHawk/繧ｨ繝溘Η髢｢騾｣繝ｻRL/閾ｪ蜍輔・繝ｬ繧､繝ｻ繝・Ξ繝｡繝医Μ** 縺ｯ謇ｱ縺・∪縺帙ｓ・磯℃蜴ｻ縺ｮ谿矩ｪｸ縺ｯ蜑企勁/謨ｴ逅・ｯｾ雎｡・峨・

---

## 0. 迴ｾ迥ｶ隱ｿ譟ｻ縺ｾ縺ｨ繧・ｼ・025-12-31 譎らせ・・

- 笨・Web UI・・stage, /console・牙ｮ溯｣・ｮ御ｺ・ｼ・025-12-31・・
  - 繝悶Λ繧ｦ繧ｶ縺九ｉ繧ｫ繝｡繝ｩ驕ｸ謚樞・ `/vlm/frame` 縺ｧ隕∫ｴ・・遏ｭ譛欒AG縺ｸ謚募・
  - STT・・one/webspeech・俄・ `/stt/text` 竊・譌｢蟄倥・謇ｿ隱阪ヵ繝ｭ繝ｼ・・ending.json・峨∈邨ｱ蜷・
  - Stage 縺ｯ `/overlay_text` 縺ｨ `tts_latest.wav` 縺ｧ蟄怜ｹ・髻ｳ螢ｰ蜀咲函

### 0.1 迴ｾ蝨ｨ縺ｮ讒区・・域里縺ｫ縺ゅｋ繧ゅ・・・

- 螳溯｡後お繝ｳ繝医Μ: `scripts/run_assistant.py`
  - 1陦悟・蜉・竊・`apps/orchestrator/pipeline.py` 繧・蝗槫ｮ溯｡・
- 險ｭ螳・ `apps/core/config.py`・・.env` / 迺ｰ蠅・､画焚・・
- 繝・・繧ｿ蝙・ `apps/core/types.py`・・DirectorOutput` / `ReplyTo`・・
- LLM: `apps/llm/director.py` 縺ｯ **繧ｹ繧ｿ繝厄ｼ域ｱｺ螳夊ｫ厄ｼ・*
- Safety: `apps/orchestrator/safety.py` 縺ｯ **NG繝ｯ繝ｼ繝臥ｽｮ謠・*
- TTS: `apps/tts/engine.py` 縺ｯ **辟｡髻ｳWAV逕滓・繧ｹ繧ｿ繝・*
- Live2D/VTube Studio: `apps/live2d/vtube_studio.py` 縺ｯ **騾∽ｿ｡繝ｭ繧ｰ縺ｮ繧ｹ繧ｿ繝・*
- 繝ｭ繧ｰ/謌先棡迚ｩ: `logs/<run_id>/director.json`, `result.json`, `tts.wav`
- 繝峨く繝･繝｡繝ｳ繝・ `docs/stream-studio/overview.md`, `docs/stream-studio/runbook.md`, `docs/stream-studio/schemas.md`

### 0.2 譁ｹ驥昴↓蜿阪☆繧九梧ｮ矩ｪｸ縲榊呵｣懊→謇ｱ縺・

- `.gitignore` 縺ｫ莉･荳九′谿九▲縺ｦ縺・ｋ・育樟迥ｶ繝ｯ繝ｼ繧ｯ繝・Μ繝ｼ縺ｫ縺ｯ `adapters/` 繧・ROM 髢｢騾｣繝輔か繝ｫ繝縺ｯ隕句ｽ薙◆繧峨↑縺・ｼ・
  - `/adapters/*`・育音縺ｫ `/adapters/bizhawk/...`・・
  - `/roms/` 縺ｨ螟壽焚縺ｮ ROM 諡｡蠑ｵ蟄・
- 謇ｱ縺・ｼ医Ο繝ｼ繝峨・繝・・縺ｧ縺ｮ譁ｹ驥晢ｼ・
  - **蜑企勁蟇ｾ雎｡**: `adapters/`繝ｻROM/繧ｨ繝溘Η髢｢騾｣縺ｮ雉・肇繝ｻ繝峨く繝･繝｡繝ｳ繝医・險ｭ螳夲ｼ亥ｭ伜惠縺吶ｋ蝣ｴ蜷茨ｼ・
  - **遘ｻ陦悟ｯｾ雎｡**: 繧ゅ＠縲碁・菫｡繝ｭ繧ｰ縲阪ｄ縲後ョ繝ｼ繧ｿ菫晏ｭ倥阪・縺溘ａ縺ｫ `adapters/data/` 繧剃ｽｿ縺｣縺ｦ縺・◆縺ｪ繧峨・・菫｡AI縺ｮ `logs/` 縺ｨ髟ｷ譛溯ｨ俶・繧ｹ繝医い・・AG・峨↓邨ｱ蜷・
  - **README 縺ｨ縺ｮ謨ｴ蜷・*: `README.md` 縺ｯ縺吶〒縺ｫ縲後ご繝ｼ繝/繧ｨ繝溘Η遲峨・謇ｱ繧上↑縺・肴婿驥昴〒謨ｴ蜷医＠縺ｦ縺・ｋ縺溘ａ縲∝ｿ・ｦ√↑繧牙ｰ・擂縲軍AG/VLM/OBS/Manager縲阪ｒ霑ｽ險倥☆繧具ｼ医％縺ｮ繝ｭ繝ｼ繝峨・繝・・縺ｧ TODO 譏手ｨ假ｼ・

---

## A. 繧ｴ繝ｼ繝ｫ・亥ｮ梧・・晞・菫｡縺ｫ蠢・ｦ√↑譛蟆剰ｦ∽ｻｶ・・

縲碁・菫｡縺ｮ荳ｻ蠖ｹAI縲阪→縺励※莉･荳九′ **螳牙ｮ夂ｨｼ蜒・* 縺励・°逕ｨ閠・ｼ郁｣乗婿・峨′蛻ｶ蠕｡縺ｧ縺阪ｋ迥ｶ諷九ｒ螳梧・縺ｨ縺吶ｋ縲・

- 蜈･蜉・ 驟堺ｿ｡荳ｭ縺ｮ繧､繝吶Φ繝・繧ｳ繝｡繝ｳ繝茨ｼ域怙蛻昴・謇句・蜉帙〒OK・・
- LLM: Gemini API 繧剃ｽｿ縺・・*讒矩蛹褒SON** 繧定ｿ斐☆・医せ繧ｭ繝ｼ繝槭〒讀懆ｨｼ・・
- RAG・井ｺ悟ｱ､・・
  - 遏ｭ譛・ 驟堺ｿ｡荳ｭ繝ｭ繧ｰ・育峩霑代さ繝ｳ繝・く繧ｹ繝茨ｼ・
  - 髟ｷ譛・ 繧ｭ繝｣繝ｩ險ｭ螳・蜿ｰ譛ｬ/驕主悉繝ｭ繧ｰ・医Ο繝ｼ繧ｫ繝ｫ螳檎ｵ撰ｼ・
- VLM: 繧ｹ繧ｯ繝ｪ繝ｼ繝ｳ繧ｷ繝ｧ繝・ヨ・医∪縺溘・繧ｫ繝｡繝ｩ・俄・隕∫ｴ・ユ繧ｭ繧ｹ繝亥喧竊坦AG/LLM縺ｫ萓帷ｵｦ・域怙蛻昴・繧ｹ繧ｯ繧ｷ繝ｧ謇句虚縺ｧ繧ょ庄・・
- TTS: 譁・ｫ竊帝浹螢ｰ繝輔ぃ繧､繝ｫ逕滓・・・oogle Cloud TTS 繧呈Φ螳壹√∪縺夂函謌舌∪縺ｧ・・
- Live2D: VTube Studio API・・ebSocket・峨〒 **繝帙ャ繝医く繝ｼ/陦ｨ諠・* 繧堤匱轣ｫ
- OBS: **OBS縺瑚ｪｭ繧繝・く繧ｹ繝医ヵ繧｡繧､繝ｫ** 繧呈峩譁ｰ縺励※繝・Ο繝・・繧貞・縺呻ｼ・bs-websocket 縺ｯ莉ｻ諢擾ｼ・
- Manager・郁｣乗婿謇ｿ隱搾ｼ・
  - LLM蜃ｺ蜉帙ｒ縺昴・縺ｾ縺ｾ驟堺ｿ｡縺ｫ豬√＆縺壹・*謇ｿ隱・菫ｮ豁｣/蜊ｴ荳・*縺ｧ縺阪ｋ
- Logging: 繝医Ξ繝ｼ繧ｹ蜿ｯ閭ｽ縺ｪ繧､繝吶Φ繝医Ο繧ｰ・・SONL・峨→PII驟肴・

螳梧・譚｡莉ｶ・域怙菴弱Λ繧､繝ｳ・・
- 1繧､繝吶Φ繝亥・蜉帚・・・AG/VLM莉ｻ諢擾ｼ俄・LLM讒矩蛹門・蜉帚・Manager謇ｿ隱坂・TTS髻ｳ螢ｰ逕滓・竊丹BS繝・く繧ｹ繝域峩譁ｰ竊歎Tube Studio繧｢繧ｯ繧ｷ繝ｧ繝ｳ騾∽ｿ｡竊貞・繝ｭ繧ｰ菫晏ｭ・

---

## B. 繧｢繝ｼ繧ｭ繝・け繝√Ε讎ょｿｵ蝗ｳ・医ョ繝ｼ繧ｿ繝輔Ο繝ｼ / 繝｢繧ｸ繝･繝ｼ繝ｫ蠅・阜・・

```mermaid
flowchart LR
  subgraph Inputs[Inputs]
    CHAT[Chat/繧ｳ繝｡繝ｳ繝・ --> EVT[Event Builder]
    SCREEN[Screen/Camera Capture] --> VLM[VLM Summarizer]
  end

  subgraph Memory[RAG / Memory]
    ST[遏ｭ譛溘Γ繝｢繝ｪ: stream log]:::store
    LT[髟ｷ譛溘Γ繝｢繝ｪ: persona/script/past logs]:::store
    RET[Retriever]:::svc
    ST --> RET
    LT --> RET
  end

  subgraph Core[Core]
    LOG[Event Logger (JSONL)]:::svc
    CFG[Config/.env]:::svc
    SAFE[Safety Filter]:::svc
  end

  subgraph Brain[LLM]
    LLM[Gemini Client]:::svc
    PARSE[Structured Output Validator]:::svc
  end

  subgraph Manager[Manager Approval]
    QUEUE[Pending Queue]:::store
    UI[Manager UI/CLI]:::svc
  end

  subgraph Outputs[Outputs]
    TTS[TTS (wav generation)]:::svc
    OBS[OBS Text File Writer]:::svc
    VTS[VTube Studio WS Client]:::svc
  end

  EVT --> LOG
  VLM --> LOG

  EVT --> RET
  VLM --> RET
  RET --> LLM

  LLM --> PARSE --> SAFE --> QUEUE --> UI
  UI -->|approved| TTS --> OBS
  UI -->|approved| VTS
  UI --> LOG

  classDef svc fill:#eef,stroke:#88a;
  classDef store fill:#efe,stroke:#8a8;
```

繝｢繧ｸ繝･繝ｼ繝ｫ蠅・阜縺ｮ閠・∴譁ｹ
- `Inputs` 縺ｯ縲檎函繝・・繧ｿ竊呈ｭ｣隕丞喧繧､繝吶Φ繝医阪∪縺ｧ繧定ｲｬ蜍吶↓縺吶ｋ
- `LLM` 縺ｯ縲梧耳隲・+ 讒矩蛹門・蜉幢ｼ域､懆ｨｼ・峨阪∪縺ｧ縲・・菫｡蜿肴丐縺ｯ縺励↑縺・
- `Manager` 縺・**驟堺ｿ｡蜿肴丐縺ｮ繧ｲ繝ｼ繝・*・井ｺｺ髢薙′豁｢繧√ｉ繧後ｋ・・
- `Outputs` 縺ｯ蜑ｯ菴懃畑・磯浹螢ｰ/繝・Ο繝・・/繝｢繝ｼ繧ｷ繝ｧ繝ｳ・峨ｒ諡・ｽ・

---

## C. 繝｢繧ｸ繝･繝ｼ繝ｫ荳隕ｧ縺ｨ雋ｬ蜍・

> 譌｢蟄・`apps/*` 縺ｯ鬪ｨ邨・∩縺ｨ縺励※豢ｻ縺九＠縲∝ｿ・ｦ√↓蠢懊§縺ｦ譁ｰ隕上ヱ繝・こ繝ｼ繧ｸ繧定ｶｳ縺吶・

### Inputs
- 蠖ｹ蜑ｲ: 驟堺ｿ｡蜈･蜉幢ｼ医さ繝｡繝ｳ繝医・・菫｡繧､繝吶Φ繝医∵桃菴懶ｼ峨ｒ `Event` 縺ｫ邨ｱ荳
- MVP
  - CLI蜈･蜉幢ｼ育樟迥ｶ・・
  - ・井ｻｻ諢擾ｼ臥ｰ｡譏薙ヵ繧｡繧､繝ｫ蜈･蜉幢ｼ・SONL霑ｽ險假ｼ・

### LLM
- 蠖ｹ蜑ｲ: Gemini API 蜻ｼ縺ｳ蜃ｺ縺励∵ｧ矩蛹門・蜉幢ｼ・SON・臥函謌・
- 隕∽ｻｶ
  - 蜃ｺ蜉帙ｒ **JSON繧ｹ繧ｭ繝ｼ繝槭〒讀懆ｨｼ**・・ydantic・・
  - 螟ｱ謨玲凾繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ・亥ｮ牙・縺ｪ遏ｭ譁・辟｡險・・

### RAG・育洒譛・髟ｷ譛滂ｼ・
- 遏ｭ譛・ 逶ｴ霑代・驟堺ｿ｡繝ｭ繧ｰ繝ｻVLM隕∫ｴ・・逶ｴ霑代・謇ｿ隱肴ｸ医∩逋ｺ隧ｱ
- 髟ｷ譛・ persona/蜿ｰ譛ｬ/驕主悉繝ｭ繧ｰ/FAQ
- MVP譁ｹ驥・
  - 譛蛻昴・ **繝ｭ繝ｼ繧ｫ繝ｫ螳檎ｵ・*
  - 繝吶け繝医ΝDB・・hroma縺ｪ縺ｩ・・or 縺ｾ縺壹・霆ｽ驥上↑BM25/繧ｭ繝ｼ繝ｯ繝ｼ繝画､懃ｴ｢縺ｧ繧ょ庄

### VLM・育判髱｢/繧ｫ繝｡繝ｩ隕∫ｴ・ｼ・
- 蠖ｹ蜑ｲ: 繧ｹ繧ｯ繧ｷ繝ｧ/繝輔Ξ繝ｼ繝竊定ｦ∫ｴ・ユ繧ｭ繧ｹ繝遺・RAG/LLM縺ｫ萓帷ｵｦ
- MVP
  - 縲後せ繧ｯ繧ｷ繝ｧ繧剃ｿ晏ｭ倪・隕∫ｴ・ユ繧ｭ繧ｹ繝育函謌舌・
  - 繧ｭ繝｣繝励メ繝｣縺ｯ謇句虚縺ｧ繧ゅｈ縺・ｼ亥ｾ後〒閾ｪ蜍募喧・・

### TTS
- 蠖ｹ蜑ｲ: 繝・く繧ｹ繝遺・髻ｳ螢ｰ繝輔ぃ繧､繝ｫ逕滓・・・av/mp3・・
- MVP
  - Google Cloud TTS・育┌譁呎棧諠ｳ螳夲ｼ・
  - 螟ｱ謨玲凾縺ｯ辟｡髻ｳ/繧ｹ繧ｭ繝・・・磯・菫｡縺梧ｭ｢縺ｾ繧峨↑縺・ｼ・

### Live2D・・Tube Studio・・
- 蠖ｹ蜑ｲ: `motion_tags` 繧・VTube Studio API 縺ｮ繧｢繧ｯ繧ｷ繝ｧ繝ｳ縺ｫ螟画鋤縺励※騾∽ｿ｡
- MVP
  - WebSocket 謗･邯・
  - HotkeyTrigger・医∪縺溘・ Expression・峨ｒ騾√ｌ繧・
  - 螟ｱ謨玲凾縺ｯ繝ｭ繧ｰ縺ｮ縺ｿ・磯・菫｡邯咏ｶ夲ｼ・

### OBS
- 蠖ｹ蜑ｲ: 繝・Ο繝・・縺ｮ縺溘ａ縺ｮ繝・く繧ｹ繝医ヵ繧｡繧､繝ｫ譖ｴ譁ｰ
- MVP
  - `obs/now_playing.txt` 遲峨ｒ荳頑嶌縺・
  - 謾ｹ陦・髟ｷ縺募宛髯舌∝些髯ｺ譁・ｭ励・髯､蜴ｻ

### Manager・郁｣乗婿謇ｿ隱搾ｼ・
- 蠖ｹ蜑ｲ: LLM縺ｮ蜃ｺ蜉帙ｒ **謇ｿ隱・菫ｮ豁｣/蜊ｴ荳・* 縺励※蛻昴ａ縺ｦ Outputs 縺ｫ豬√☆
- MVP譯・
  - CLI: `approve? (y/n/edit)`
  - 繝輔ぃ繧､繝ｫ繧ｭ繝･繝ｼ: `logs/<run_id>/pending.json` 竊・`approved.json`
  - 蟆・擂: 繝ｭ繝ｼ繧ｫ繝ｫWeb UI・井ｻｻ諢擾ｼ・

### Logging
- 蠖ｹ蜑ｲ: 蜀咲樟諤ｧ縺ｮ縺ゅｋ繧､繝吶Φ繝医Ο繧ｰ縲√さ繧ｹ繝・繝ｬ繝ｼ繝亥宛蠕｡縺ｮ隕ｳ貂ｬ
- 隕∽ｻｶ
  - JSONL・・陦・繧､繝吶Φ繝茨ｼ・
  - PII/繧ｭ繝ｼ縺ｮ繝槭せ繧ｭ繝ｳ繧ｰ

---

## D. 荳ｻ隕√ョ繝ｼ繧ｿ螂醍ｴ・ｼ・SON繧ｹ繧ｭ繝ｼ繝・/ 繝ｭ繧ｰ蠖｢蠑・/ RAG謚募・蠖｢蠑擾ｼ・

### D1. LLM 讒矩蛹門・蜉幢ｼ・irectorOutput・・

- 譌｢蟄・ `apps/core/types.py` 縺ｮ `DirectorOutput` 繧偵・繝ｼ繧ｹ縺ｫ諡｡蠑ｵ縺吶ｋ
- 霑ｽ蜉謗ｨ螂ｨ繝輔ぅ繝ｼ繝ｫ繝会ｼ亥ｰ・擂・・
  - `obs_text`・医ユ繝ｭ繝・・逕ｨ縺ｫ遏ｭ縺乗紛蠖｢貂医∩・・
  - `speak_style`・磯溷ｺｦ/謚第恕縺ｪ縺ｩ TTS 險ｭ螳壹ヲ繝ｳ繝茨ｼ・
  - `safety`・郁・蟾ｱ逕ｳ蜻翫・蜊ｱ髯ｺ蠎ｦ縲∵ｹ諡・・

JSON Schema・育岼螳会ｼ・
```json
{
  "type": "object",
  "required": ["text", "emotion", "motion_tags", "reply_to"],
  "properties": {
    "text": {"type": "string", "minLength": 1, "maxLength": 400},
    "emotion": {"type": "string", "enum": ["neutral","happy","angry","sad","surprised","smug","panic"]},
    "motion_tags": {"type": "array", "items": {"type": "string"}, "maxItems": 8},
    "reply_to": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": {"type": "string", "enum": ["chat","system","manager"]},
        "id": {"type": ["string","null"]}
      }
    },
    "debug": {
      "type": "object",
      "properties": {
        "reason": {"type": ["string","null"]}
      }
    }
  }
}
```

### D2. 繧､繝吶Φ繝医Ο繧ｰ蠖｢蠑擾ｼ・SONL・・

1陦・繧､繝吶Φ繝茨ｼ井ｾ・ `logs/<run_id>/events.jsonl`・・

```json
{
  "ts": "2025-12-31T12:34:56.789Z",
  "run_id": "20251231_123456",
  "source": "chat|system|manager|vlm|rag|llm|tts|obs|live2d",
  "type": "input|decision|artifact|error|metric",
  "message": "human readable short message",
  "payload": {"any": "json"},
  "pii": {"contains_pii": false, "redacted": true}
}
```

### D3. RAG 謚募・蠖｢蠑擾ｼ育洒譛・髟ｷ譛溷・騾壹・ Document・・

- 逶ｮ逧・ 縲後＞縺､繝ｻ縺ｩ縺薙°繧峨・菴輔ｒ縲榊・繧後◆縺九ｒ霑ｽ霍｡縺ｧ縺阪ｋ

```json
{
  "doc_id": "string",
  "layer": "short_term|long_term",
  "source": "chat|system|vlm|script|persona|log",
  "created_at": "2025-12-31T12:34:56Z",
  "text": "indexable plain text",
  "metadata": {
    "tags": ["string"],
    "language": "ja",
    "url": null,
    "chunk": {"index": 0, "total": 3}
  }
}
```

---

## E. 谿ｵ髫守噪繝槭う繝ｫ繧ｹ繝医・繝ｳ・・VP 竊・Beta 竊・驕狗畑蠑ｷ蛹厄ｼ・

### Milestone 1: MVP・医∪縺夐・菫｡縺ｧ蝗槭ｋ譛蟆擾ｼ・

螳御ｺ・擅莉ｶ
- Gemini API 縺ｧ `DirectorOutput` 繧・**讒矩蛹褒SON** 縺ｨ縺励※霑斐○繧・
- `SafetyFilter` 縺ｧ譛菴朱剞縺ｮ繝悶Ο繝・け縺後〒縺阪ｋ
- Manager 謇ｿ隱搾ｼ・LI or 繝輔ぃ繧､繝ｫ繧ｭ繝･繝ｼ・峨〒驟堺ｿ｡蜿肴丐繧貞宛蠕｡縺ｧ縺阪ｋ
- TTS 縺碁浹螢ｰ繝輔ぃ繧､繝ｫ繧堤函謌撰ｼ・oogle Cloud TTS・・
- OBS 繝・Ο繝・・縺後ユ繧ｭ繧ｹ繝医ヵ繧｡繧､繝ｫ縺ｧ譖ｴ譁ｰ縺輔ｌ繧・
- VTube Studio 縺ｫ繝帙ャ繝医く繝ｼ縺碁√ｌ繧具ｼ・S螳溯｣・ｼ・
- JSONL繝ｭ繧ｰ縺梧ｮ九ｊ縲・囿螳ｳ譎ゅ↓關ｽ縺｡縺壹↓繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ縺吶ｋ

TODO・亥ｮ溯｣・ち繧ｹ繧ｯ萓具ｼ・
- `apps/llm` 繧・stub竊竪emini 螳溯｣・ｼ育┌譁呎棧繧貞燕謠舌↓譛蟆上Μ繧ｯ繧ｨ繧ｹ繝茨ｼ・
- `apps/tts` 繧・stub竊竪oogle Cloud TTS 螳溯｣・
- `apps/live2d` 繧・stub竊歎Tube Studio WebSocket 螳溯｣・
- `apps/obs`・域眠隕擾ｼ・ text file writer
- `apps/manager`・域眠隕擾ｼ・ approve gate
- `.gitignore` 谿矩ｪｸ謨ｴ逅・ｼ・adapters/` 繧・ROM 繝ｫ繝ｼ繝ｫ縺ｮ蜑企勁/隕狗峩縺暦ｼ・

### Milestone 2: Beta・・AG + VLM 繧貞・繧後※窶懆ｳ｢縺鞘昴☆繧具ｼ・

螳御ｺ・擅莉ｶ
- 遏ｭ譛溘Γ繝｢繝ｪ・磯・菫｡繝ｭ繧ｰ・峨〒逶ｴ霑第枚閼医ｒ蜿悶ｊ霎ｼ繧√ｋ
- 髟ｷ譛溘Γ繝｢繝ｪ・・ersona/蜿ｰ譛ｬ/驕主悉繝ｭ繧ｰ・峨ｒ蜿悶ｊ霎ｼ縺ｿ縲∵､懃ｴ｢竊鱈LM縺ｫ豕ｨ蜈･縺ｧ縺阪ｋ
- VLM・医せ繧ｯ繧ｷ繝ｧ竊定ｦ∫ｴ・ユ繧ｭ繧ｹ繝茨ｼ峨′蜍輔″縲∫洒譛溘Γ繝｢繝ｪ縺ｫ霑ｽ險倥＆繧後ｋ
- Manager UI 縺碁°逕ｨ縺励ｄ縺吶＞・域怙菴朱剞縺ｮ螻･豁ｴ/蟾ｮ蛻・｡ｨ遉ｺ・・

TODO
- `apps/rag`・域眠隕擾ｼ・ retriever + store・医∪縺壹・繝ｭ繝ｼ繧ｫ繝ｫ・・
- `apps/vlm`・域眠隕擾ｼ・ screenshot summarize
- `apps/inputs`・域眠隕擾ｼ・ chat/system/vlm 縺ｮ邨ｱ荳繧､繝吶Φ繝・

### Milestone 3: 驕狗畑蠑ｷ蛹厄ｼ亥ｮ牙ｮ壹・繧ｳ繧ｹ繝医・螳牙・・・

螳御ｺ・擅莉ｶ
- 繝ｬ繝ｼ繝亥宛髯舌・繧ｭ繝｣繝・す繝･繝ｻ繝舌ャ繧ｯ繧ｪ繝輔′荳騾壹ｊ謠・＞縲∫┌譁呎棧繧定ｶ・∴縺ｫ縺上＞
- PII/遘伜諺諠・ｱ縺後Ο繧ｰ縺ｫ蜃ｺ縺ｪ縺・ｼ医・繧ｹ繧ｭ繝ｳ繧ｰ繝ｻ菫晄戟譛滄俣縺ｮ譏守｢ｺ蛹厄ｼ・
- 逶｣隕悶＠繧・☆縺・Γ繝医Μ繧ｯ繧ｹ・井ｻｶ謨ｰ/螟ｱ謨・繧ｳ繧ｹ繝域ｦらｮ暦ｼ峨′蜿悶ｌ繧・
- 髫懷ｮｳ譎ゅ・繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ・・LM/TTS/VTS/OBS・峨′邨ｱ荳縺輔ｌ縺滓嫌蜍輔↓縺ｪ繧・

---

## F. 辟｡譁呎棧繧呈э隴倥＠縺溘Ξ繝ｼ繝亥宛髯舌・繧ｭ繝｣繝・す繝･繝ｻ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ

### 譁ｹ驥・
- 逕滓・繧ｳ繧ｹ繝医・鬮倥＞鬆・↓縲悟他縺ｰ縺ｪ縺・ｷ･螟ｫ縲阪ｒ蜈･繧後ｋ
  1) VLM・育判蜒擾ｼ・
  2) LLM・磯聞譁・ｼ・
  3) TTS

### 蜈ｷ菴鍋ｭ・
- 繝ｬ繝ｼ繝亥宛髯・
  - 蜈･蜉帙う繝吶Φ繝医・繝・ヰ繧ｦ繝ｳ繧ｹ・亥酔荳遞ｮ蛻･縺ｯ荳螳夂ｧ偵↓1蝗橸ｼ・
  - VLM縺ｯ縲碁㍾隕√う繝吶Φ繝域凾縺ｮ縺ｿ縲阪梧焔蜍輔ヨ繝ｪ繧ｬ縲阪・縺ｩ縺｡繧峨°縺九ｉ髢句ｧ・
- 繧ｭ繝｣繝・す繝･
  - TTS: 蜷御ｸ繝・く繧ｹ繝遺・蜷御ｸ髻ｳ螢ｰ繧・`apps/tts/cache.py` 縺ｫ菫晏ｭ假ｼ域里縺ｫ蝨溷床縺ゅｊ・・
  - LLM: `user_text + retrieved_context_hash + system_prompt_hash` 繧偵く繝ｼ縺ｫ遏ｭ譛溘く繝｣繝・す繝･
- 繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ
  - LLM螟ｱ謨・ 螳牙・縺ｪ蝗ｺ螳壽枚 + emotion neutral + motion_tags empty
  - TTS螟ｱ謨・ 髻ｳ螢ｰ繧ｹ繧ｭ繝・・・・BS縺縺第峩譁ｰ・・
  - VTube Studio螟ｱ謨・ 繧｢繧ｯ繧ｷ繝ｧ繝ｳ騾∽ｿ｡繧定ｫｦ繧√※繝ｭ繧ｰ縺ｮ縺ｿ
  - OBS螟ｱ謨・ 繝輔ぃ繧､繝ｫ譖ｴ譁ｰ螟ｱ謨励ｒ繝ｭ繧ｰ縺ｫ谿九＠縺ｦ邯咏ｶ・

---

## G. 繧ｻ繧ｭ繝･繝ｪ繝・ぅ・・PI繧ｭ繝ｼ邂｡逅・・env縲√Ο繧ｰ縺ｮPII蟇ｾ遲厄ｼ・

- API繧ｭ繝ｼ
  - `.env` 縺ｯ繧ｳ繝溘ャ繝医＠縺ｪ縺・ｼ育樟迥ｶ `.gitignore` 縺ｧ髯､螟厄ｼ・
  - `.env/.env.main` 縺ｫ蠢・ｦ√↑繧ｭ繝ｼ繧偵∪縺ｨ繧√ｋ・医Ο繝ｼ繧ｫ繝ｫ逕ｨ繝ｻGit邂｡逅・＠縺ｪ縺・ｼ・
  - 蜿ｯ閭ｽ縺ｪ繧・OS 縺ｮ遘伜ｯ・ュ蝣ｱ繧ｹ繝医い・・indows Credential Manager 遲会ｼ峨↓蟇・○繧具ｼ亥ｰ・擂・・

- 繝ｭ繧ｰ
  - PII・亥倶ｺｺ蜷・ID/逕溘・繝√Ε繝・ヨ繝ｭ繧ｰ・峨・蝓ｺ譛ｬ逧・↓ **繝槭せ繧ｭ繝ｳ繧ｰ**
  - 菫晏ｭ俶悄髢薙ｒ豎ｺ繧√ｋ・井ｾ・ `logs/` 繧剃ｸ螳壽悄髢薙〒繝ｭ繝ｼ繝・・繧ｷ繝ｧ繝ｳ・・

- 謇ｿ隱阪ヵ繝ｭ繝ｼ
  - Manager 縺梧怙邨ょ・蜉帙ｒ遒ｺ螳壹☆繧具ｼ・LM蜃ｺ蜉帙ｒ逶ｴ騾√＠縺ｪ縺・ｼ・
  - NG繝ｯ繝ｼ繝・遖∵ｭ｢隧ｱ鬘後ｒ `AITUBER_NG_WORDS` 縺ｧ驕狗畑蜿ｯ閭ｽ縺ｫ縺吶ｋ・域里蟄假ｼ・

---

## H. Runbook・医Ο繝ｼ繧ｫ繝ｫ襍ｷ蜍輔∝ｿ・ｦ∫腸蠅・√ヨ繝ｩ繝悶Ν繧ｷ繝･繝ｼ繝茨ｼ・

### 繝ｭ繝ｼ繧ｫ繝ｫ襍ｷ蜍包ｼ育樟迥ｶ縺ｮ譛蟆擾ｼ・

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -r requirements.txt
・井ｾ具ｼ荏.env/.env.main` 繧剃ｽ懊▲縺ｦ蛟､繧貞・繧後ｋ
.\.venv\Scripts\python scripts/run_assistant.py
```

### 蠢・ｦ∫腸蠅・ｼ・VP 莉･髯搾ｼ・
- Python 3.11+
- VTube Studio・郁ｵｷ蜍墓ｸ医∩・・
- Google AI Studio (Gemini) 縺ｮ API Key
- ・・TS蟆主・譎ゑｼ烏oogle Cloud TTS 縺ｮ隱崎ｨｼ・医し繝ｼ繝薙せ繧｢繧ｫ繧ｦ繝ｳ繝・or ADC・・

### 繧医￥縺ゅｋ繝医Λ繝悶Ν
- `VTube Studio 縺ｫ騾√ｌ縺ｪ縺Я
  - WS URL/繝昴・繝医ｒ遒ｺ隱搾ｼ・AITUBER_VTUBE_WS_URL`・・
  - VTube Studio 蛛ｴ縺ｮ API 險ｭ螳・險ｱ蜿ｯ繧堤｢ｺ隱・
- `TTS 縺檎函謌舌＆繧後↑縺Я
  - 隱崎ｨｼ諠・ｱ・育腸蠅・､画焚/ADC・峨ｒ遒ｺ隱・
  - 辟｡譁呎棧繧定ｶ・∴繧九→螟ｱ謨励☆繧句庄閭ｽ諤ｧ縺後≠繧九◆繧√√く繝｣繝・す繝･/遏ｭ譁・喧繧貞━蜈・
- `LLM 縺悟､ｱ謨励☆繧・JSON縺悟｣翫ｌ繧義
  - 讒矩蛹門・蜉帙ｒ譛蜆ｪ蜈茨ｼ・SON-only 縺ｮ繝励Ο繝ｳ繝励ヨ縲｝ydantic讀懆ｨｼ・・
  - 螟ｱ謨玲凾縺ｯ繝輔か繝ｼ繝ｫ繝舌ャ繧ｯ譁・〒驟堺ｿ｡繧呈ｭ｢繧√↑縺・

---

## README 謾ｹ菫ｮ・亥ｰ・擂TODO・・

- `README.md` 縺ｯ迴ｾ迥ｶ縺ｮ鬪ｨ邨・∩隱ｬ譏弱→縺励※縺ｯ蜊∝・縺縺後∽ｻ雁ｾ御ｻ･荳九・霑ｽ險倥′蠢・ｦ√↓縺ｪ繧翫≧繧・
  - RAG・育洒譛・髟ｷ譛滂ｼ牙ｰ主・譁ｹ驥・
  - VLM・医せ繧ｯ繧ｷ繝ｧ隕∫ｴ・ｼ牙ｰ主・譁ｹ驥・
  - OBS 繝・Ο繝・・譖ｴ譁ｰ縺ｮ險ｭ螳夲ｼ医ヵ繧｡繧､繝ｫ繝代せ・・
  - Manager 謇ｿ隱阪ヵ繝ｭ繝ｼ縺ｮ驕狗畑謇矩・
