# Replay Format (Web/Video 共通)

## 1. 目的
Web 再生と動画生成が **同一のリプレイ** を参照するため、フォーマットを固定します。

## 2. 形式
- 1 エピソード = 1 JSONL ファイル
- 先頭に meta 行、以降 step 行

### meta 行
```json
{"type":"meta","ruleset_version":"v1","seed":123,"policy_id":"step_0000500","timestamp":"2026-01-18T00:00:00Z"}
```

### step 行
```json
{
  "type":"step",
  "step_idx":12,
  "piece_id":"T",
  "rotation":1,
  "x":4,
  "y":16,
  "drop_mode":"hard",
  "board":{"format":"rle","data":[[0,34],[3,1],[0,6],...]},
  "lines_cleared":1,
  "reward":1.01,
  "done":false
}
```

## 3. board フィールド
- `format: "rle"` 固定
- `data`: [値, 繰り返し回数] の配列
- 盤面は **20x10 (visible only)** のフラット順 (row-major)

## 4. 保存場所
- `data/tetris-ai/replays/{run_id}/{checkpoint_id}/episode_XXX.jsonl`
- `data/tetris-ai/replays/{run_id}/{checkpoint_id}/index.json`

## 5. index.json
```json
{
  "checkpoint_id":"step_0000500",
  "run_id":"run_20260118_120000",
  "episodes":[
    {
      "id":"run_.../step_.../episode_000.jsonl",
      "episode":0,
      "reward":12.34,
      "lines":18,
      "steps":77,
      "video":"run_.../step_.../episode_000.mp4",
      "thumb":"run_.../step_.../episode_000.png"
    }
  ]
}
```
