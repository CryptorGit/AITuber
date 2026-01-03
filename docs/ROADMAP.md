# ROADMAP (AITuber: YouTubeライブ配信向けAIアシスタント)

このリポジトリは「配信の主役AI」を最小構成から段階的に育てるための基盤です。
方針として **BizHawk/エミュ関連・RL/自動プレイ・テレメトリ** は扱いません（過去の残骸は削除/整理対象）。

---

## 0. 現状調査まとめ（2025-12-31 時点）

- ✅ Web UI（/stage, /console）実装完了（2025-12-31）
  - ブラウザからカメラ選択→ `/vlm/frame` で要約→短期RAGへ投入
  - STT（none/webspeech）→ `/stt/text` → 既存の承認フロー（pending.json）へ統合
  - Stage は `/overlay_text` と `tts_latest.wav` で字幕+音声再生

### 0.1 現在の構成（既にあるもの）

- 実行エントリ: `scripts/run_assistant.py`
  - 1行入力 → `apps/orchestrator/pipeline.py` を1回実行
- 設定: `apps/core/config.py`（`.env` / 環境変数）
- データ型: `apps/core/types.py`（`DirectorOutput` / `ReplyTo`）
- LLM: `apps/llm/director.py` は **スタブ（決定論）**
- Safety: `apps/orchestrator/safety.py` は **NGワード置換**
- TTS: `apps/tts/engine.py` は **無音WAV生成スタブ**
- Live2D/VTube Studio: `apps/live2d/vtube_studio.py` は **送信ログのスタブ**
- ログ/成果物: `logs/<run_id>/director.json`, `result.json`, `tts.wav`
- ドキュメント: `docs/overview.md`, `docs/runbook.md`, `docs/schemas.md`

### 0.2 方針に反する「残骸」候補と扱い

- `.gitignore` に以下が残っている（現状ワークツリーには `adapters/` や ROM 関連フォルダは見当たらない）
  - `/adapters/*`（特に `/adapters/bizhawk/...`）
  - `/roms/` と多数の ROM 拡張子
- 扱い（ロードマップでの方針）
  - **削除対象**: `adapters/`・ROM/エミュ関連の資産・ドキュメント・設定（存在する場合）
  - **移行対象**: もし「配信ログ」や「データ保存」のために `adapters/data/` を使っていたなら、配信AIの `logs/` と長期記憶ストア（RAG）に統合
  - **README との整合**: `README.md` はすでに「ゲーム/エミュ等は扱わない」方針で整合しているため、必要なら将来「RAG/VLM/OBS/Manager」を追記する（このロードマップで TODO 明記）

---

## A. ゴール（完成＝配信に必要な最小要件）

「配信の主役AI」として以下が **安定稼働** し、運用者（裏方）が制御できる状態を完成とする。

- 入力: 配信中のイベント/コメント（最初は手入力でOK）
- LLM: Gemini API を使い、**構造化JSON** を返す（スキーマで検証）
- RAG（二層）
  - 短期: 配信中ログ（直近コンテキスト）
  - 長期: キャラ設定/台本/過去ログ（ローカル完結）
- VLM: スクリーンショット（またはカメラ）→要約テキスト化→RAG/LLMに供給（最初はスクショ手動でも可）
- TTS: 文章→音声ファイル生成（Google Cloud TTS を想定、まず生成まで）
- Live2D: VTube Studio API（WebSocket）で **ホットキー/表情** を発火
- OBS: **OBSが読むテキストファイル** を更新してテロップを出す（obs-websocket は任意）
- Manager（裏方承認）
  - LLM出力をそのまま配信に流さず、**承認/修正/却下**できる
- Logging: トレース可能なイベントログ（JSONL）とPII配慮

完成条件（最低ライン）
- 1イベント入力→（RAG/VLM任意）→LLM構造化出力→Manager承認→TTS音声生成→OBSテキスト更新→VTube Studioアクション送信→全ログ保存

---

## B. アーキテクチャ概念図（データフロー / モジュール境界）

