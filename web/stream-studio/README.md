# web/stream-studio (Stage / Console)

`apps/stream-studio` の FastAPI サーバが提供する **Web UI** です。

- `http://127.0.0.1:8000/console`
  - 入力（手動/将来拡張）
  - VLM フレーム送信（`/vlm/frame`）
  - STT 送信（`/stt/text`）
  - 生成候補の承認/却下（`/manager/approve` / `/manager/reject`）

- `http://127.0.0.1:8000/stage`
  - OBS Browser Source 向けオーバーレイ
  - 字幕（`/overlay_text`）と音声（TTS）を表示/再生
  - Live2D/VTube Studio モーションをトリガー

## Live2D (Web)

- VTube Studio 側の接続設定は `config/stream-studio/live2d_hotkeys.yaml` と `.env`（`AITUBER_VTUBE_AUTH_TOKEN` など）を参照。
- Stage は承認時に `motion_tags` に応じてホットキーを発火します。

# web/ (Stage / Console)

縺薙・繝・ぅ繝ャ繧ッ繝医Μ縺ッ FastAPI 縺九i髱咏噪驟堺ソ。縺輔l繧・**Web UI** 縺ァ縺吶€・

- `http://127.0.0.1:8000/console` : Manager Console・医ョ繝舌う繧ケ驕ク謚・/ STT / 蛟呵」懈価隱・/ 繝「繝シ繧キ繝ァ繝ウ逋コ轣ォ・・
- `http://127.0.0.1:8000/stage` : Stage・・BS Browser Source 逕ィ縲∝ュ怜ケ・+ Live2D + TTS 蜀咲函・・

## Live2D (Web) 縺ョ蜑肴署

譛ャMVP縺ッ **Cubism 4 邉サ縺ョ繝「繝・Ν・・.model3.json` / `.motion3.json`・・* 繧呈Φ螳壹@縺セ縺吶€・

### 1) Cubism Core 縺ョ逕ィ諢擾シ亥ソ・茨シ・

`pixi-live2d-display`・・DN迚茨シ峨〒 Cubism 4 繝「繝・Ν繧呈緒逕サ縺吶k縺ォ縺ッ `live2dcubismcore.min.js` 縺悟ソ・ヲ√〒縺吶€・

- 蜈ャ蠑・Cubism SDK for Web 縺九i `live2dcubismcore.min.js` 繧貞叙繧雁・縺励€∵ャ。縺ョ蝣エ謇€縺ォ驟咲スョ縺励※縺上□縺輔>:
  - `web/vendor/live2dcubismcore.min.js`

豕ィ諢・
- 縺薙・繝ェ繝昴ず繝医Μ縺ォ縺ッ Live2D SDK / Core 縺ッ蜷梧「ア縺励∪縺帙s・医Λ繧、繧サ繝ウ繧ケ縺ォ豕ィ諢擾シ峨€・

### 2) 繝「繝・Ν驟咲スョ

`data/stream-studio/web/models/<name>/` 驟堺ク九↓繝「繝・Ν繧帝・鄂ョ縺励※縺上□縺輔>・医し繝シ繝舌・縺・`/models` 縺ィ縺励※驟堺ソ。縺励∪縺呻シ峨€・

