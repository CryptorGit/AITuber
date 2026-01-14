# Pokemon Showdown vgc-demo: 強化学習 (RL) のモデルと学習ルール（現状コード準拠）

このドキュメントは、`apps/pokemon-showdown/vgc-demo` 配下の **現状実装**（TypeScript orchestrator + Python agent）に基づいて、

- 何を「状態(observation)」として保存し
- 何を「行動(action)」として選び
- どのタイミングで「報酬(reward)」を与え
- どんな「モデル」と「更新則」で学習するか

を、実際のデータフロー／ファイル入出力／API仕様まで含めて詳細に整理したものです。

> 注意
> - 本プロジェクトの“学習”は、一般的な DQN/PPO 等の深層強化学習ではなく、**ハッシュ特徴量 + 線形スコア**（疎な重み辞書）を、
>   エピソードの勝敗（終端報酬）でまとめて更新する **非常にシンプルな学習**です。
> - 「学習ルール」は、勝敗が出たバトル（エピソード）について、そのエピソード内の全ステップに同じ符号の更新を加える、という形になっています。

---

## 0. 障害対応メモ（PPO /act 500・dump reason 切り分け）

PPO ルート（`policyMode: 'ppo'`）では、TS orchestrator が Python FastAPI の `/act` に問い合わせます。
このときの失敗は **Showdown の “invalid choice” と混同しない** ことが重要です。

### 0.1 dump reason の意味（重要）

- `ppo_act_http_error`
  - **Python `/act` が 4xx/5xx を返した**（もしくはそれに準ずる HTTP エラー）
  - TS は **Showdownへ choice を送らず**、fail-fast で battle を中断します。
  - dump には `http_status`, `response_body_snippet`, `built_obs_shapes`, `mask_left/right + sums`, `request_id` が含まれます。

- `invalid_choice`
  - **Showdown が “Invalid choice” を返した**（= 実際に choice を送った後に発生）
  - PPO に限らず、これは「真の invalid choice」の証拠です。

- `ppo_disabled_choice`
  - 生成した choice が request 内で disabled 扱いになっているなど、**送信前に TS が不正と判断した**ケース

- `mask_zero`
  - TS が作った legal mask が all-zero になり、**そもそも合法手が無い**と判断したケース

dump 出力先:
- `data/pokemon-showdown/vgc-demo/logs/runs/<run_id>/dumps/*.json`

---

## 0.4 検証: PPO 更新が回る/回らない条件（PPO_ROLLOUT_LEN）

PPO の更新（Python `/train`）は、TS 側の `RolloutCollector` が保持する rollout バッファが
`PPO_ROLLOUT_LEN` 以上になったタイミングで実行されます。

この A/B 検証では、同一の対戦量（例: 1 epoch, 2 batch, 1 batch 10戦 = 合計20戦）で、

- A: `PPO_ROLLOUT_LEN` を **未指定（unset）**
- B: `PPO_ROLLOUT_LEN=64` を **指定**

をそれぞれ `--repeats 3` 回ずつ回し、`train_calls` と `update_step` が増えるかを機械的に比較します。

実行（orchestrator ディレクトリから）:

```powershell
npm run verify:ppo-rolloutlen -- --repeats 3 --epochs 1 --batches-per-epoch 2 --battles-per-batch 10
```

実行（repo ルートから直接）:

```powershell
python .\tools\verify_ppo_rolloutlen.py --repeats 3 --epochs 1 --batches-per-epoch 2 --battles-per-batch 10
```

生成物:

- `data/pokemon-showdown/vgc-demo/experiments/ppo_rolloutlen_ab/results.csv`（集計）
- `data/pokemon-showdown/vgc-demo/experiments/ppo_rolloutlen_ab/summary.json`（variantごとの簡易サマリ）
- `data/pokemon-showdown/vgc-demo/experiments/ppo_rolloutlen_ab/<run_id>/summary.json`（1ランごとの証拠）

各ランの生ログ/証拠:

