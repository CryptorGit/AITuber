# Tetris AI Runbook

## 1. ffmpeg が見つからない
- Windows: `FFMPEG_PATH` を `.env/.env.main` に追加
  - 例: `FFMPEG_PATH=C:\\ffmpeg\\bin\\ffmpeg.exe`
- もしくは PATH に ffmpeg を追加

## 2. 動画が生成されない
- `data/tetris-ai/logs/{run_id}/eval.log` を確認
- `data/tetris-ai/videos/...` が作られているか確認
- 失敗しても学習は継続します（best-effort）

## 3. 学習が遅い / 重い
- `config/tetris-ai/config.yaml` で以下を調整
  - `train.total_steps`
  - `train.update_interval`
  - `eval.episodes`
  - `eval.fps` / `eval.cell`

## 4. 再現性が崩れる
- seed を固定
- GPU 使用時は完全一致にならない場合があるため、**統計傾向**で評価

## 5. Web 再生で表示されない
- `/api/tetris/checkpoints` が空 → replay/動画未生成
- `data/tetris-ai/replays/.../index.json` があるか確認
- ブラウザの Network タブで 404 を確認
