from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class ScreenshotCapturer:
    out_path: Path

    def capture(self) -> Path:
        """Capture the primary monitor to out_path.

        Falls back to creating an empty placeholder if capture libs are unavailable.
        """
        self.out_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            import mss
            from PIL import Image

            with mss.mss() as sct:
                monitor = sct.monitors[1]
                shot = sct.grab(monitor)
                img = Image.frombytes("RGB", shot.size, shot.rgb)
                img.save(self.out_path)
            return self.out_path
        except Exception:
            # placeholder
            self.out_path.write_bytes(b"")
            return self.out_path