- `data/pokemon-showdown/vgc-demo/logs/runs/<run_id>/e2e_train.log`（TS の start/progress/final を含む）
- `data/pokemon-showdown/vgc-demo/logs/runs/<run_id>/ppo_train_metrics.jsonl`（train が走った場合のみ行が増える）
- `data/pokemon-showdown/vgc-demo/logs/runs/<run_id>/dumps/`（fail-fast で dump が出た場合）

### 0.2 Python `/act` のエラー返却例（JSON）

Python 側は例外を握りつぶさず、必ず traceback をログ出力しつつ、HTTP エラー時は JSON を返します。

例（400・入力不正）:

```json
{
  "detail": {
    "error": "ACT_FAILED",
    "message": "mask_all_zero_left",
    "details": {
      "request_id": "<battle_id>:<turn>:p1",
      "mask_left_sum": 0,
      "mask_right_sum": 12,
      "obs_shapes": { "entity_int": [12,11], "history_int": [4,4], ... }
    }
  }
}
```

例（500・内部例外）:

```json
{
  "detail": {
    "error": "ACT_FAILED",
    "message": "internal_error",
    "details": {
      "request_id": "<battle_id>:<turn>:p1",
      "policy_id": "learner",
      "mask_left_sum": 18,
      "mask_right_sum": 20
    }
  }
}
```

### 0.3 TS dump のサンプル構造（概略）

`ppo_act_http_error`（/actが失敗）:

```json
{
  "reason": "ppo_act_http_error",
  "battle_id": "...",
  "turn": 1,
  "side": "p1",
  "http_status": 500,
  "response_body_snippet": "{...}",
  "built_obs_shapes": {"entity_int": [12,11], ...},
  "mask_left_sum": 18,
  "mask_right_sum": 20,
  "request_id": "<battle_id>:1:p1"
}
```

`invalid_choice`（Showdown が invalid を返した）:

```json
{
  "reason": "invalid_choice",
  "battle_id": "...",
  "turn": 3,
  "side": "p2",
  "note": { "last_error": "Invalid choice ...", "last_choice": "move 1 1, move 2" },
  "raw_request_json": { ... }
}
```

---

## 1. 全体アーキテクチャ（役割分担）

### 1.1 TS Orchestrator（対戦シミュレーション + データ生成 + 学習呼び出し）

場所:
- `apps/pokemon-showdown/vgc-demo/orchestrator/src/*`

主な責務:
- Pokemon Showdown の BattleStream を使ってローカル対戦を回す
- 各ターンのプレイヤー視点 `|request|...` JSON を受け取り、ポリシーに従って `choose` コマンド文字列を返す
- ログ／リプレイ／軌跡（trajectories）を `data/pokemon-showdown/vgc-demo/...` に保存
- 学習モードでは、軌跡を Python agent に HTTP POST して学習更新を実行

### 1.2 Python Agent（方策決定 + 学習 + スナップショット管理）

場所:
- `apps/pokemon-showdown/vgc-demo/agent/*`

主な責務:
- FastAPI サーバとして `/choose` `/train_batch` `/save_snapshot` `/list_snapshots` を提供
- `policy=heuristic|random` の “手作りポリシー”
- `policy=learned`（or `snapshot:<id>`）のときは “学習済みモデル” で softmax サンプリング
- `train_batch` で TS 側が保存した軌跡（p1 だけ）から重みを更新

---

## 2. どこで「学習」が起きるか（実行パス）

### 2.1 学習ループ（orchestrator/train.ts）

ファイル:
- `apps/pokemon-showdown/vgc-demo/orchestrator/src/train.ts`

概略:
- `BATCH_SIZE = 20` 戦を 1 バッチとして、`epochs` 回だけ繰り返す（`epochs=0` なら無限）
- 各エポックで
  - python agent の `/list_snapshots` を叩いて opponent をサンプル
  - `runBattlesChunk()` で 20 戦回して軌跡 `trajectoryRows` を収集
  - `trainBatch()` で `/train_batch` に `trajectoryRows` を送信
  - `snapshot_every` ごとに `/save_snapshot` を呼ぶ

