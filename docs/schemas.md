# Schemas

## Director Output (固定)

LLM（director）は必ず次のJSONを返す想定です:

```json
{
  "text": "発話本文（短文）",
  "emotion": "neutral|happy|angry|sad|surprised|smug|panic",
  "motion_tags": ["smile", "nod", "laugh_small"],
  "reply_to": {"type":"chat|system|manager", "id":"optional"},
  "debug": {"reason":"optional"}
}
```

- `emotion`: 7値の列挙
- `motion_tags`: ルールベースでLive2D操作にマップ

## Motion Tag Routing

`motion_tags` → VTube Studio送信アクション（現状はスタブ）

例:
- `smile` → `hotkey:smile`
- `nod` → `hotkey:nod`
