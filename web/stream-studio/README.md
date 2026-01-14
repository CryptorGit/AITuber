# web/ (Stage / Console)

縺薙・繝・ぅ繝ｬ繧ｯ繝医Μ縺ｯ FastAPI 縺九ｉ髱咏噪驟堺ｿ｡縺輔ｌ繧・**Web UI** 縺ｧ縺吶・

- `http://127.0.0.1:8000/console` : Manager Console・医ョ繝舌う繧ｹ驕ｸ謚・/ STT / 蛟呵｣懈価隱・/ 繝｢繝ｼ繧ｷ繝ｧ繝ｳ逋ｺ轣ｫ・・
- `http://127.0.0.1:8000/stage` : Stage・・BS Browser Source 逕ｨ縲∝ｭ怜ｹ・+ Live2D + TTS 蜀咲函・・

## Live2D (Web) 縺ｮ蜑肴署

譛ｬMVP縺ｯ **Cubism 4 邉ｻ縺ｮ繝｢繝・Ν・・.model3.json` / `.motion3.json`・・* 繧呈Φ螳壹＠縺ｾ縺吶・

### 1) Cubism Core 縺ｮ逕ｨ諢擾ｼ亥ｿ・茨ｼ・

`pixi-live2d-display`・・DN迚茨ｼ峨〒 Cubism 4 繝｢繝・Ν繧呈緒逕ｻ縺吶ｋ縺ｫ縺ｯ `live2dcubismcore.min.js` 縺悟ｿ・ｦ√〒縺吶・

- 蜈ｬ蠑・Cubism SDK for Web 縺九ｉ `live2dcubismcore.min.js` 繧貞叙繧雁・縺励∵ｬ｡縺ｮ蝣ｴ謇縺ｫ驟咲ｽｮ縺励※縺上□縺輔＞:
  - `web/vendor/live2dcubismcore.min.js`

豕ｨ諢・
- 縺薙・繝ｪ繝昴ず繝医Μ縺ｫ縺ｯ Live2D SDK / Core 縺ｯ蜷梧｢ｱ縺励∪縺帙ｓ・医Λ繧､繧ｻ繝ｳ繧ｹ縺ｫ豕ｨ諢擾ｼ峨・

### 2) 繝｢繝・Ν驟咲ｽｮ

`data/stream-studio/web/models/<name>/` 驟堺ｸ九↓繝｢繝・Ν繧帝・鄂ｮ縺励※縺上□縺輔＞・医し繝ｼ繝舌・縺・`/models` 縺ｨ縺励※驟堺ｿ｡縺励∪縺呻ｼ峨・

萓・
- `data/stream-studio/web/models/haru/haru.model3.json`
- `data/stream-studio/web/models/haru/motions/01_greet.motion3.json`

Stage 蛛ｴ縺ｯ繝・ヵ繧ｩ繝ｫ繝医〒谺｡縺ｮURL繧定ｪｭ縺ｿ縺ｫ縺・″縺ｾ縺・
- `/models/<name>/<name>.model3.json`

Console 縺ｮ縲鍬ive2D 繝｢繝・Ν蜷阪阪後Δ繝・Ν繝輔ぃ繧､繝ｫ蜷阪阪〒螟画峩縺ｧ縺阪∪縺呻ｼ・ocalStorage 縺ｫ菫晏ｭ假ｼ峨・

### 3) hotkeys.json

`web/stream-studio/hotkeys.json` 縺ｯ `motion_tags -> motion file path` 縺ｮ霎樊嶌縺ｧ縺吶・

萓・
```json
{
  "greet": "motions/01_greet.motion3.json",
  "smile": "motions/02_smile.motion3.json"
}
```

- 蛟､縺ｯ `.model3.json` 蜀・・ `FileReferences.Motions` 縺ｫ縺ゅｋ `File` 縺ｨ荳閾ｴ縺吶ｋ逶ｸ蟇ｾ繝代せ繧呈耳螂ｨ縺励∪縺吶・

## 繧ｻ繧ｭ繝･繝ｪ繝・ぅ/繝励Λ繧､繝舌す繝ｼ

- 繝悶Λ繧ｦ繧ｶ縺ｯ逕ｻ蜒上ヵ繝ｬ繝ｼ繝・・PEG・峨ｄ繝・く繧ｹ繝医ｒ **繧ｵ繝ｼ繝舌↓騾√ｋ縺縺・* 縺ｧ縺吶・
- Gemini/VLM/TTS 縺ｮ API 繧ｭ繝ｼ遲峨・繝悶Λ繧ｦ繧ｶ縺ｸ髴ｲ蜃ｺ縺励∪縺帙ｓ縲・
- 繧ｵ繝ｼ繝舌・蜿嶺ｿ｡縺励◆繝輔Ξ繝ｼ繝逕ｻ蜒上ｒ菫晏ｭ倥＠縺ｾ縺帙ｓ・郁ｦ∫ｴ・ユ繧ｭ繧ｹ繝医・縺ｿ繝ｭ繧ｰ/遏ｭ譛欒AG縺ｫ蜈･繧翫∪縺呻ｼ峨・
