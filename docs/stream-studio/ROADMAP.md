# ROADMAP (AITuber: YouTubeライブ配信向けAIアシスタント)

このプロジェクトは **ゲーム/エミュ連携を扱いません**。

目的は「配信の主役AI」を、最小構成（MVP）から段階的に実運用へ近づけることです。

---

## 0. 現状（MVP）

- Web UI: `/console` と `/stage`
- LLM: Gemini（固定スキーマ JSON）
- RAG: short-term（events.jsonl）+ long-term（sqlite）
- VLM: スクショ要約（任意）
- TTS: Google Cloud TTS
- Live2D/VTube Studio: ホットキー発火（任意）

- 繝峨く繝・繝。繝ウ繝・ `docs/stream-studio/overview.md`, `docs/stream-studio/runbook.md`, `docs/stream-studio/schemas.md`

### 0.2 譁ケ驥昴↓蜿阪☆繧九€梧ョ矩ェク縲榊€呵」懊→謇ア縺・

- `.gitignore` 縺ォ莉・荳九′谿九▲縺ヲ縺・k・育樟迥カ繝ッ繝シ繧ッ繝・Μ繝シ縺ォ縺ッ `adapters/` 繧・ROM 髢「騾」繝輔か繝ォ繝€縺ッ隕句ス薙◆繧峨↑縺・シ・
  - `/adapters/*`・育音縺ォ `/adapters/bizhawk/...`・・
  - `/roms/` 縺ィ螟壽焚縺ョ ROM 諡。蠑オ蟄・
- 謇ア縺・シ医Ο繝シ繝峨・繝・・縺ァ縺ョ譁ケ驥晢シ・
  - **蜑企勁蟇セ雎。**: `adapters/`繝サROM/繧ィ繝溘Η髢「騾」縺ョ雉・肇繝サ繝峨く繝・繝。繝ウ繝医・險ュ螳夲シ亥ュ伜惠縺吶k蝣エ蜷茨シ・
  - **遘サ陦悟ッセ雎。**: 繧ゅ@縲碁・菫。繝ュ繧ー縲阪d縲後ョ繝シ繧ソ菫晏ュ倥€阪・縺溘a縺ォ `adapters/data/` 繧剃スソ縺」縺ヲ縺・◆縺ェ繧峨€・・菫。AI縺ョ `logs/` 縺ィ髟キ譛溯ィ俶・繧ケ繝医い・・AG・峨↓邨ア蜷・
  - **README 縺ィ縺ョ謨エ蜷・*: `README.md` 縺ッ縺吶〒縺ォ縲後ご繝シ繝/繧ィ繝溘Η遲峨・謇ア繧上↑縺・€肴婿驥昴〒謨エ蜷医@縺ヲ縺・k縺溘a縲∝ソ・ヲ√↑繧牙ー・擂縲軍AG/VLM/OBS/Manager縲阪r霑ス險倥☆繧具シ医%縺ョ繝ュ繝シ繝峨・繝・・縺ァ TODO 譏手ィ假シ・

---

## A. 繧エ繝シ繝ォ・亥ョ梧・・晞・菫。縺ォ蠢・ヲ√↑譛€蟆剰ヲ∽サカ・・

縲碁・菫。縺ョ荳サ蠖ケAI縲阪→縺励※莉・荳九′ **螳牙ョ夂ィシ蜒・* 縺励€・°逕ィ閠・シ郁」乗婿・峨′蛻カ蠕。縺ァ縺阪k迥カ諷九r螳梧・縺ィ縺吶k縲・

