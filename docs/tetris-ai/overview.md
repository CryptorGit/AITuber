# Tetris AI (ルール固定・評価仕様)

このドキュメントは「最強」の評価ブレを防ぐため、**ルール・報酬・評価指標・再生仕様**を固定します。

## 0. 既存リポジトリの起動/配信方式（確認済み）
- サーバエントリ: `apps/stream-studio/server/main.py` (FastAPI)
- Web UI: `/console` と `/stage` は `web/stream-studio/` の静的配信
- 起動スクリプト:
  - `scripts/stream-studio/run_dev.ps1`
  - `scripts/stream-studio/run_stack.ps1`
- ログ/データ規約: `data/stream-studio/` 配下 (`events.jsonl` など)
- 本パッケージは **data/tetris-ai/** に出力を集約し、既存規約に合わせる

## 1. ルールセット (ruleset_version: v1)
- 盤面: 10x20（上部に不可視 2 行バッファ）
- ミノ: 7 種 (I,O,T,S,Z,J,L)
- 生成: 7-bag
- 回転: SRS (Super Rotation System) を基準
- Hold: あり（1 ピース中 1 回）
- Next: 5
- 落下: 1ステップ=1アクション（**配置アクション化**。ドロップは hard を採用）
- ライン消し: 1～4 ライン
- 終了条件: 天井到達/スポーン不能

### 評価対象（最強の定義）
**固定ルール v1 の下で、評価エピソードにおける平均ライン数 (mean_lines) を最大化すること。**
補助指標: mean_reward / mean_steps / holes / bumpiness。

## 2. 報酬（v1 固定）
- ライン消し: 0/1/2/3/4 行 → 0,1,3,5,8
- 生存報酬: +0.01 / step
- 穴・凹凸ペナルティ: holes * 0.003, bumpiness * 0.001

> 変更時は ruleset_version を更新し、学習結果と評価の互換性を破らない。

## 3. 行動設計
- **配置アクション化**を採用
  - 現在のピース（または Hold 交換後のピース）について「合法配置」を列挙
  - 行動空間は「(rotation, x, hard-drop)」を 1 アクションとして扱う
  - 不正手を出さないため、**合法配置のみ**から選択

## 4. データ配置規約
- ルートは `data/tetris-ai/` に集約
- 主要ディレクトリ
  - checkpoints: `data/tetris-ai/checkpoints/{run_id}/step_XXXXXXX.pt`
  - replays: `data/tetris-ai/replays/{run_id}/{checkpoint_id}/episode_XXX.jsonl`
  - videos: `data/tetris-ai/videos/{run_id}/{checkpoint_id}/episode_XXX.mp4`
  - thumbs: `data/tetris-ai/thumbs/{run_id}/{checkpoint_id}/episode_XXX.png`
  - metrics: `data/tetris-ai/metrics/{run_id}/events.jsonl`

## 5. 実行手順（学習 / 評価 / 再生）
- 学習: `scripts/stream-studio/run_tetris_train.ps1`
- 評価: `scripts/stream-studio/run_tetris_eval.ps1`
- Web UI: `http://127.0.0.1:8000/console/tetris`

## 6. 再現性
- `config/tetris-ai/config.yaml` の seed を固定
- 乱数: Python / NumPy / Torch を固定
- 期待する再現性: **同一 seed で統計傾向が一致**

## 7. 将来拡張
- 対戦 (garbage) は別フェーズ
- 互換性のため `env` 層の I/F を分離し、将来的に拡張可能な設計を維持
