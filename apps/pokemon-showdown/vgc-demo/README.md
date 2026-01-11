# Pokemon Showdown sim直叩き VGCダブル自己対戦デモ

このデモは **Pokemon Showdownのサーバは起動せず**、`tools/pokemon-showdown/pokemon-showdown/sim/battle-stream.ts` を **直接importしてsimを進行**します。

- 観測: **各プレイヤー視点の `|request|{...}` JSONのみ** をPythonへ渡します（不完全情報のまま）。
- 行動: Pythonは Showdown互換の **choose文字列**（`move ...` / `switch ...`）を返し、Nodeがそのままsimへ投入します。
- Team Preview相当: 6体チームから **Pythonがselect4** し、その4体で対戦開始します。

## 必要環境
- Windows PowerShell
- Node.js (>= 18 推奨)
- Python (>= 3.10 推奨)

## セットアップ

### Python（方策サーバ）
```powershell
cd apps/pokemon-showdown/vgc-demo/agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python agent_server.py
```

### Node（orchestrator）
```powershell
cd apps/pokemon-showdown/vgc-demo/orchestrator
npm install
npm run demo -- --n_battles 1 --format gen9vgc2026regf --p1_policy fallback --p2_policy fallback

# python方策サーバを使う場合
npm run demo -- --n_battles 5 --format gen9vgc2026regf --p1_policy heuristic --p2_policy heuristic --python_url http://127.0.0.1:8099

# NOTE: npmの挙動で --flag が吸われる環境があるため、positionalでも動くようにしています。
# 例) npm run demo -- 5 gen9vgc2026regf heuristic heuristic http://127.0.0.1:8099
```

## Self-play（20試合=1バッチ固定）
勝敗報酬のノイズを抑え、相手運と学習効果の切り分けや再現性を上げるため、**20試合を1バッチ**としてまとめて実行するコマンドを用意しています。

```powershell
cd apps/pokemon-showdown/vgc-demo/orchestrator

# 1バッチ (=20試合)
npm run selfplay -- --n_batches 1 --format gen9vgc2026regf --p1_policy heuristic --p2_policy heuristic --seed 123

# 複数バッチ
npm run selfplay -- --n_batches 5 --format gen9vgc2026regf --p1_policy heuristic --p2_policy heuristic --seed 123
```

## 一撃起動（統合）
リポジトリルートで:
```powershell
./scripts/pokemon-showdown/run_ps_vgc_demo.ps1
```

## 学習ループ（Ctrl+C / エポック数で停止）
`20試合=1バッチ` を基本単位として、

- 各バッチの結果を `batches.jsonl` に1行で記録
- `trajectories`（request由来の観測）を使って **agent側で更新**
- 一定間隔でスナップショット保存し、以降は `latest vs prev_snapshot`（過去自己）を相手に混ぜる

を **止めるまで（Ctrl+C）** または **指定エポック数** まで繰り返します。

リポジトリルートで:
```powershell
# 無限に学習（Ctrl+Cで停止）
./scripts/pokemon-showdown/run_ps_vgc_train.ps1

# 例: 50エポックで停止
./scripts/pokemon-showdown/run_ps_vgc_train.ps1 -Epochs 50 -Seed 123 -Format gen9vgc2026regf
```

環境変数で上書きできます:
```powershell
$env:VGC_DEMO_BATTLES = '5'
$env:VGC_DEMO_FORMAT  = 'gen9vgc2026regf'
$env:VGC_DEMO_PY_PORT = '9877'
./scripts/pokemon-showdown/run_ps_vgc_demo.ps1
```

## フォーマットが見つからない場合
- orchestratorに `--format` を渡して変更してください。
- 候補列挙: orchestratorは `tools/pokemon-showdown/pokemon-showdown/config/formats.ts` から `vgc` を含む候補IDを列挙します（実装で `--list_formats` を提供）。

候補列挙コマンド:
```powershell
cd apps/pokemon-showdown/vgc-demo/orchestrator
npm run demo -- --list_formats
```

## 出力
- `data/pokemon-showdown/vgc-demo/battles.jsonl`
- `data/pokemon-showdown/vgc-demo/batches.jsonl`（selfplay: 1バッチ=1行）
- `data/pokemon-showdown/vgc-demo/summary.json`
- `data/pokemon-showdown/vgc-demo/errors.jsonl`（エラーが出た場合のみ）
- `data/pokemon-showdown/vgc-demo/debug.jsonl`（`VGC_DEMO_DEBUG=1` の場合のみ）
- `data/pokemon-showdown/vgc-demo/replays.jsonl`（`VGC_SAVE_REPLAY=1` の場合のみ）
- `data/pokemon-showdown/vgc-demo/trajectories.jsonl`（`VGC_SAVE_TRAIN_LOG=1` の場合のみ）

## ログ方針（重要）
このデモは「学習/評価に必要な最小十分情報」は常時保存し、詳細デバッグ情報は `VGC_DEMO_DEBUG=1` のときだけ保存します。

さらに、学習（教師あり/強化学習）用の **意思決定ごとの軌跡** と、方策に依存せず完全再現できる **リプレイ用choose列** は、常時ログには載せず **環境変数で明示的にON** にしたときだけ保存します。

- 常時ログでShowdownの全イベントログを保存しない理由:
	- ディスク使用量が膨張しやすい
	- I/Oがボトルネックになり、対戦数が回らなくなる
	- 学習/評価に不要な情報が多く、扱いにくい

### 常時ログ: battles.jsonl（1試合=1行 JSON）
主に学習/評価/再現に必要な最小十分セットです。