重要ポイント:
- 学習時は **強制的に**
  - `VGC_SAVE_TRAIN_LOG=1`
  - `VGC_SAVE_SAMPLE_RATE=1`
  - `VGC_OBS_MODE=full`
  - `VGC_SAVE_DIR=<このtrain_runのディレクトリ>`
  を環境変数でセットしてから対戦を回す（= 学習が成立するように obs を full(JSON) に固定）

### 2.2 どのデータを agent に送っているか

`trainBatch()` は `trajectories` のうち **player==p1 の行だけ**を抽出して送ります:

- p2 の軌跡は送られない
- つまり学習は「p1 の意思決定」だけを更新対象にする

---

## 3. 対戦シミュレーションと「行動(choice)」生成

### 3.1 BattleStream と request/choose

ファイル:
- `apps/pokemon-showdown/vgc-demo/orchestrator/src/showdown/sim_runner.ts`

BattleStream の流れ:
1. `>start { formatid, seed }`
2. `>player p1 { name, team }`
3. `>player p2 { name, team }`
4. 以降、各プレイヤー側ストリームに `|request|{...}` が流れてくる
5. orchestrator はその request に対して `choose` 文字列を決めて stream に書き込む

request は Showdown の「プレイヤー視点」JSON で、
- `active`（技候補など）
- `side.pokemon`（自分の場/控えの可視情報）
- `forceSwitch` / `canSwitch`
- `teamPreview` など
が入っています。

### 3.2 policyMode（python/local/fallback）

`runOneBattle()` は各プレイヤーに対して
- `policyMode: 'python' | 'local' | 'fallback'`
を持ちます。

- `python`: `/choose` を叩く（失敗したら fallback）
- `local`: Node 側のローカルポリシー `chooseLocal()`
- `fallback`: request からランダムに合法手を生成

※ さらに `normalizeChoiceForRequest()` があり、
- 受け取った choice が request と矛盾（target が必要/不要、disabled move 等）しないように補正します。

---

## 4. 観測(observation) の仕様（obs_mode）

### 4.1 obs_mode = full

TS 側の trajectories に `obs` として **request JSON 全体**を入れます。

- これは python 側学習 `train_from_trajectories()` が `obs` を `dict` として要求しているためです。
- 学習ループ（train.ts）では `VGC_OBS_MODE=full` に固定されます。

### 4.2 obs_mode = features

ファイル:
- `apps/pokemon-showdown/vgc-demo/orchestrator/src/learn/obs_features.ts`

`extractRequestFeatures(req)` の返す構造（要点）:
- `teamPreview`, `wait`, `canSwitch`, `forceSwitch`
- `activeCount`
- `activeMoves`: 最大2体分、最大4技ぶんの `{id, target, disabled}` と `canDynamax`
- `side.pokemon`: 各ポケモンの `{active, fainted, condition, ident}`

これは学習用というより「ログを軽量化する」用途寄りです。

---

## 5. 軌跡(trajectory) の仕様（保存フォーマット）

ファイル:
- `apps/pokemon-showdown/vgc-demo/orchestrator/src/run_battles.ts`

`saveTrainThis` が真のとき、`TraceDecisionEvent`（= 各 choose 決定）を蓄積し、
バトル終了後にそれらを trajectories として書き出します。

### 5.1 1行（1ステップ）のキー

trajectories の 1 行は概ね以下の形です（JSONL 1 行 = 1 dict）:

- `run_id`: 実行runのID
- `battle_index`: 連番
- `battle_id`: `run_id-index` 形式
- `format`: formatId
- `seed`: battleSeed
- `player`: `'p1' | 'p2'`
- `turn`: turn number（request が来たときの turn）
- `step`: decisions 配列内の通し番号（player混在のまま k を採番）
- `obs_mode`: `'full' | 'features'`
- `obs`:
  - full: request JSON
  - features: `extractRequestFeatures(request)`
