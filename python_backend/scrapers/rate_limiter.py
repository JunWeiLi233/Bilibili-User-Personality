from __future__ import annotations

import time
from collections.abc import Callable


class RateLimiter:
    """Injectable sleep boundary for slow, platform-friendly scrapers."""

    def __init__(self, delay_seconds: float, sleep: Callable[[float], None] | None = None):
        self.delay_seconds = max(0.0, float(delay_seconds))
        self._sleep = sleep or time.sleep

    def wait(self) -> None:
        if self.delay_seconds > 0:
            self._sleep(self.delay_seconds)
