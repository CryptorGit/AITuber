# Replay Studio (Pokemon Showdown)

Pokemon Showdown の学習/対戦ログ（`data/pokemon-showdown/vgc-demo/train_*/replays.jsonl` 等）を「ショーダウン風UI」で閲覧/再生し、選択した試合を mp4 にエクスポートする WebUI です。

- ログ/生成物: `data/` 配下
- 設定: `config/` 配下
- **レンダリング自作はしません**（PS公式 replay viewer を利用）

## 起動

### 1) サーバ（API + replay viewer + mp4 export）

```powershell
cd apps/pokemon-showdown/replay-studio/server
npm install

# ※ mp4 export を使うなら（初回のみ）
npm run playwright:install

npm run dev
```

デフォルト: http://127.0.0.1:8787

### 2) UI（Vite+React）

```powershell
cd web/pokemon-showdown/replay-studio/ui
npm install
npm run dev
```

デフォルト: http://127.0.0.1:5173

## ディレクトリ

- `apps/pokemon-showdown/replay-studio/server/` : Node/Express
- `web/pokemon-showdown/replay-studio/ui/` : Vite+React
- `data/pokemon-showdown/vgc-demo/index.json` : 一覧用 index（初回アクセスで生成）
- `data/pokemon-showdown/vgc-demo/generated_logs/*.log` : choices→観戦ログ生成キャッシュ
- `data/pokemon-showdown/vgc-demo/exports/<battle_id>.mp4` : 生成された mp4

## 注意

- `replays.jsonl` は「開始状態 + choose列」なので、サーバ側で Showdown sim を回して観戦ログ（`|...` 形式）を生成して replay viewer に渡します。
- mp4 export は Playwright + ffmpeg を使います。
  - ffmpeg は `tools/ffmpeg/bin/ffmpeg.exe` があれば自動で使います。
  - 無い場合は `ffmpeg` を PATH に入れてください。