- `legal`: request から抽出した合法手の要約（switch候補、movesのdisabled/target等）
- `choice`: 正規化後の choice 文字列（例: `move 1 1` / `switch 3` / `team 1234` など）
- `choice_raw`: 生の choice（python/local/fallback が返したもの）
- `choice_source`: `'python' | 'python_error' | 'fallback' | 'local'`
- `done`: 各 player について「最後の decision」だけ true
- `reward`: `done` のときだけ非0（後述）
- `outcome`: `{ winner, turns }`

さらに train.ts のバッチ学習では batch メタも付きます:
- `batch_id`, `batch_index`, `batch_size`, `batch_seed`, `batch_battle_index`, `opponent_id`

### 5.2 done の定義

重要:
- `decisions` は p1/p2 の decision が混在した配列
- そこで
  - `lastP1`: decisions 内で最後に現れる p1 の index
  - `lastP2`: decisions 内で最後に現れる p2 の index
  を探し、

```
(done for p1) = (d.player=='p1' && k==lastP1)
(done for p2) = (d.player=='p2' && k==lastP2)
```

となります。

つまり:
- **各 player ごとに 1 ステップだけ done=true**
- それ以外のステップは done=false

### 5.3 reward の定義（終端報酬）

勝者 `winner` は
- `p1` / `p2` / `tie` / `null`

rewardFor(player) は
- tie または winner が null → 0
- 勝者がその player → +1
- 負けた player → -1

数式で書くと、プレイヤー $p \in \{\mathrm{p1},\mathrm{p2}\}$ に対して

$$
\mathrm{rewardFor}(p) =
\begin{cases}
\phantom{-}1 & (\mathrm{winner}=p)\\
-1 & (\mathrm{winner}\in\{\mathrm{p1},\mathrm{p2}\} \wedge \mathrm{winner}\neq p)\\
\phantom{-}0 & (\mathrm{winner}\in\{\mathrm{tie},\varnothing\})
\end{cases}
$$

そして trajectories 行の reward は
- `done=true` の行だけ `reward = rewardFor(player)`
- それ以外は `reward=0`

すなわち、各ステップ $t$ の報酬 $r_t$ は

$$
r_t = \mathbb{1}[\mathrm{done}_t]\,\mathrm{rewardFor}(p)
$$

（ここで $\mathbb{1}[\cdot]$ は条件が真なら1、偽なら0の指示関数）です。

結果として 1 エピソード（1 バトル）あたり
- p1 に対して `done` 行が 1 個（+1/0/-1）
- p2 に対して `done` 行が 1 個（-1/0/+1）
となります。

---

## 6. Python 側の学習モデル（SparseModel）

ファイル:
- `apps/pokemon-showdown/vgc-demo/agent/learned_model.py`

### 6.1 モデルの形

`SparseModel` は以下を持ちます:
- `dim: int = 2^18`（ハッシュ特徴量の次元）
- `weights: Dict[int, float]`（疎な重み辞書。存在しない index は 0 とみなす）
- `step: int`（学習ステップのカウンタ）

スコアは
- `featurize(req, turn, action)` で token を列挙
- token を `_hash_to_index(token, dim)` で index 化
- index の重みを合計してスカラー `score` を得る

数式で書くと、特徴抽出を $\phi(\mathrm{req},\mathrm{turn},a)$（= token の集合/多重集合）とし、
ハッシュで次元 $D=2^{18}$ に落とした index 集合を

$$
I(\mathrm{req},\mathrm{turn},a)=\{\; h(\tau)\bmod D \;\mid\; \tau\in\phi(\mathrm{req},\mathrm{turn},a)\;\}
$$

とすると、行動 $a$ のスコアは

$$
s(a\mid\mathrm{req},\mathrm{turn})=\sum_{i\in I(\mathrm{req},\mathrm{turn},a)} w_i
$$

です（存在しない重みは $w_i=0$ とみなす）。

### 6.2 特徴量（featurize）

