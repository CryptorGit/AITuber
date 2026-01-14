# ARCHITECTURE (MVP)

## 繝・・繧ｿ繝輔Ο繝ｼ

```mermaid
flowchart LR
  subgraph WebUI[Web UI]
    CONSOLE[Console (browser)] -->|/vlm/frame| VLMIN
    CONSOLE -->|/stt/text| EVT
    STAGE[Stage (browser/OBS)] -->|/overlay_text| STATE
    STAGE -->|/state/live2d| STATE
    CONSOLE -->|/motion| STATE
  end

  subgraph Inputs
    EVT[/POST \/events/ or \/stt\/text/] --> PEND[(pending.json)]
    VLMIN[/POST \/vlm\/frame/] --> ST
  end

  subgraph Context
    ST[(events.jsonl)] --> RAGCTX
    LT[(long_term.sqlite)] --> RAGCTX
    VLM[/VLM summary/] --> RAGCTX
  end

  RAGCTX --> LLM[GeminiMVP.generate()
(structured JSON)]
  LLM --> PEND

  subgraph Manager
    PEND --> APPROVE[/POST \/manager\/approve/]
    PEND --> REJECT[/POST \/manager\/reject/]
  end

  APPROVE --> OBS[data/stream-studio/obs/overlay.txt]
  APPROVE --> TTS[data/stream-studio/audio/tts_latest.wav]
  APPROVE --> VTS[VTube Studio WS hotkey trigger]
  APPROVE --> STATE[data/stream-studio/state.json]
```

## 荳ｻ隕！/F

- LLM讒矩蛹門・蜉・ `apps.core.types.AssistantOutput`
  - `speech_text` / `overlay_text` / `motion_tags` / `safety`
- Manager謇ｿ隱・
  - `pending.json` 縺ｫ蛟呵｣懊ｒ闢・ｩ・
  - approve縺ｧ譛邨ょ・蜉幢ｼ育ｷｨ髮・庄・峨ｒ遒ｺ螳壹＠ Outputs 縺ｫ豬√☆
- RAG
  - short-term: `data/stream-studio/events.jsonl` 縺ｮ逶ｴ霑代Ο繧ｰ
  - long-term: `data/stream-studio/rag/long_term.sqlite`・・TS5/LIKE讀懃ｴ｢・・
- VLM
  - `data/stream-studio/vlm/latest.png` 繧偵く繝｣繝励メ繝｣縺励；emini・域悴險ｭ螳壹↑繧峨・繝ｬ繝ｼ繧ｹ繝帙Ν繝・峨〒隕∫ｴ・

## 諡｡蠑ｵ菴吝慍

- YouTube chat ingestion: `apps/youtube` 縺ｫ螳溯｣・ｿｽ蜉・・ubSub/LiveChat API遲会ｼ・
- obs-websocket: `apps/obs` 縺ｫ霑ｽ蜉・育樟蝨ｨ縺ｯ繝輔ぃ繧､繝ｫ譖ｸ縺崎ｾｼ縺ｿ・・
- embeddings + vector DB: `apps/rag/` 縺ｫ蟾ｮ縺玲崛縺亥庄閭ｽ・育樟迥ｶ縺ｯsqlite讀懃ｴ｢・・
- Manager UI: CLI竊淡eb UI縺ｸ・亥ｮ溯｣・ｸ医・LI 繧ょｾ梧婿莠呈鋤縺ｧ邯ｭ謖・ｼ・
