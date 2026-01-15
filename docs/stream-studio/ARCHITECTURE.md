# ARCHITECTURE (MVP)

## データフロー

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

## 主要ファイル/型

- LLM 出力（固定スキーマ）: `apps/stream-studio/core/types.py` の `AssistantOutput`
- 承認フロー:
  - `pending.json` に候補を保存
  - `POST /manager/approve` で最終出力（字幕/TTS/Live2D/状態）へ反映
- RAG:
  - short-term: `data/stream-studio/events.jsonl`
  - long-term: `data/stream-studio/rag/long_term.sqlite`
- VLM:
  - `data/stream-studio/vlm/latest.png`（最新スクショ）