`featurize(req, turn, action, dim)` が作る token（要点）:
- `bias`
- `turn_bin:<turn//5>`（5ターン単位のビン）
- `active_species:<species>` 最大2体
  - request の `side.pokemon` から `active=true` かつ `fainted/0fnt` でないもの
  - `details` から species を抽出（例: `"Tornadus, M, L50"` → `tornadus`）
- `has_move:<move_id>` 最大12個
  - request の `active[].moves[]` から `disabled` でない `id`
- 行動文字列 `action` に対して
  - `action:<正規化した全文>`
  - `action_part:<カンマ分割ごと>`
  - `action_tok:<スペース分割ごと>`

そして token それぞれを sha1 でハッシュし `[0, dim)` に落として index とします。

ハッシュによる index 化は概念的には

$$
i = h(\tau) \bmod D
$$

に相当します（実装では sha1 の先頭8バイト相当を整数化して剰余）。

### 6.3 行動選択（learned_policy_choose）

`learned_policy_choose(req, rng, model)` は
- request の候補行動を `_extract_candidates_from_request(req)` で作り
- それらを `model.score(req, turn, action)` でスコアリング
- softmax でサンプルして選びます

候補集合を $\mathcal{A}$、各候補のスコアを $s(a)$ とすると、softmax は

$$
\pi(a\mid\mathrm{req},\mathrm{turn}) = \frac{\exp(s(a))}{\sum_{b\in\mathcal{A}}\exp(s(b))}
$$

で定義され、実装はこの分布から乱択します。

#### 6.3.1 teamPreview のとき

`req.get('teamPreview')` の場合は学習モデルは使わず、
単に
- `side.pokemon` の順番をランダムにシャッフル
- `team <digits>` を返す

※ これは「チーム選出を学習する」実装ではなく、あくまで簡易動作です。

#### 6.3.2 forced switch のとき

`forceSwitch` があるときは
- 可能な `switch <slot>` をランダムに選ぶ（複数枠にも対応）
- できなければ `pass`/`default`

この経路も基本的に学習モデルのスコアではなく、ランダム寄りに処理されます。

#### 6.3.3 通常時（singles / doubles）

- singles: `active_count <= 1`
  - 候補: `move <slot>`（target suffix を含む） + `switch <slot>`
  - スコア: `model.score(req, turn, candidate)`

- doubles: `active_count > 1`
  - active ごとに候補を作り、独立に softmax サンプル
  - スコアリングの action 文字列は `a{active_index}:{candidate}` にして区別

---

## 7. 学習更新則（train_from_trajectories）

### 7.1 入口（agent_server.py）

ファイル:
- `apps/pokemon-showdown/vgc-demo/agent/agent_server.py`

API:
- `POST /train_batch`
  - request: `{ trajectories: List[dict], lr: float }`
  - response: `{ ok, step, n_rows, n_updates, mean_return }`

### 7.2 エピソード分割

`train_from_trajectories(rows, lr)` は
- `battle_id` と `player` のペアでグループ化します:

```
by_episode[(battle_id, player)] = [steps...]
```

注意:
- TS 側は `/train_batch` に送る前に `player==p1` の行にフィルタしているので、
  実運用では episode は `(battle_id, 'p1')` のみになります。

### 7.3 エピソードリターン（ep_ret）の定義

1 episode の中で
- `done == true` のステップを探し、そこに入っている `reward` を `ep_ret` とします。
- `done` 行は通常1つのはずですが、複数あっても「最後に見つかった done の reward」で上書きされます。

数式としては、エピソード（= 1 battle_id, 1 player）を $\{(o_t,a_t,r_t,\mathrm{done}_t)\}_{t=0}^{T}$ とすると

$$
G \equiv \mathrm{ep\_ret} = r_T
$$

に相当します（途中の $r_t$ は基本 0 で、終端だけ $\pm 1$ または 0）。

### 7.4 更新を行う条件

- `ep_ret == 0.0` の episode は更新しません（tie のとき・または reward が欠損のとき等）

