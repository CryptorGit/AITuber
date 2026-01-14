# Movie Pipeline（movie-pipeline）仕様・運用ドキュメント

このドキュメントは、Pokemon Showdown の対戦リプレイ素材（MP4 + ログ）から、実況台本・字幕・TTS音声・アバターオーバーレイを生成し、最終的に完成MP4へ統合する制作パイプライン **movie-pipeline** の仕様・構成・運用手順をまとめたものです。

---

## 1. 目的

入力素材（リプレイMP4・ログ・タイムスタンプログ・BGM）から、

- 実況 **台本（script）**
- **字幕（subtitles）**
- **TTS音声（narration_tts.wav / narration_tts.mp3）**
- **アバター映像（overlay）**
- **完成MP4（final.mp4）**

を一貫して生成・管理し、UI/CLI から再現性・再実行性のある形で量産できる「動画制作工場」を提供します。

---

## 2. 重要原則（同期の設計）

### 2.1 正の時間軸（Single Source of Truth）
このパイプラインでは、**正の時間軸（基準）を narration_timeline.json（秒）**に固定します。

- LLM（または既定ロジック）が「何秒に何を喋るか」を決める
- TTSはそのタイムラインに **追従（ストレッチ/パディング/トリム）**して、音声の長さを合わせる
- 字幕は subtitle_timeline.json（秒）に従い、ASS/SRTを生成する

### 2.2 何を同期させるか
最終的に同期すべき対象は以下です。

- 台本（セグメント開始/終了）
- 字幕（表示開始/終了）
- リップシンク（口の開閉やviseme）
- オーバーレイ（アバターのモーション）
- ベース動画（リプレイMP4）上のイベントと実況の対応（※強制ではないが品質に効く）

---

## 3. 全体アーキテクチャ

### 3.1 ディレクトリ構成（作業場所の制約）
movie-pipeline は **ルート直下の各フォルダ配下に movie-pipeline を作成し、その中で完結**させます。

- `apps/movie-pipeline/`
  - `core/` : パイプライン本体（ジョブランナー・ステップ実行・生成物管理）
  - `server/` : APIサーバ（assets/projects/run/logs/artifacts）
  - `cli/` : CLI（scan/doctor/sample/run/export 等）
- `web/movie-pipeline/` : UI（assets一覧・project作成・実行・編集・プレビュー）

> ルート直下や他モジュールの大規模改変を避け、movie-pipeline の中で自律的に運用できるようにします。

---

## 4. データ配置（入力素材・出力）

### 4.1 入力（replays）
リプレイ素材（入力）は以下を最低限として扱います。

```
data/movie-pipeline/replays/{battle_id}/
replay.mp4            (または任意の .mp4 / 最初のmp4を検出)
battle_log.json       (or .jsonl / .txt)
ts_log.json
```

- `battle_id` はディレクトリ名を基準に扱います
- `battle_log` は複数形式対応（JSON/JSONL/TXT）
- `ts_log` は JSON / JSONL を許容し、秒ベース（`t`）にも ms ベースにも互換対応します

> Source-of-Truth の入力命名では `input_battle.mp4`, `input_timestamp_log.jsonl|json`, `input_bgm.mp3` を想定します。
> 現状実装は assets スキャンで `data/movie-pipeline/replays/{battle_id}/...` を解決し、Project.inputs に絶対パスとして保持します。

### 4.2 入力（BGM）
BGMは以下に配置します。

```
data/movie-pipeline/bgm/
*.mp3
```

### 4.3 入力（キャラクター）
キャラクター設定は以下を想定します。

```
data/movie-pipeline/characters/{character_id}/
character.json
(モデル素材、画像、設定ファイルなど)
```

※現状のレンダラーが「simple canvas avatar」の場合、最低限の設定でも動作します。  
将来 Live2D runtime を導入する場合もこの構造を維持します。

### 4.4 出力（プロジェクト）
生成物はプロジェクト単位で保存します。

