# Movie Pipeline（movie-pipeline）仕様・運用ドキュメント

このドキュメントは、Pokemon Showdown の対戦リプレイ素材（MP4 + ログ）から、実況台本・字幕・TTS音声・アバターオーバーレイを生成し、最終的に完成MP4へ統合する制作パイプライン **movie-pipeline** の仕様・構成・運用手順をまとめたものです。

---

## 1. 目的

入力素材（リプレイMP4・ログ・タイムスタンプログ・BGM）から、

- 実況 **台本（script）**
- **字幕（subtitles）**
- **TTS音声（tts.wav / tts.mp3）**
- **アバター映像（overlay）**
- **完成MP4（final.mp4）**

を一貫して生成・管理し、UI/CLI から再現性・再実行性のある形で量産できる「動画制作工場」を提供します。

---

## 2. 重要原則（同期の設計）

### 2.1 正の時間軸（Single Source of Truth）
このパイプラインでは、**正の時間軸（基準）を TTS音声の実時間**に固定します。

- 台本や字幕のタイムスタンプは「予想」では崩れます
- TTS生成後に音声長が確定するため、**TTS後にタイムラインを正規化**する必要があります

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
リプレイ素材は以下の配置を前提にします。

```
data/replays/{battle_id}/
replay.mp4            (または任意の .mp4 / 最初のmp4を検出)
battle_log.json       (or .jsonl / .txt)
ts_log.json
```

- `battle_id` はディレクトリ名を基準に扱います
- `battle_log` は複数形式対応（JSON/JSONL/TXT）
- `ts_log.json` がない場合は「最低限モード」で動作（ただし精度は落ちます）

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
script.json
script_timed.json
subtitles.draft.srt
subtitles.srt
subtitles.ass
tts.wav
tts.mp3
tts_timing.json
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
- `data/replays/*/` を走査し、battle 一覧を作成します
- battle_id ごとに「mp4 / battle_log / ts_log」の存在を評価します
- 走査結果はキャッシュし、更新時刻で無効化します

### Step 1: LADM（台本・字幕の生成）
LADM は **規則ベース**で実況台本と字幕ドラフトを生成します。

入力:
- battle_log
- ts_log
- （任意）replayメタ（勝者/ターン数など）

出力（ドラフト）:
- `script.json`（セグメント単位の実況）
- `subtitles.draft.srt`

台本（例：概念）:
- 重要イベント抽出（倒した/倒された、天候、ギミック、テラス等）
- セグメント分割（短文単位）
- 感情タグ/モーションヒント付与（後続のアバター制御に利用）

### Step 2: TTS（音声生成 + 正規化）
台本（script）から TTS を生成します。

出力:
- `tts.wav`（正規の基準音声）
- `tts.mp3`（任意）
- `tts_timing.json`（セグメント境界のタイミング）
- `script_timed.json`（start/end 確定）
- `subtitles.srt`（start/end 確定）
- `subtitles.ass`（焼き込み用）

> 重要：ここで音声時間が確定します。以降のタイムラインはここに合わせます。

#### TTSプロバイダ
- 現状: Google Cloud Text-to-Speech（デフォルト）/ VOICEVOX（任意で切替）
- Google TTS では `ssml` + `<mark>` による timepoints でセグメント境界の確定が可能です

正規化ルール（TTS後）:
- セグメント開始/終了を TTS timing に合わせる
- 最小間隔、前後パディング、最大字幕長、重なり解消などの制約を守る

### Step 3: Renderer（アバターオーバーレイ生成）
Playwright を使ってレンダラーページを headless で起動し、アバター映像を収録します。

入力:
- `script_timed.json`
- `tts.wav`
- `tts_timing.json`（あれば）
- キャラクター設定（character_id）

出力:
- `overlay.webm`
- `lip_sync.json`

現状の想定:
- simple canvas avatar（口パク: RMSベース / モーション: セグメントemotionで選択）

将来:
- Live2D runtime（Pixi Live2D等）へ差し替え可能

### Step 4: Compose（ffmpeg最終合成）
ffmpeg で以下を統合して完成動画を生成します。

入力:
- replay.mp4（ベース）
- overlay（透過 or クロマキー）
- tts.wav/mp3（主音声）
- bgm.mp3（副音声）
- subtitles.srt（焼き込みは任意）

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
- 台本編集（編集→TTS再生成→再正規化→再レンダリング→再合成）
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
- `POST /api/mp/projects/:id/run?step=ladm|tts|live2d|compose|all`  
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
- `tts.wav` と `subtitles.srt` が生成される
- `script_timed.json` が存在し、TTS後にタイムスタンプが確定している
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
- 「TTS後正規化」が走っているかを確認
- `tts_timing.json` と `script_timed.json` の整合を確認
- セグメント分割が長すぎるとズレが目立つため、LADMの分割ルールを調整

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
このパイプラインの勝ち筋は「同期の基準をTTSに固定」し、ステップごとの生成物とログをプロジェクト単位で永続化して、**再現性と量産性を担保**する点です。  
完璧なリップシンクや高度な実況は後から追加できますが、工場としての土台（ジョブ、ログ、キャッシュ、正規化）がないと量産できません。

以上。