### 7.5 更新の形（全ステップ同じ delta）

`ep_ret != 0` の episode について、episode 内の各ステップ s に対して
- `obs` が dict でない場合はスキップ（= `obs_mode=full` 必須）
- `choice` が空ならスキップ
- `idxs = featurize(obs, turn, choice)` を計算
- `model.update(idxs, delta = lr * ep_ret)` を実行

ここで学習率を $\alpha$（= `lr`）、エピソードリターンを $G$（= `ep_ret`）と書くと、
各ステップ $t$ の特徴 index 集合 $I_t = I(o_t,\mathrm{turn}_t,a_t)$ に対して

$$
\forall i\in I_t:\quad w_i \leftarrow w_i + \alpha\,G
$$

を、エピソード内の全ステップに対して繰り返す形です。

エピソード全体で見ると、同じ特徴 index が複数ステップで出現した回数だけ加算されるので、
更新量は「勝った/負けたエピソードで出た特徴の出現回数」に比例します。

つまり:
- 勝った episode は episode の全ステップの特徴量に **+lr** を加算
- 負けた episode は episode の全ステップの特徴量に **-lr** を加算

> 重要: TD 誤差や advantage といった概念はなく、
> 「勝ちのときにその episode の行動特徴を強化、負けのときに弱化」という単純なルールです。

### 7.6 step / mean_return / n_updates

- `self.model.step += 1` を毎回行い、`latest.json` に保存
- `mean_return = total_return / n_ep`
  - `total_return` は episode ごとの `ep_ret` を合計
  - `n_ep` は episode 数
- `n_updates` は `model.update()` が実際に更新した特徴 index の総数（ステップ数×特徴数の合計）

数式で書くと、バッチ内のエピソード集合を $\mathcal{E}$、各エピソードのリターンを $G_e$ として

$$
\mathrm{mean\_return} = \frac{1}{|\mathcal{E}|}\sum_{e\in\mathcal{E}} G_e
$$

です。

---

## 8. モデル保存とスナップショット

### 8.1 保存先

`LearnedModelStore` は
- `VGC_LEARN_MODEL_DIR` があればそこ
- なければ repo 内の `data/pokemon-showdown/vgc-demo/models` を使います。

構造:
- `latest.json` … 最新モデル
- `snapshots/<snapshot_id>.json` … スナップショット群

### 8.2 スナップショット API

- `POST /save_snapshot { tag?: string } -> { snapshot_id }`
  - `snapshot_id` は `timestamp_step[_tag]` 形式
- `GET /list_snapshots -> { snapshot_ids: [...] }`

TS train.ts は
- opponent 用に snapshot をサンプルし
- `p2Policy = snapshot:<id>` を指定して戦わせます。

---

## 9. 報酬設計の性質と限界（現状実装の挙動）

現状の reward/learning は以下の性質を持ちます:

- **疎い終端報酬**: 勝敗がついた最後に ±1（途中は 0）
- **クレジット割当が粗い**: 勝ったエピソードの全行動をまとめて強化する
- **tie は学習しない**: ep_ret=0 なら更新をスキップ
- **p1 のみ学習**: train.ts が p1 軌跡のみ送信

このため、学習の安定性/収束性は「デモ用」の性格が強いです。

---

## 10. 実運用上の重要な環境変数（学習に関係するもの）

### 10.1 保存系（orchestrator/src/learn/save_config.ts）

- `VGC_SAVE_DIR`: 出力先
- `VGC_SAVE_TRAIN_LOG`: trajectories を保存する
- `VGC_SAVE_REPLAY`: replays を保存する
- `VGC_SAVE_SAMPLE_RATE`: 保存サンプリング率（0..1）
- `VGC_OBS_MODE`: `full` なら request JSON 全体、その他は features
- `VGC_SAVE_COMPRESS`: `1` で `.jsonl.gz`

