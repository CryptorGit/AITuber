# AITuber

縺薙・繝励Ο繧ｸ繧ｧ繧ｯ繝医・ **驟堺ｿ｡縺ｮ荳ｻ蠖ｹAI・・LM + RAG(遏ｭ譛・髟ｷ譛・ + VLM(繧ｹ繧ｯ繧ｷ繝ｧ隕∫ｴ・ + TTS + Live2D/VTube Studio + OBS繝・Ο繝・・ + Manager謇ｿ隱搾ｼ・* 繧貞虚縺九☆縺溘ａ縺ｮ蝓ｺ逶､縺ｧ縺吶・

**繧ｲ繝ｼ繝縲√お繝溘Η繝ｬ繝ｼ繧ｿ縲。izHawk縲ヽL/蟄ｦ鄙偵√ユ繝ｬ繝｡繝医Μ遲峨・謇ｱ縺・∪縺帙ｓ縲・*

## Quickstart

```powershell
# 萓晏ｭ伜ｰ主・ + .env 菴懈・ + 繧ｵ繝ｼ繝占ｵｷ蜍・
.\scripts\run_dev.ps1

# 繧ｵ繝ｼ繝舌ｒ縺ｾ縺ｨ繧√※襍ｷ蜍包ｼ・emini + Google TTS・・
.\scripts\run_stack.ps1

# 繝悶Λ繧ｦ繧ｶ: Web UI
# - http://127.0.0.1:8000/console (邂｡逅・判髱｢)
# - http://127.0.0.1:8000/stage (OBS Browser Source蜷代￠)

# Google TTS 逍朱夂｢ｺ隱搾ｼ郁ｪ崎ｨｼ/讓ｩ髯撰ｼ・
Invoke-RestMethod http://127.0.0.1:8000/tts/health

# 蛻･繧ｿ繝ｼ繝溘リ繝ｫ縺ｧ縲√せ繧ｿ繝門・蜉帚・謇ｿ隱坂・OBS/TTS/Live2D 縺ｾ縺ｧ騾壹☆・・LI莠呈鋤・・
.\scripts\demo_stub.ps1
```

## Perf / 險域ｸｬ

- 繧ｵ繝ｼ繝・ `data/stream-studio/events.jsonl` 縺ｫ `type=timing` 縺瑚ｿｽ險倥＆繧後∪縺呻ｼ亥酔荳 `request_id` 縺ｧ逶ｸ髢｢・・
- 繝悶Λ繧ｦ繧ｶ console: `[aituber/perf]` 縺悟・縺ｾ縺呻ｼ磯∽ｿ｡竊貞ｭ怜ｹ募渚譏縲・浹螢ｰ蜀咲函髢句ｧ九↑縺ｩ・・

## Docs

- [docs/stream-studio/overview.md](docs/stream-studio/overview.md)
- [docs/stream-studio/runbook.md](docs/stream-studio/runbook.md)
- [docs/stream-studio/ARCHITECTURE.md](docs/stream-studio/ARCHITECTURE.md)
- [docs/stream-studio/schemas.md](docs/stream-studio/schemas.md)
- [docs/stream-studio/ROADMAP.md](docs/stream-studio/ROADMAP.md)