```
data/movie-pipeline/projects/{project_id}/
project.json
manifest.json
artifacts/
script.json                 (Source-of-Truth: lines[])
script_draft.json            (デバッグ用: segments[])
narration_timeline.json      (Source-of-Truth: 秒)
subtitle_timeline.json       (Source-of-Truth: 秒)
subtitles.draft.srt          (ドラフト)
subtitles.srt
subtitles.ass
live2d_motion.json           (Source-of-Truth: 秒)
narration_tts.wav
narration_tts.mp3
tts_timing.json              (デバッグ用)
script_timed.json            (デバッグ用)
overlay.webm
lip_sync.json
final.mp4
final_with_subs.mp4
runs/{run_id}/
run.json
steps/
ladm.log
tts.log
live2d.log
compose.log
```

---

## 5. パイプラインステップ（詳細）

### Step 0: Scan（素材スキャン）
- `data/movie-pipeline/replays/*/` を走査し、battle 一覧を作成します
- battle_id ごとに「mp4 / battle_log / ts_log」の存在を評価します
- 走査結果はキャッシュし、更新時刻で無効化します

### Step 1: LADM（台本・字幕の生成）
LADM は **規則ベース**で実況台本と字幕ドラフトを生成します。

入力:
- battle_log
- ts_log
- （任意）replayメタ（勝者/ターン数など）

出力（ドラフト）:
- `script.json`（Source-of-Truth: lines[]）
- `narration_timeline.json`（Source-of-Truth: 秒）
- `subtitle_timeline.json`（Source-of-Truth: 秒）
- `subtitles.draft.srt`

台本（例：概念）:
- 重要イベント抽出（倒した/倒された、天候、ギミック、テラス等）
- セグメント分割（短文単位）
- 感情タグ/モーションヒント付与（後続のアバター制御に利用）

### Step 2: Live2D Motion + Renderer（オーバーレイ生成）
タイムライン（narration）を元に、モーション制御（`live2d_motion.json`）を生成し、オーバーレイ映像を生成します。

入力:
- `script.json`
- `narration_timeline.json`

出力:
- `live2d_motion.json`
- `overlay.webm`
- `lip_sync.json`

現状:
- overlay は **クロマキー合成前提（背景が緑）** です
- 実装都合で、renderer が音声を要求する場合は「無音WAV（タイムライン長）」を使用して先に収録します

### Step 3: TTS（音声生成 + タイムライン追従）
`script.json` から TTS を生成し、`narration_timeline.json` の総尺に **音声を合わせます**。

出力:
- `narration_tts.wav`
- `narration_tts.mp3`
- `subtitles.srt`
- `subtitles.ass`
- `tts_timing.json`（デバッグ用）
- `script_timed.json`（デバッグ用）

#### TTSプロバイダ
- 現状: Google Cloud Text-to-Speech（デフォルト）/ VOICEVOX（任意で切替）
- Google TTS では `ssml` + `<mark>` による timepoints でセグメント境界の確定が可能です

整合ルール（タイムラインが正）:
- `narration_timeline.json` / `subtitle_timeline.json` を基準に、TTSは総尺を合わせる
- 字幕は subtitle_timeline に従い、最大文字数・行数・重なり等の制約を守る

### Step 4: Compose（ffmpeg最終合成）
ffmpeg で以下を統合して完成動画を生成します。

入力:
- replay.mp4（ベース）
- overlay（透過 or クロマキー）
- narration_tts.mp3（主音声）
- bgm.mp3（副音声）
- subtitles.ass（焼き込み）

出力:
- `final.mp4`
- `final_with_subs.mp4`（字幕焼き込みが有効な場合）

音声ミックス:
- TTS主、BGMは固定で減衰（必要ならducking）

字幕:
- デフォは焼き込み（運用が安定）
- 別ファイル同梱も可能（用途次第）

---

## 6. UI（Web）

### 6.1 Assetsページ
- battle一覧の表示（battle_id、素材有無、メタなど）
- battle選択 → Project作成
- mp4選択時に battle_log と ts_log を自動紐付け（UX最優先）

### 6.2 Projectページ
- 入力素材と設定の確認（BGM、キャラ、音声設定）
- ステップ実行（個別Run / Run All）
- 台本編集（編集→タイムライン再生成→Live2D再収録→TTS再生成→再合成）
- 生成物プレビュー（音声・オーバーレイ・最終mp4）
- エラー表示（どのステップで失敗したか、stderr、ログ）

---

## 7. API（Server）

代表的なAPI（例）:

- `GET /api/mp/assets`  
  スキャン結果を返す