追加（PPO update による replay 間引き）:
- `VGC_SAVE_REPLAY_ONLY_AFTER_UPDATE=1`: update 後の「次の1試合」だけ replay 保存する
- `VGC_SAVE_REPLAY_EVERY_N_UPDATES`: 上記が有効なとき、何 update ごとに保存するか（デフォルト 1）
  - 例: `VGC_SAVE_REPLAY_EVERY_N_UPDATES=100` なら 100 update ごとに 1 試合だけ保存

#### 無限学習（再開 + Ctrl+C で保存）

無限に学習し続け、Ctrl+C やエラーで止まったらスナップショット（重み）を保存し、次回はその続き（最新スナップショット）から再開するためのラッパー:

- `scripts/pokemon-showdown/run_ps_vgc_train_forever.ps1`

このスクリプトは内部で以下をセットします:

- `VGC_SAVE_REPLAY_ONLY_AFTER_UPDATE=1`
- `VGC_SAVE_REPLAY_EVERY_N_UPDATES=10000`（デフォルト）

実行例:

```powershell
./scripts/pokemon-showdown/run_ps_vgc_train_forever.ps1 -BattlesPerBatch 6000 -PpoRolloutLen 8 -ReplayEveryUpdates 10000
```

学習（train.ts）は `VGC_OBS_MODE=full` を強制します。

### 10.2 学習ハイパーパラメータ（train.ts / agent_server.py）

- `--lr`（positional でも指定可）: `/train_batch` の `lr` に渡る
- `--snapshot_every`: N epoch ごとに snapshot を保存
- `--opponent_pool`: opponent をサンプルする snapshot プールサイズ

### 10.3 チーム選出（RL そのものではないが挙動に影響）

- `PS_PICK_N`: team preview で「6体から何体持ち込むか」
  - doubles (VGC): 4
  - singles (BSS): 3

これは戦い方・学習の分布に影響します（ただし teamPreview 自体は learned で学習していない）。

---

## 11. どのファイルを見れば何が分かるか（索引）

- 学習ループ（epoch/batch、/train_batch 呼び出し）
  - `apps/pokemon-showdown/vgc-demo/orchestrator/src/train.ts`
- 軌跡生成（reward/done、obs_mode、保存形式）
  - `apps/pokemon-showdown/vgc-demo/orchestrator/src/run_battles.ts`
- request/choose ループ（BattleStream、choice 正規化、teamPreviewChoice）
  - `apps/pokemon-showdown/vgc-demo/orchestrator/src/showdown/sim_runner.ts`
- obs features
  - `apps/pokemon-showdown/vgc-demo/orchestrator/src/learn/obs_features.ts`
- save config
  - `apps/pokemon-showdown/vgc-demo/orchestrator/src/learn/save_config.ts`
- Python API（/choose, /train_batch, /save_snapshot, /list_snapshots）
  - `apps/pokemon-showdown/vgc-demo/agent/agent_server.py`
- 学習モデル（featurize, update, train_from_trajectories）
  - `apps/pokemon-showdown/vgc-demo/agent/learned_model.py`
- heuristic/random ポリシー（request から候補抽出、target suffix 等）
  - `apps/pokemon-showdown/vgc-demo/agent/policies.py`

---

## 12. よくある落とし穴（現状コードの前提）

- `train_from_trajectories()` は `obs` が dict でないと学習しない
  - `VGC_OBS_MODE=features` で trajectories を作ると、Python 側がスキップして実質学習しません
- tie の episode は学習しない
- teamPreview の選択（bring N / order）は学習していない
  - learned_policy_choose は teamPreview を単に shuffle するだけ
  - orchestrator 側では `teamPreviewChoice` を注入して deterministic にしているケースがある

---

## 13. 追加の検証アイデア（必要なら）

- 学習が本当に更新しているか:
  - `/train_batch` の `n_updates` が 0 でないことを確認
  - `data/.../models/latest.json` の `step` が増えることを確認
- “bring 3” の検証（singles）:
  - 生成ログに `|choice|team 123|` 相当が出るか（Replay Studio の生成ログ側で）