- 蜈・蜉・ 驟堺ソ。荳ュ縺ョ繧、繝吶Φ繝・繧ウ繝。繝ウ繝茨シ域怙蛻昴・謇句・蜉帙〒OK・・
- LLM: Gemini API 繧剃スソ縺・€・*讒矩€蛹褒SON** 繧定ソ斐☆・医せ繧ュ繝シ繝槭〒讀懆ィシ・・
- RAG・井コ悟ア、・・
  - 遏ュ譛・ 驟堺ソ。荳ュ繝ュ繧ー・育峩霑代さ繝ウ繝・く繧ケ繝茨シ・
  - 髟キ譛・ 繧ュ繝」繝ゥ險ュ螳・蜿ー譛ャ/驕主悉繝ュ繧ー・医Ο繝シ繧ォ繝ォ螳檎オ撰シ・
- VLM: 繧ケ繧ッ繝ェ繝シ繝ウ繧キ繝ァ繝・ヨ・医∪縺溘・繧ォ繝。繝ゥ・俄・隕∫エ・ユ繧ュ繧ケ繝亥喧竊坦AG/LLM縺ォ萓帷オヲ・域怙蛻昴・繧ケ繧ッ繧キ繝ァ謇句虚縺ァ繧ょ庄・・
- TTS: 譁・ォ竊帝浹螢ー繝輔ぃ繧、繝ォ逕滓・・・oogle Cloud TTS 繧呈Φ螳壹€√∪縺夂函謌舌∪縺ァ・・
- Live2D: VTube Studio API・・ebSocket・峨〒 **繝帙ャ繝医く繝シ/陦ィ諠・* 繧堤匱轣ォ
- OBS: **OBS縺瑚ェュ繧€繝・く繧ケ繝医ヵ繧。繧、繝ォ** 繧呈峩譁ー縺励※繝・Ο繝・・繧貞・縺呻シ・bs-websocket 縺ッ莉サ諢擾シ・
- Manager・郁」乗婿謇ソ隱搾シ・
  - LLM蜃コ蜉帙r縺昴・縺セ縺セ驟堺ソ。縺ォ豬√&縺壹€・*謇ソ隱・菫ョ豁」/蜊エ荳・*縺ァ縺阪k
- Logging: 繝医Ξ繝シ繧ケ蜿ッ閭ス縺ェ繧、繝吶Φ繝医Ο繧ー・・SONL・峨→PII驟肴・

螳梧・譚。莉カ・域怙菴弱Λ繧、繝ウ・・
- 1繧、繝吶Φ繝亥・蜉帚・・・AG/VLM莉サ諢擾シ俄・LLM讒矩€蛹門・蜉帚・Manager謇ソ隱坂・TTS髻ウ螢ー逕滓・竊丹BS繝・く繧ケ繝域峩譁ー竊歎Tube Studio繧「繧ッ繧キ繝ァ繝ウ騾∽ソ。竊貞・繝ュ繧ー菫晏ュ・

---

## B. 繧「繝シ繧ュ繝・け繝√Ε讎ょソオ蝗ウ・医ョ繝シ繧ソ繝輔Ο繝シ / 繝「繧ク繝・繝シ繝ォ蠅・阜・・