必須（または原則入る）キー:
- `run_id`: 実行単位ID（同一run内で共通）
- `battle_index`: 0..N-1
- `battle_id`: `run_id-battle_index`
- `format`: 使用format
- `started_at` / `finished_at`: ISO8601
- `duration_ms` / `battle_total_ms`: 1試合の壁時計（ms）
- `sim_ms`: simループの壁時計（ms）
- `turns`: ターン数
- `winner`: `"p1" | "p2" | "tie" | "error"`
- `p1` / `p2`:
	- `policy`: 方策名（例: `python:heuristic` / `fallback`）
	- `team_id`: チームID（ハッシュ短縮）
	- `team_hash`: チームハッシュ（sha256 hex）
	- `select4`: team previewで選んだ4体（0..5 index）
- `teams.team1_packed` / `teams.team2_packed`: Showdown packed team string（6体）
- `rng.seed`: 対戦seed（※Pythonへは渡していません。ログとして保存するだけです）
- `error`: エラー時のみ `{ kind, message, stack, phase }`

後方互換のため、旧キー（`ms`, `p1_policy`, `p2_policy`, `select4_p1`, `select4_p2` など）も残しています。

### デバッグログ: debug.jsonl（VGC_DEMO_DEBUG=1 のみ）
I/Oを増やさないため、分割ファイルは作らず **1 run = 1ファイル** にJSONL追記します。
保存内容は「再現に役立つが常時保存は重い」情報に限定します。

- requestの要約（合法手の概要のみ。request JSONの丸ごと保存はしない）
- Pythonが返したchoice（raw/normalize後）
- fallbackに落ちた場合の情報（python_error）

### リプレイログ: replays.jsonl（VGC_SAVE_REPLAY=1 のみ）
1試合=1行のJSONで、**start状態（format/seed/team）+ 両者のchoose列** を保存します。
このログだけで **方策に依存せず同一試合を再現** できます（動画化/検証用途）。

主なキー:
- `battle_id`, `format`, `seed`, `start_seed`
- `p1_team`, `p2_team`（対戦開始に使ったpacked team）
- `p1_choices`, `p2_choices`（simへ投入したchoose文字列の列）
- `expected_winner`, `expected_turns`（検証用）
- `meta`（再現性の前提条件/環境メタ。将来の再現崩れ検知用）

`meta` の例（概略）:
```json
{
	"created_at": "2026-01-09T12:34:56.789Z",
	"node_version": "v20.11.1",
	"platform": "win32",
	"arch": "x64",
	"orchestrator_commit": "<git hash or 'unknown'>",
	"showdown_commit": "<git hash or 'unknown'>",
	"showdown_path": "tools/pokemon-showdown",
	"config": {
		"format": "...",
		"obs_mode": "features",
		"save_compress": 0,
		"save_sample_rate": 1,
		"p1_policy": "fallback",
		"p2_policy": "fallback"
	}
}
```

リプレイ検証:
```powershell
cd apps/pokemon-showdown/vgc-demo/orchestrator
npm run replay -- <battle_id>
```

最新のreplayを一撃で検証（.gzも自動対応）:
```powershell
cd apps/pokemon-showdown/vgc-demo/orchestrator
npm run replay:latest

# battle_idだけ欲しい場合
npm run replay:latest -- --print
```

メタ不一致WARNについて:
- `node_version` / `orchestrator_commit` / `showdown_commit` / `platform` / `arch` が一致しない（または `unknown`）場合、WARNを出します。
- WARNが出ても replay 自体は実行し、`winner/turns` の一致判定は行います。
- ただし WARN がある場合は「完全一致保証なし」として扱ってください。

（任意）簡易ピック:
```powershell
cd apps/pokemon-showdown/vgc-demo/orchestrator
npm run replay:pick -- --where "winner=p1" --min_turns 12 --first true
```

### 学習ログ: trajectories.jsonl（VGC_SAVE_TRAIN_LOG=1 のみ）
**1意思決定=1行** のJSONLです（player POV の request 由来のみ）。
終端で `done=true` の行に `reward`（勝:+1/負:-1/引分:0）を付与します。

主なキー:
- `battle_id`, `player`, `turn`, `step`
- `obs_mode`: `features`（既定） / `full`
- `obs`: request由来の観測（featuresまたはfull）
- `legal`: requestから抽出した合法手の概要
- `choice` / `choice_raw` / `choice_source`
- `done`, `reward`, `outcome`

### 保存ON/OFFとサンプリング（環境変数）
- `VGC_SAVE_REPLAY=1`: replaysを保存
- `VGC_SAVE_TRAIN_LOG=1`: trajectoriesを保存
- `VGC_SAVE_SAMPLE_RATE=0..1` : 保存対象の試合をサンプリング（既定 1）
- `VGC_OBS_MODE=features|full` : trajectoriesの観測表現（既定 features）
- `VGC_SAVE_COMPRESS=1` : `*.jsonl.gz` で保存（既定OFF）
- `VGC_SAVE_DIR` : 保存先ディレクトリ（既定 out/。out配下のみ許可）

## デバッグ
request受信や choice 正規化ログを出す:
```powershell
$env:VGC_DEMO_DEBUG = '1'
./scripts/pokemon-showdown/run_ps_vgc_demo.ps1
```

## よくある失敗
- ポート使用中（Python側: 8099）
- ESM/CJS import問題（orchestratorは `tsx` 実行でTSを直接importします）
- `tools/pokemon-showdown` の参照パス間違い

## 観測の安全性
- Pythonへ渡すのは **request JSON由来** のみ。
- RNG seed / 内部状態 / 相手の未公開技・持ち物などは **渡していません**（推定もしません）。
