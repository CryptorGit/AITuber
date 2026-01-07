# web/ (Stage / Console)

このディレクトリは FastAPI から静的配信される **Web UI** です。

- `http://127.0.0.1:8000/console` : Manager Console（デバイス選択 / STT / 候補承認 / モーション発火）
- `http://127.0.0.1:8000/stage` : Stage（OBS Browser Source 用、字幕 + Live2D + TTS 再生）

## Live2D (Web) の前提

本MVPは **Cubism 4 系のモデル（`.model3.json` / `.motion3.json`）** を想定します。

### 1) Cubism Core の用意（必須）

`pixi-live2d-display`（CDN版）で Cubism 4 モデルを描画するには `live2dcubismcore.min.js` が必要です。

- 公式 Cubism SDK for Web から `live2dcubismcore.min.js` を取り出し、次の場所に配置してください:
  - `web/vendor/live2dcubismcore.min.js`

注意:
- このリポジトリには Live2D SDK / Core は同梱しません（ライセンスに注意）。

### 2) モデル配置

`data/web/models/<name>/` 配下にモデルを配置してください（サーバーが `/models` として配信します）。

例:
- `data/web/models/haru/haru.model3.json`
- `data/web/models/haru/motions/01_greet.motion3.json`

Stage 側はデフォルトで次のURLを読みにいきます:
- `/models/<name>/<name>.model3.json`

Console の「Live2D モデル名」「モデルファイル名」で変更できます（localStorage に保存）。

### 3) hotkeys.json

`web/main/hotkeys.json` は `motion_tags -> motion file path` の辞書です。

例:
```json
{
  "greet": "motions/01_greet.motion3.json",
  "smile": "motions/02_smile.motion3.json"
}
```

- 値は `.model3.json` 内の `FileReferences.Motions` にある `File` と一致する相対パスを推奨します。

## セキュリティ/プライバシー

- ブラウザは画像フレーム（JPEG）やテキストを **サーバに送るだけ** です。
- Gemini/VLM/TTS の API キー等はブラウザへ露出しません。
- サーバは受信したフレーム画像を保存しません（要約テキストのみログ/短期RAGに入ります）。