```mermaid
flowchart LR
  subgraph Inputs[Inputs]
    CHAT[Chat/コメント] --> EVT[Event Builder]
    SCREEN[Screen/Camera Capture] --> VLM[VLM Summarizer]
  end

  subgraph Memory[RAG / Memory]
    ST[短期メモリ: stream log]:::store
    LT[長期メモリ: persona/script/past logs]:::store
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

モジュール境界の考え方
- `Inputs` は「生データ→正規化イベント」までを責務にする
- `LLM` は「推論 + 構造化出力（検証）」まで、配信反映はしない
- `Manager` が **配信反映のゲート**（人間が止められる）
- `Outputs` は副作用（音声/テロップ/モーション）を担当

---

## C. モジュール一覧と責務

> 既存 `apps/*` は骨組みとして活かし、必要に応じて新規パッケージを足す。

### Inputs
- 役割: 配信入力（コメント、配信イベント、操作）を `Event` に統一
- MVP
  - CLI入力（現状）
  - （任意）簡易ファイル入力（JSONL追記）

### LLM
- 役割: Gemini API 呼び出し、構造化出力（JSON）生成
- 要件
  - 出力を **JSONスキーマで検証**（pydantic）
  - 失敗時フォールバック（安全な短文/無言）

### RAG（短期/長期）
- 短期: 直近の配信ログ・VLM要約・直近の承認済み発話
- 長期: persona/台本/過去ログ/FAQ
- MVP方針
  - 最初は **ローカル完結**
  - ベクトルDB（Chromaなど） or まずは軽量なBM25/キーワード検索でも可

### VLM（画面/カメラ要約）
- 役割: スクショ/フレーム→要約テキスト→RAG/LLMに供給
- MVP
  - 「スクショを保存→要約テキスト生成」
  - キャプチャは手動でもよい（後で自動化）

### TTS
- 役割: テキスト→音声ファイル生成（wav/mp3）
- MVP
  - Google Cloud TTS（無料枠想定）
  - 失敗時は無音/スキップ（配信が止まらない）

### Live2D（VTube Studio）
- 役割: `motion_tags` を VTube Studio API のアクションに変換して送信
- MVP
  - WebSocket 接続
  - HotkeyTrigger（または Expression）を送れる
  - 失敗時はログのみ（配信継続）

### OBS
- 役割: テロップのためのテキストファイル更新
- MVP
  - `obs/now_playing.txt` 等を上書き
  - 改行/長さ制限、危険文字の除去

### Manager（裏方承認）
- 役割: LLMの出力を **承認/修正/却下** して初めて Outputs に流す
- MVP案
  - CLI: `approve? (y/n/edit)`
  - ファイルキュー: `logs/<run_id>/pending.json` → `approved.json`
  - 将来: ローカルWeb UI（任意）

### Logging
- 役割: 再現性のあるイベントログ、コスト/レート制御の観測
- 要件
  - JSONL（1行1イベント）
  - PII/キーのマスキング

---

## D. 主要データ契約（JSONスキーマ / ログ形式 / RAG投入形式）

### D1. LLM 構造化出力（DirectorOutput）

- 既存: `apps/core/types.py` の `DirectorOutput` をベースに拡張する
- 追加推奨フィールド（将来）
  - `obs_text`（テロップ用に短く整形済み）
  - `speak_style`（速度/抑揚など TTS 設定ヒント）
  - `safety`（自己申告の危険度、根拠）

JSON Schema（目安）
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

### D2. イベントログ形式（JSONL）

1行1イベント（例: `logs/<run_id>/events.jsonl`）

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

### D3. RAG 投入形式（短期/長期共通の Document）

- 目的: 「いつ・どこから・何を」入れたかを追跡できる

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

## E. 段階的マイルストーン（MVP → Beta → 運用強化）

### Milestone 1: MVP（まず配信で回る最小）

完了条件
- Gemini API で `DirectorOutput` を **構造化JSON** として返せる
- `SafetyFilter` で最低限のブロックができる
- Manager 承認（CLI or ファイルキュー）で配信反映を制御できる
- TTS が音声ファイルを生成（Google Cloud TTS）
- OBS テロップがテキストファイルで更新される
- VTube Studio にホットキーが送れる（WS実装）
- JSONLログが残り、障害時に落ちずにフォールバックする

TODO（実装タスク例）
- `apps/llm` を stub→Gemini 実装（無料枠を前提に最小リクエスト）
- `apps/tts` を stub→Google Cloud TTS 実装
- `apps/live2d` を stub→VTube Studio WebSocket 実装
- `apps/obs`（新規）: text file writer
- `apps/manager`（新規）: approve gate
- `.gitignore` 残骸整理（`adapters/` や ROM ルールの削除/見直し）

### Milestone 2: Beta（RAG + VLM を入れて“賢く”する）

完了条件
- 短期メモリ（配信ログ）で直近文脈を取り込める
- 長期メモリ（persona/台本/過去ログ）を取り込み、検索→LLMに注入できる
- VLM（スクショ→要約テキスト）が動き、短期メモリに追記される
- Manager UI が運用しやすい（最低限の履歴/差分表示）

TODO
- `apps/rag`（新規）: retriever + store（まずはローカル）
- `apps/vlm`（新規）: screenshot summarize
- `apps/inputs`（新規）: chat/system/vlm の統一イベント

### Milestone 3: 運用強化（安定・コスト・安全）

完了条件
- レート制限・キャッシュ・バックオフが一通り揃い、無料枠を超えにくい
- PII/秘匿情報がログに出ない（マスキング・保持期間の明確化）
- 監視しやすいメトリクス（件数/失敗/コスト概算）が取れる
- 障害時のフォールバック（LLM/TTS/VTS/OBS）が統一された挙動になる

---

## F. 無料枠を意識したレート制限・キャッシュ・フォールバック

### 方針
- 生成コストの高い順に「呼ばない工夫」を入れる
  1) VLM（画像）
  2) LLM（長文）
  3) TTS

### 具体策
- レート制限
  - 入力イベントのデバウンス（同一種別は一定秒に1回）
  - VLMは「重要イベント時のみ」「手動トリガ」のどちらかから開始
- キャッシュ
  - TTS: 同一テキスト→同一音声を `apps/tts/cache.py` に保存（既に土台あり）
  - LLM: `user_text + retrieved_context_hash + system_prompt_hash` をキーに短期キャッシュ
- フォールバック
  - LLM失敗: 安全な固定文 + emotion neutral + motion_tags empty
  - TTS失敗: 音声スキップ（OBSだけ更新）
  - VTube Studio失敗: アクション送信を諦めてログのみ
  - OBS失敗: ファイル更新失敗をログに残して継続

---

## G. セキュリティ（APIキー管理、.env、ログのPII対策）

- APIキー
  - `.env` はコミットしない（現状 `.gitignore` で除外）
  - `.env/.env.main` に必要なキーをまとめる（ローカル用・Git管理しない）
  - 可能なら OS の秘密情報ストア（Windows Credential Manager 等）に寄せる（将来）

- ログ
  - PII（個人名/ID/生のチャットログ）は基本的に **マスキング**
  - 保存期間を決める（例: `logs/` を一定期間でローテーション）

- 承認フロー
  - Manager が最終出力を確定する（LLM出力を直送しない）
  - NGワード/禁止話題を `AITUBER_NG_WORDS` で運用可能にする（既存）

---

## H. Runbook（ローカル起動、必要環境、トラブルシュート）

### ローカル起動（現状の最小）

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -r requirements.txt
（例）`.env/.env.main` を作って値を入れる
.\.venv\Scripts\python scripts/run_assistant.py
```

### 必要環境（MVP 以降）
- Python 3.11+
- VTube Studio（起動済み）
- Google AI Studio (Gemini) の API Key
- （TTS導入時）Google Cloud TTS の認証（サービスアカウント or ADC）

### よくあるトラブル
- `VTube Studio に送れない`
  - WS URL/ポートを確認（`AITUBER_VTUBE_WS_URL`）
  - VTube Studio 側の API 設定/許可を確認
- `TTS が生成されない`
  - 認証情報（環境変数/ADC）を確認
  - 無料枠を超えると失敗する可能性があるため、キャッシュ/短文化を優先
- `LLM が失敗する/JSONが壊れる`
  - 構造化出力を最優先（JSON-only のプロンプト、pydantic検証）
  - 失敗時はフォールバック文で配信を止めない

---

## README 改修（将来TODO）

- `README.md` は現状の骨組み説明としては十分だが、今後以下の追記が必要になりうる
  - RAG（短期/長期）導入方針
  - VLM（スクショ要約）導入方針
  - OBS テロップ更新の設定（ファイルパス）
  - Manager 承認フローの運用手順
