from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class VTubeStudioWS:
    ws_url: str
    auth_token: str
    plugin_name: str
    plugin_developer: str

    async def trigger_hotkey(self, *, hotkey_id: str) -> Dict[str, Any]:
        """Trigger a VTube Studio hotkey by ID.

        If auth_token is missing, the call will be skipped gracefully.
        """
        if not hotkey_id:
            return {"ok": False, "error": "missing_hotkey_id"}
        if not (self.auth_token or "").strip():
            return {"ok": False, "error": "missing_auth_token"}

        try:
            import websockets

            req_id = str(uuid.uuid4())
            payload = {
                "apiName": "VTubeStudioPublicAPI",
                "apiVersion": "1.0",
                "requestID": req_id,
                "messageType": "HotkeyTriggerRequest",
                "data": {
                    "hotkeyID": hotkey_id,
                    "authenticationToken": self.auth_token,
                },
            }

            async with websockets.connect(self.ws_url) as ws:
                await ws.send(json.dumps(payload))
                raw = await ws.recv()
                resp = json.loads(raw)
                return {"ok": True, "response": resp}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    async def list_hotkeys(self) -> Dict[str, Any]:
        """List hotkeys for the current model.

        Best-effort: if VTube Studio isn't reachable, returns an error dict.
        """
        try:
            import websockets

            req_id = str(uuid.uuid4())
            payload = {
                "apiName": "VTubeStudioPublicAPI",
                "apiVersion": "1.0",
                "requestID": req_id,
                "messageType": "HotkeysInCurrentModelRequest",
                "data": {},
            }

            async with websockets.connect(self.ws_url) as ws:
                await ws.send(json.dumps(payload))
                raw = await ws.recv()
                resp = json.loads(raw)
                return {"ok": True, "response": resp}
        except Exception as e:
            return {"ok": False, "error": str(e)}
