# labeler-loop (骭ｲ髻ｳ竊担TT竊貞呵｣・竊帝∈謚樞・菫晏ｭ・

縺薙・繧ｵ繝悶い繝励Μ縺ｯ縲碁鹸髻ｳ繝懊ち繝ｳ荳ｭ蠢・・繝・・繧ｿ蜿朱寔Web繧ｵ繝ｼ繝舌阪〒縺吶・

- AITuber 譛ｬ菴薙→縺ｯ蛻・屬縺励※ `apps/labeler-loop/` 縺ｫ驟咲ｽｮ縺励※縺・∪縺・
- 遘伜ｯ・ュ蝣ｱ縺ｯ繧ｳ繝溘ャ繝医＠縺ｾ縺帙ｓ・・.env/` 縺・gitignored・・
- 蜷・ち繝ｼ繝ｳ縺ｧ縲悟呵｣・縺､縲阪悟享縺｡1縺､縲阪瑚ｲ縺・縺､縲阪ｒ JSONL 縺ｧ蠢・★菫晏ｭ倥＠縺ｾ縺・

## 讒区・

- 繧ｵ繝ｼ繝・ `apps/labeler-loop/app.py`・・astAPI・・
- UI: `web/labeler-loop/`・・逕ｻ髱｢・・
- 繝・・繧ｿ: `data/labeler-loop/`・・labels.jsonl`, 髻ｳ螢ｰ繝輔ぃ繧､繝ｫ遲会ｼ・

## 蜑肴署

- Python 3.10+・域耳螂ｨ 3.11 / 3.13 縺ｧ繧ょ庄・・
- ffmpeg・磯浹螢ｰ繧・`wav (Linear16, 16kHz, mono)` 縺ｫ螟画鋤縺吶ｋ縺溘ａ蠢・茨ｼ・
- Google Cloud 隱崎ｨｼ・・peech-to-Text・・
- Gemini API Key・亥呵｣懃函謌撰ｼ・

### ffmpeg (Windows)

- winget: `winget install Gyan.FFmpeg`
- 縺ｾ縺溘・ Chocolatey: `choco install ffmpeg`

繧､繝ｳ繧ｹ繝医・繝ｫ蠕後～ffmpeg -version` 縺碁壹ｋ縺薙→繧堤｢ｺ隱阪＠縺ｦ縺上□縺輔＞縲・

PATH 繧偵＞縺倥ｊ縺溘￥縺ｪ縺・ｴ蜷医・縲～.env/.env.labeler-loop` 縺ｫ `FFMPEG_PATH`・・ffmpeg.exe` 縺ｮ繝輔Ν繝代せ・峨ｒ險ｭ螳壹〒縺阪∪縺吶・

## 繧ｻ繝・ヨ繧｢繝・・

縺薙・繝ｪ繝昴ず繝医Μ縺ｯ萓晏ｭ倥ｒ繝ｫ繝ｼ繝医・ [requirements.txt](requirements.txt) 縺ｫ邨ｱ蜷医＠縺ｦ縺・∪縺吶・

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 迺ｰ蠅・､画焚・・env・・

`.env/.env.labeler-loop` 繧剃ｽ懈・縺励※蛟､繧貞・繧後※縺上□縺輔＞縲・

- `GOOGLE_APPLICATION_CREDENTIALS` : Speech-to-Text 逕ｨ縺ｮ繧ｵ繝ｼ繝薙せ繧｢繧ｫ繧ｦ繝ｳ繝・SON縺ｸ縺ｮ繝代せ
- `GEMINI_API_KEY` : Gemini 縺ｮ API 繧ｭ繝ｼ・・oogle AI Studio 遲会ｼ・
- `FFMPEG_PATH` : 莉ｻ諢擾ｼ・ffmpeg.exe` 縺ｮ繝輔Ν繝代せ・・

## 襍ｷ蜍・

```powershell
cd C:\Users\crypt\source\repos\CryptorGit\AITuber
$env:PYTHONUTF8 = "1"
.\.venv\Scripts\python.exe -m uvicorn app:app --app-dir "C:\Users\crypt\source\repos\CryptorGit\AITuber\apps\labeler-loop" --reload --host 127.0.0.1 --port 7861
```

繝悶Λ繧ｦ繧ｶ縺ｧ `http://127.0.0.1:7861/` 繧帝幕縺阪∪縺吶・

## 謇句虚繝・せ繝域焔鬆・ｼ・縺､・・

1) 骭ｲ髻ｳ竊担TT竊貞呵｣懌・驕ｸ謚樞・菫晏ｭ倥′1蝗樣壹ｋ
- [骭ｲ髻ｳ髢句ｧ犠竊定ｩｱ縺吮・[骭ｲ髻ｳ蛛懈ｭ｢]
- STT縺後ユ繧ｭ繧ｹ繝医・繝・け繧ｹ縺ｫ蜃ｺ繧・
- 蛟呵｣懊′5縺､蜃ｺ繧・
- 1縺､驕ｸ繧薙〒[騾∽ｿ｡]
- `data/labeler-loop/labels.jsonl` 縺ｫ1陦悟｢励∴繧・

2) 騾｣邯壹〒5繧ｿ繝ｼ繝ｳ蝗槭＠縺ｦ labels.jsonl 縺悟｢励∴繧・
- 荳翫ｒ5蝗樒ｹｰ繧願ｿ斐☆
- `labels.jsonl` 縺ｮ陦梧焚縺・蠅励∴繧・
- 蜷・｡後↓ candidates(5) 縺ｨ winner_index 縺後≠繧・

3) JSON蟠ｩ繧・髻ｳ螢ｰ螟画鋤螟ｱ謨玲凾縺ｫUI縺ｫ繧ｨ繝ｩ繝ｼ縺悟・縺ｦ菫晏ｭ倥＆繧後↑縺・
- `ffmpeg` 繧単ATH縺九ｉ螟悶☆・医∪縺溘・蟄伜惠縺励↑縺・憾諷九〒襍ｷ蜍包ｼ俄・骭ｲ髻ｳ蛛懈ｭ｢
- UI縺ｫ繧ｨ繝ｩ繝ｼ縺悟・縺ｦ candidates 縺悟・縺ｪ縺・
- [騾∽ｿ｡]縺励※繧ゆｿ晏ｭ倥＆繧後↑縺・ｼ・labels.jsonl` 縺悟｢励∴縺ｪ縺・ｼ・
