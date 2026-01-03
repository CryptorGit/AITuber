from __future__ import annotations

from dataclasses import dataclass
from typing import List

import logging


@dataclass
class VTubeStudioClient:
    """VTube Studio integration stub.

    Real implementation will use WebSocket and VTube Studio API.
    """

    ws_url: str

    def send_actions(self, *, actions: List[str], logger: logging.Logger) -> None:
        # Stub: pretend to send.
        for a in actions:
            logger.info("[live2d] send %s -> %s", a, self.ws_url)