- `POST /api/mp/projects`  
  プロジェクト作成（battle_id, bgm, character 等）
- `GET /api/mp/projects/:id`  
  プロジェクト情報
- `POST /api/mp/projects/:id/run?step=ladm|live2d|tts|compose|all`  
  ステップ実行
- `GET /api/mp/projects/:id/artifacts`  
  生成物一覧
- `GET /api/mp/projects/:id/runs`  
  run 履歴
- `GET /api/mp/projects/:id/runs/:runId`  
  run 詳細
- `GET /api/mp/projects/:id/logs/:step?run_id=...`  
  ステップログ（tail）
- `GET /api/mp/doctor`  
  依存チェック
- `GET /api/mp/voices?language_code=ja-JP`  
  Google TTS voice 一覧
- `GET /projects/{project_id}/{rel_path}`  
  生成物の静的配信（プレビュー用）

> セキュリティ注意：パストラバーサルを防ぐため、任意パスの読み取りは禁止し、project_id/battle_id から解決します。

---

## 8. CLI

代表コマンド（例）:

- `scan` : replays をスキャン
- `sample --battle-id sample_demo` : サンプルデータ生成（スモークテスト用）
- `doctor` : 依存チェック（ffmpeg/ffprobe/playwright/TTS接続/データ配置）
- `create --battle-id ...` : プロジェクト作成
- `run --project-id ... --step all` : 実行
- `export --project-id ...` : final.mp4 とメタの書き出し

---

## 9. 実行手順（例）

### 9.1 インストール
```
cd apps/movie-pipeline/core
npm install
npx playwright install chromium

cd ../server && npm install
cd ../cli && npm install
cd ../../web/movie-pipeline && npm install
```

### 9.2 サンプル生成 → Doctor → 起動
```
cd apps/movie-pipeline/cli
npm run start -- sample --battle-id sample_demo
npm run start -- doctor

cd ../server
npm run dev

cd ../../web/movie-pipeline
npm run dev
```

---

## 10. 生成物の確認ポイント（「できた」の定義）

最低限、以下が満たされていることが「工場が回る」条件です。

- Run All で `final.mp4` が生成される
- `narration_timeline.json` / `subtitle_timeline.json` が存在する（秒が正）
- `narration_tts.mp3` と `subtitles.ass` が生成される
- `narration_tts.mp3` の総尺が narration_timeline の総尺と概ね一致する
- 失敗時にUIでステップとログが特定できる
- 同一projectで Run All を再実行しても壊れない（冪等性）

---

## 11. トラブルシュート

### ffmpeg/ffprobe が見つからない
- `doctor` で検出に失敗します
- PATH に追加、または環境変数で指定（実装に依存）

### Playwright が落ちる / Chromium がない
- `npx playwright install chromium` を実行
- headless環境や権限の制約に注意

### TTS が失敗する（VOICEVOX / Google）
- doctorで疎通確認を通す
- 認証情報/エンドポイント/ポートを確認
- キャッシュが残っている場合は該当artifactを削除して再生成

### 字幕がズレる
- `subtitle_timeline.json` と `subtitles.ass` の整合を確認
- `narration_timeline.json` の総尺と `narration_tts.mp3` の総尺が大きく乖離していないか確認
- 分割が粗い/長すぎるとズレが目立つため、LADMの分割ルールを調整

---

## 12. 拡張ポイント（次の現実的アップグレード）

- Live2D runtime（Pixi Live2D等）への差し替え
- Google TTS + SSML `<mark>` timepoints によるタイミング精度向上
- LADMに optional LLM adapter を追加（実況の質向上）
- UIでセグメントごとの感情/モーション編集、字幕レイアウト制約（行数、最大文字数等）
- 音声ducking（TTS区間でBGMを自動減衰）
- バッチ実行（複数battle_idをキューに投入して夜間に大量生成）

---

## 13. 設計の意図（短いまとめ）
このパイプラインの勝ち筋は「同期の基準をタイムライン（秒）に固定」し、TTSはそのタイムラインへ追従させつつ、ステップごとの生成物とログをプロジェクト単位で永続化して、**再現性と量産性を担保**する点です。  
完璧なリップシンクや高度な実況は後から追加できますが、工場としての土台（ジョブ、ログ、キャッシュ、アーティファクト）がないと量産できません。

以上。
