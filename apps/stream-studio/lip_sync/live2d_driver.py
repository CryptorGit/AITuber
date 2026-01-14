from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Protocol

from .curve import LipSyncCurve


class ILive2DParameterSink(Protocol):
    """Abstract sink to set Live2D parameters each frame."""

    def set_parameter(self, *, param_id: str, value: float) -> None:
        raise NotImplementedError

    def list_parameters(self) -> list[str]:
        raise NotImplementedError


@dataclass
class Live2DParamMap:
    mouth_open_y: str = "ParamMouthOpenY"
    mouth_form: str = "ParamMouthForm"
    mouth_smile: str = "ParamMouthSmile"


@dataclass
class Live2DLipSyncDriver:
    """Samples LipSyncCurve by the audio clock and applies it to Live2D params."""

    sink: ILive2DParameterSink
    mapping: Live2DParamMap
    enabled: bool = True

    def _resolve(self) -> Dict[str, Optional[str]]:
        ids = set(self.sink.list_parameters() or [])

        def pick(candidates: list[str]) -> Optional[str]:
            for c in candidates:
                if c in ids:
                    return c
            return None

        # Allow common aliases
        mouth_open = pick([self.mapping.mouth_open_y, "ParamMouthOpen", "MouthOpen", "MouthOpenY"])
        mouth_form = pick([self.mapping.mouth_form, "ParamMouthForm", "MouthForm"])
        smile = pick([self.mapping.mouth_smile, "ParamMouthSmile", "MouthSmile"])
        return {"mouth_open": mouth_open, "mouth_form": mouth_form, "smile": smile}

    def apply(self, *, curve: LipSyncCurve, t_ms: float) -> None:
        if not self.enabled:
            return
        resolved = self._resolve()
        sample = curve.sample(t_ms)
        if resolved.get("mouth_open"):
            self.sink.set_parameter(param_id=resolved["mouth_open"] or "", value=float(sample.get("mouth_open", 0.0)))
        if resolved.get("mouth_form"):
            self.sink.set_parameter(param_id=resolved["mouth_form"] or "", value=float(sample.get("mouth_form", 0.0)))
        if resolved.get("smile"):
            self.sink.set_parameter(param_id=resolved["smile"] or "", value=float(sample.get("smile", 0.0)))
