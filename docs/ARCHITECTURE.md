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

  APPROVE --> OBS[data/obs/overlay.txt]
  APPROVE --> TTS[data/audio/tts_latest.wav]
  APPROVE --> VTS[VTube Studio WS hotkey trigger]
  APPROVE --> STATE[data/state.json]
```

## 主要I/F

- LLM構造化出力: `apps.core.types.AssistantOutput`
  - `speech_text` / `overlay_text` / `motion_tags` / `safety`
- Manager承認
  - `pending.json` に候補を蓄積
  - approveで最終出力（編集可）を確定し Outputs に流す
- RAG
  - short-term: `data/events.jsonl` の直近ログ
  - long-term: `data/rag/long_term.sqlite`（FTS5/LIKE検索）
- VLM
  - `data/vlm/latest.png` をキャプチャし、Gemini（未設定ならプレースホルダ）で要約

## 拡張余地

- YouTube chat ingestion: `apps/youtube` に実装追加（PubSub/LiveChat API等）
- obs-websocket: `apps/obs` に追加（現在はファイル書き込み）
- embeddings + vector DB: `apps/rag/` に差し替え可能（現状はsqlite検索）
- Manager UI: CLI→Web UIへ（実装済。CLI も後方互換で維持）