```mermaid
flowchart LR
  subgraph Inputs[Inputs]
    CHAT[Chat/繧ウ繝。繝ウ繝・ --> EVT[Event Builder]
    SCREEN[Screen/Camera Capture] --> VLM[VLM Summarizer]
  end

  subgraph Memory[RAG / Memory]
    ST[遏ュ譛溘Γ繝「繝ェ: stream log]:::store
    LT[髟キ譛溘Γ繝「繝ェ: persona/script/past logs]:::store
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

繝「繧ク繝・繝シ繝ォ蠅・阜縺ョ閠・∴譁ケ
- `Inputs` 縺ッ縲檎函繝・・繧ソ竊呈ュ」隕丞喧繧、繝吶Φ繝医€阪∪縺ァ繧定イャ蜍吶↓縺吶k
- `LLM` 縺ッ縲梧耳隲・+ 讒矩€蛹門・蜉幢シ域、懆ィシ・峨€阪∪縺ァ縲・・菫。蜿肴丐縺ッ縺励↑縺・
- `Manager` 縺・**驟堺ソ。蜿肴丐縺ョ繧イ繝シ繝・*・井ココ髢薙′豁「繧√i繧後k・・
- `Outputs` 縺ッ蜑ッ菴懃畑・磯浹螢ー/繝・Ο繝・・/繝「繝シ繧キ繝ァ繝ウ・峨r諡・ス・

---

## C. 繝「繧ク繝・繝シ繝ォ荳€隕ァ縺ィ雋ャ蜍・

> 譌「蟄・`apps/*` 縺ッ鬪ィ邨・∩縺ィ縺励※豢サ縺九@縲∝ソ・ヲ√↓蠢懊§縺ヲ譁ー隕上ヱ繝・こ繝シ繧ク繧定カウ縺吶€・

### Inputs
- 蠖ケ蜑イ: 驟堺ソ。蜈・蜉幢シ医さ繝。繝ウ繝医€・・菫。繧、繝吶Φ繝医€∵桃菴懶シ峨r `Event` 縺ォ邨ア荳€
- MVP
  - CLI蜈・蜉幢シ育樟迥カ・・
  - ・井ササ諢擾シ臥ー。譏薙ヵ繧。繧、繝ォ蜈・蜉幢シ・SONL霑ス險假シ・

### LLM
- 蠖ケ蜑イ: Gemini API 蜻シ縺ウ蜃コ縺励€∵ァ矩€蛹門・蜉幢シ・SON・臥函謌・
- 隕∽サカ
  - 蜃コ蜉帙r **JSON繧ケ繧ュ繝シ繝槭〒讀懆ィシ**・・ydantic・・
  - 螟ア謨玲凾繝輔か繝シ繝ォ繝舌ャ繧ッ・亥ョ牙・縺ェ遏ュ譁・辟。險€・・

### RAG・育洒譛・髟キ譛滂シ・
- 遏ュ譛・ 逶エ霑代・驟堺ソ。繝ュ繧ー繝サVLM隕∫エ・・逶エ霑代・謇ソ隱肴ク医∩逋コ隧ア
- 髟キ譛・ persona/蜿ー譛ャ/驕主悉繝ュ繧ー/FAQ
- MVP譁ケ驥・
  - 譛€蛻昴・ **繝ュ繝シ繧ォ繝ォ螳檎オ・*
  - 繝吶け繝医ΝDB・・hroma縺ェ縺ゥ・・or 縺セ縺壹・霆ス驥上↑BM25/繧ュ繝シ繝ッ繝シ繝画、懃エ「縺ァ繧ょ庄

### VLM・育判髱「/繧ォ繝。繝ゥ隕∫エ・シ・
- 蠖ケ蜑イ: 繧ケ繧ッ繧キ繝ァ/繝輔Ξ繝シ繝竊定ヲ∫エ・ユ繧ュ繧ケ繝遺・RAG/LLM縺ォ萓帷オヲ
- MVP
  - 縲後せ繧ッ繧キ繝ァ繧剃ソ晏ュ倪・隕∫エ・ユ繧ュ繧ケ繝育函謌舌€・
  - 繧ュ繝」繝励メ繝」縺ッ謇句虚縺ァ繧ゅh縺・シ亥セ後〒閾ェ蜍募喧・・

### TTS
- 蠖ケ蜑イ: 繝・く繧ケ繝遺・髻ウ螢ー繝輔ぃ繧、繝ォ逕滓・・・av/mp3・・
- MVP
  - Google Cloud TTS・育┌譁呎棧諠ウ螳夲シ・
  - 螟ア謨玲凾縺ッ辟。髻ウ/繧ケ繧ュ繝・・・磯・菫。縺梧ュ「縺セ繧峨↑縺・シ・

### Live2D・・Tube Studio・・
- 蠖ケ蜑イ: `motion_tags` 繧・VTube Studio API 縺ョ繧「繧ッ繧キ繝ァ繝ウ縺ォ螟画鋤縺励※騾∽ソ。
- MVP
  - WebSocket 謗・邯・
  - HotkeyTrigger・医∪縺溘・ Expression・峨r騾√l繧・
  - 螟ア謨玲凾縺ッ繝ュ繧ー縺ョ縺ソ・磯・菫。邯咏カ夲シ・

### OBS
- 蠖ケ蜑イ: 繝・Ο繝・・縺ョ縺溘a縺ョ繝・く繧ケ繝医ヵ繧。繧、繝ォ譖エ譁ー
- MVP
  - `obs/now_playing.txt` 遲峨r荳頑嶌縺・
  - 謾ケ陦・髟キ縺募宛髯舌€∝些髯コ譁・ュ励・髯、蜴サ

### Manager・郁」乗婿謇ソ隱搾シ・
- 蠖ケ蜑イ: LLM縺ョ蜃コ蜉帙r **謇ソ隱・菫ョ豁」/蜊エ荳・* 縺励※蛻昴a縺ヲ Outputs 縺ォ豬√☆
- MVP譯・
  - CLI: `approve? (y/n/edit)`
  - 繝輔ぃ繧、繝ォ繧ュ繝・繝シ: `logs/<run_id>/pending.json` 竊・`approved.json`
  - 蟆・擂: 繝ュ繝シ繧ォ繝ォWeb UI・井ササ諢擾シ・

### Logging
- 蠖ケ蜑イ: 蜀咲樟諤ァ縺ョ縺ゅk繧、繝吶Φ繝医Ο繧ー縲√さ繧ケ繝・繝ャ繝シ繝亥宛蠕。縺ョ隕ウ貂ャ
- 隕∽サカ
  - JSONL・・陦・繧、繝吶Φ繝茨シ・
  - PII/繧ュ繝シ縺ョ繝槭せ繧ュ繝ウ繧ー

---

## D. 荳サ隕√ョ繝シ繧ソ螂醍エ・シ・SON繧ケ繧ュ繝シ繝・/ 繝ュ繧ー蠖「蠑・/ RAG謚募・蠖「蠑擾シ・

### D1. LLM 讒矩€蛹門・蜉幢シ・irectorOutput・・

- 譌「蟄・ `apps/core/types.py` 縺ョ `DirectorOutput` 繧偵・繝シ繧ケ縺ォ諡。蠑オ縺吶k
- 霑ス蜉謗ィ螂ィ繝輔ぅ繝シ繝ォ繝会シ亥ー・擂・・
  - `obs_text`・医ユ繝ュ繝・・逕ィ縺ォ遏ュ縺乗紛蠖「貂医∩・・
  - `speak_style`・磯€溷コヲ/謚第恕縺ェ縺ゥ TTS 險ュ螳壹ヲ繝ウ繝茨シ・
  - `safety`・郁・蟾ア逕ウ蜻翫・蜊ア髯コ蠎ヲ縲∵ケ諡・・

JSON Schema・育岼螳会シ・
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

### D2. 繧、繝吶Φ繝医Ο繧ー蠖「蠑擾シ・SONL・・

1陦・繧、繝吶Φ繝茨シ井セ・ `logs/<run_id>/events.jsonl`・・

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

### D3. RAG 謚募・蠖「蠑擾シ育洒譛・髟キ譛溷・騾壹・ Document・・

- 逶ョ逧・ 縲後>縺、繝サ縺ゥ縺薙°繧峨・菴輔r縲榊・繧後◆縺九r霑ス霍。縺ァ縺阪k

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

## E. 谿オ髫守噪繝槭う繝ォ繧ケ繝医・繝ウ・・VP 竊・Beta 竊・驕狗畑蠑キ蛹厄シ・

### Milestone 1: MVP・医∪縺夐・菫。縺ァ蝗槭k譛€蟆擾シ・

螳御コ・擅莉カ
- Gemini API 縺ァ `DirectorOutput` 繧・**讒矩€蛹褒SON** 縺ィ縺励※霑斐○繧・
- `SafetyFilter` 縺ァ譛€菴朱剞縺ョ繝悶Ο繝・け縺後〒縺阪k
- Manager 謇ソ隱搾シ・LI or 繝輔ぃ繧、繝ォ繧ュ繝・繝シ・峨〒驟堺ソ。蜿肴丐繧貞宛蠕。縺ァ縺阪k
- TTS 縺碁浹螢ー繝輔ぃ繧、繝ォ繧堤函謌撰シ・oogle Cloud TTS・・
- OBS 繝・Ο繝・・縺後ユ繧ュ繧ケ繝医ヵ繧。繧、繝ォ縺ァ譖エ譁ー縺輔l繧・
- VTube Studio 縺ォ繝帙ャ繝医く繝シ縺碁€√l繧具シ・S螳溯」・シ・
- JSONL繝ュ繧ー縺梧ョ九j縲・囿螳ウ譎ゅ↓關ス縺。縺壹↓繝輔か繝シ繝ォ繝舌ャ繧ッ縺吶k

TODO・亥ョ溯」・ち繧ケ繧ッ萓具シ・
- `apps/llm` 繧・stub竊竪emini 螳溯」・シ育┌譁呎棧繧貞燕謠舌↓譛€蟆上Μ繧ッ繧ィ繧ケ繝茨シ・
- `apps/tts` 繧・stub竊竪oogle Cloud TTS 螳溯」・
- `apps/live2d` 繧・stub竊歎Tube Studio WebSocket 螳溯」・
- `apps/obs`・域眠隕擾シ・ text file writer
- `apps/manager`・域眠隕擾シ・ approve gate
- `.gitignore` 谿矩ェク謨エ逅・シ・adapters/` 繧・ROM 繝ォ繝シ繝ォ縺ョ蜑企勁/隕狗峩縺暦シ・

### Milestone 2: Beta・・AG + VLM 繧貞・繧後※窶懆ウ「縺鞘€昴☆繧具シ・

螳御コ・擅莉カ
- 遏ュ譛溘Γ繝「繝ェ・磯・菫。繝ュ繧ー・峨〒逶エ霑第枚閼医r蜿悶j霎シ繧√k
- 髟キ譛溘Γ繝「繝ェ・・ersona/蜿ー譛ャ/驕主悉繝ュ繧ー・峨r蜿悶j霎シ縺ソ縲∵、懃エ「竊鱈LM縺ォ豕ィ蜈・縺ァ縺阪k
- VLM・医せ繧ッ繧キ繝ァ竊定ヲ∫エ・ユ繧ュ繧ケ繝茨シ峨′蜍輔″縲∫洒譛溘Γ繝「繝ェ縺ォ霑ス險倥&繧後k
- Manager UI 縺碁°逕ィ縺励d縺吶>・域怙菴朱剞縺ョ螻・豁エ/蟾ョ蛻・。ィ遉コ・・

TODO
- `apps/rag`・域眠隕擾シ・ retriever + store・医∪縺壹・繝ュ繝シ繧ォ繝ォ・・
- `apps/vlm`・域眠隕擾シ・ screenshot summarize
- `apps/inputs`・域眠隕擾シ・ chat/system/vlm 縺ョ邨ア荳€繧、繝吶Φ繝・

### Milestone 3: 驕狗畑蠑キ蛹厄シ亥ョ牙ョ壹・繧ウ繧ケ繝医・螳牙・・・

螳御コ・擅莉カ
- 繝ャ繝シ繝亥宛髯舌・繧ュ繝」繝・す繝・繝サ繝舌ャ繧ッ繧ェ繝輔′荳€騾壹j謠・>縲∫┌譁呎棧繧定カ・∴縺ォ縺上>
- PII/遘伜諺諠・ア縺後Ο繧ー縺ォ蜃コ縺ェ縺・シ医・繧ケ繧ュ繝ウ繧ー繝サ菫晄戟譛滄俣縺ョ譏守「コ蛹厄シ・
- 逶」隕悶@繧・☆縺・Γ繝医Μ繧ッ繧ケ・井サカ謨ー/螟ア謨・繧ウ繧ケ繝域ヲらョ暦シ峨′蜿悶l繧・
- 髫懷ョウ譎ゅ・繝輔か繝シ繝ォ繝舌ャ繧ッ・・LM/TTS/VTS/OBS・峨′邨ア荳€縺輔l縺滓嫌蜍輔↓縺ェ繧・

---

## F. 辟。譁呎棧繧呈э隴倥@縺溘Ξ繝シ繝亥宛髯舌・繧ュ繝」繝・す繝・繝サ繝輔か繝シ繝ォ繝舌ャ繧ッ

### 譁ケ驥・
- 逕滓・繧ウ繧ケ繝医・鬮倥>鬆・↓縲悟他縺ー縺ェ縺・キ・螟ォ縲阪r蜈・繧後k
  1) VLM・育判蜒擾シ・
  2) LLM・磯聞譁・シ・
  3) TTS

### 蜈キ菴鍋ュ・
- 繝ャ繝シ繝亥宛髯・
  - 蜈・蜉帙う繝吶Φ繝医・繝・ヰ繧ヲ繝ウ繧ケ・亥酔荳€遞ョ蛻・縺ッ荳€螳夂ァ偵↓1蝗橸シ・
  - VLM縺ッ縲碁㍾隕√う繝吶Φ繝域凾縺ョ縺ソ縲阪€梧焔蜍輔ヨ繝ェ繧ャ縲阪・縺ゥ縺。繧峨°縺九i髢句ァ・
- 繧ュ繝」繝・す繝・
  - TTS: 蜷御ク€繝・く繧ケ繝遺・蜷御ク€髻ウ螢ー繧・`apps/tts/cache.py` 縺ォ菫晏ュ假シ域里縺ォ蝨溷床縺ゅj・・
  - LLM: `user_text + retrieved_context_hash + system_prompt_hash` 繧偵く繝シ縺ォ遏ュ譛溘く繝」繝・す繝・
- 繝輔か繝シ繝ォ繝舌ャ繧ッ
  - LLM螟ア謨・ 螳牙・縺ェ蝗コ螳壽枚 + emotion neutral + motion_tags empty
  - TTS螟ア謨・ 髻ウ螢ー繧ケ繧ュ繝・・・・BS縺縺第峩譁ー・・
  - VTube Studio螟ア謨・ 繧「繧ッ繧キ繝ァ繝ウ騾∽ソ。繧定ォヲ繧√※繝ュ繧ー縺ョ縺ソ
  - OBS螟ア謨・ 繝輔ぃ繧、繝ォ譖エ譁ー螟ア謨励r繝ュ繧ー縺ォ谿九@縺ヲ邯咏カ・

---

## G. 繧サ繧ュ繝・繝ェ繝・ぅ・・PI繧ュ繝シ邂。逅・€・env縲√Ο繧ー縺ョPII蟇セ遲厄シ・

- API繧ュ繝シ
  - `.env` 縺ッ繧ウ繝溘ャ繝医@縺ェ縺・シ育樟迥カ `.gitignore` 縺ァ髯、螟厄シ・
  - `.env/.env.main` 縺ォ蠢・ヲ√↑繧ュ繝シ繧偵∪縺ィ繧√k・医Ο繝シ繧ォ繝ォ逕ィ繝サGit邂。逅・@縺ェ縺・シ・
  - 蜿ッ閭ス縺ェ繧・OS 縺ョ遘伜ッ・ュ蝣ア繧ケ繝医い・・indows Credential Manager 遲会シ峨↓蟇・○繧具シ亥ー・擂・・

- 繝ュ繧ー
  - PII・亥€倶ココ蜷・ID/逕溘・繝√Ε繝・ヨ繝ュ繧ー・峨・蝓コ譛ャ逧・↓ **繝槭せ繧ュ繝ウ繧ー**
  - 菫晏ュ俶悄髢薙r豎コ繧√k・井セ・ `logs/` 繧剃ク€螳壽悄髢薙〒繝ュ繝シ繝・・繧キ繝ァ繝ウ・・

- 謇ソ隱阪ヵ繝ュ繝シ
  - Manager 縺梧怙邨ょ・蜉帙r遒コ螳壹☆繧具シ・LM蜃コ蜉帙r逶エ騾√@縺ェ縺・シ・
  - NG繝ッ繝シ繝・遖∵ュ「隧ア鬘後r `AITUBER_NG_WORDS` 縺ァ驕狗畑蜿ッ閭ス縺ォ縺吶k・域里蟄假シ・

---

## H. Runbook・医Ο繝シ繧ォ繝ォ襍キ蜍輔€∝ソ・ヲ∫腸蠅・€√ヨ繝ゥ繝悶Ν繧キ繝・繝シ繝茨シ・

### 繝ュ繝シ繧ォ繝ォ襍キ蜍包シ育樟迥カ縺ョ譛€蟆擾シ・

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -r requirements.txt
・井セ具シ荏.env/.env.main` 繧剃ス懊▲縺ヲ蛟、繧貞・繧後k
.\.venv\Scripts\python scripts/run_assistant.py
```

### 蠢・ヲ∫腸蠅・シ・VP 莉・髯搾シ・
- Python 3.11+
- VTube Studio・郁オキ蜍墓ク医∩・・
- Google AI Studio (Gemini) 縺ョ API Key
- ・・TS蟆主・譎ゑシ烏oogle Cloud TTS 縺ョ隱崎ィシ・医し繝シ繝薙せ繧「繧ォ繧ヲ繝ウ繝・or ADC・・

### 繧医¥縺ゅk繝医Λ繝悶Ν
- `VTube Studio 縺ォ騾√l縺ェ縺Я
  - WS URL/繝昴・繝医r遒コ隱搾シ・AITUBER_VTUBE_WS_URL`・・
  - VTube Studio 蛛エ縺ョ API 險ュ螳・險ア蜿ッ繧堤「コ隱・
- `TTS 縺檎函謌舌&繧後↑縺Я
  - 隱崎ィシ諠・ア・育腸蠅・、画焚/ADC・峨r遒コ隱・
  - 辟。譁呎棧繧定カ・∴繧九→螟ア謨励☆繧句庄閭ス諤ァ縺後≠繧九◆繧√€√く繝」繝・す繝・/遏ュ譁・喧繧貞━蜈・
- `LLM 縺悟、ア謨励☆繧・JSON縺悟」翫l繧義
  - 讒矩€蛹門・蜉帙r譛€蜆ェ蜈茨シ・SON-only 縺ョ繝励Ο繝ウ繝励ヨ縲}ydantic讀懆ィシ・・
  - 螟ア謨玲凾縺ッ繝輔か繝シ繝ォ繝舌ャ繧ッ譁・〒驟堺ソ。繧呈ュ「繧√↑縺・

---

## README 謾ケ菫ョ・亥ー・擂TODO・・

- `README.md` 縺ッ迴セ迥カ縺ョ鬪ィ邨・∩隱ャ譏弱→縺励※縺ッ蜊∝・縺縺後€∽サ雁セ御サ・荳九・霑ス險倥′蠢・ヲ√↓縺ェ繧翫≧繧・
  - RAG・育洒譛・髟キ譛滂シ牙ー主・譁ケ驥・
  - VLM・医せ繧ッ繧キ繝ァ隕∫エ・シ牙ー主・譁ケ驥・
  - OBS 繝・Ο繝・・譖エ譁ー縺ョ險ュ螳夲シ医ヵ繧。繧、繝ォ繝代せ・・
  - Manager 謇ソ隱阪ヵ繝ュ繝シ縺ョ驕狗畑謇矩・
