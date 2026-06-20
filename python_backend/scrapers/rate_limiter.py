from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass


def _bounded_ms(value: object, fallback: int, minimum: int, maximum: int) -> int:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return int(max(minimum, min(number, maximum)))


@dataclass(frozen=True)
class RateLimitPolicy:
    """Normalize scraper pacing values into JS-compatible millisecond contracts."""

    min_delay_ms: object
    jitter_ms: object
    block_cooldown_ms: object

    def to_tieba_options(self) -> dict[str, int]:
        return {
            "minDelayMs": _bounded_ms(self.min_delay_ms, 5000, 0, 60000),
            "jitterMs": _bounded_ms(self.jitter_ms, 3000, 0, 60000),
            "blockCooldownMs": _bounded_ms(self.block_cooldown_ms, 120000, 0, 300000),
        }

    def to_history_tag_options(self) -> dict[str, int]:
        return {
            "delayMs": _bounded_ms(self.min_delay_ms, 5000, 0, 120000),
            "jitterMs": _bounded_ms(self.jitter_ms, 2500, 0, 120000),
        }

    def to_direct_probe_options(self) -> dict[str, int]:
        return {
            "delayMs": _bounded_ms(self.min_delay_ms, 3000, 1000, 60000),
            "jitterMs": _bounded_ms(self.jitter_ms, 1500, 0, 60000),
        }


class RateLimiter:
    """Injectable sleep boundary for slow, platform-friendly scrapers."""

    def __init__(self, delay_seconds: float, sleep: Callable[[float], None] | None = None):
        self.delay_seconds = max(0.0, float(delay_seconds))
        self._sleep = sleep or time.sleep

    def wait(self) -> None:
        if self.delay_seconds > 0:
            self._sleep(self.delay_seconds)
