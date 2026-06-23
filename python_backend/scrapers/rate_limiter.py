from __future__ import annotations

import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


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

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None = None) -> "RateLimitPolicy":
        payload = payload if isinstance(payload, dict) else {}
        min_delay_ms = payload.get("minDelayMs", payload.get("delayMs", 5000))
        jitter_ms = payload.get("jitterMs", 3000)
        block_cooldown_ms = payload.get("blockCooldownMs", payload.get("cooldownMs", 120000))
        return cls(min_delay_ms=min_delay_ms, jitter_ms=jitter_ms, block_cooldown_ms=block_cooldown_ms)

    def to_tieba_options(self) -> dict[str, int]:
        return RateLimitOptionsContract(self).options_for("tieba")

    def to_history_tag_options(self) -> dict[str, int]:
        return RateLimitOptionsContract(self).options_for("history-tags")

    def to_direct_probe_options(self) -> dict[str, int]:
        return RateLimitOptionsContract(self).options_for("direct-probe")

    def to_bilibili_crawler_options(self) -> dict[str, int]:
        return RateLimitOptionsContract(self).options_for("bilibili-crawler")


class RateLimitOptionsContract:
    """Build JS-compatible pacing option payloads for each scraper target."""

    _TARGET_SPECS: dict[str, tuple[tuple[str, str, int, int, int], ...]] = {
        "tieba": (
            ("minDelayMs", "min_delay_ms", 5000, 0, 60000),
            ("jitterMs", "jitter_ms", 3000, 0, 60000),
            ("blockCooldownMs", "block_cooldown_ms", 120000, 0, 300000),
        ),
        "history-tags": (
            ("delayMs", "min_delay_ms", 5000, 0, 120000),
            ("jitterMs", "jitter_ms", 2500, 0, 120000),
        ),
        "direct-probe": (
            ("delayMs", "min_delay_ms", 3000, 1000, 60000),
            ("jitterMs", "jitter_ms", 1500, 0, 60000),
        ),
        "bilibili-crawler": (
            ("minDelayMs", "min_delay_ms", 2500, 0, 60000),
            ("jitterMs", "jitter_ms", 2000, 0, 60000),
            ("blockCooldownMs", "block_cooldown_ms", 120000, 0, 300000),
        ),
    }

    def __init__(self, policy: RateLimitPolicy):
        self.policy = policy

    def options_for(self, target: str) -> dict[str, int]:
        spec = self._TARGET_SPECS.get(self._normalize_target(target))
        if spec is None:
            return {}
        return {
            output_key: _bounded_ms(getattr(self.policy, source_attr), fallback, minimum, maximum)
            for output_key, source_attr, fallback, minimum, maximum in spec
        }

    def _normalize_target(self, target: str) -> str:
        return str(target or "").strip().lower().replace("_", "-")


class RateLimiter:
    """Injectable sleep boundary for slow, platform-friendly scrapers."""

    def __init__(self, delay_seconds: float, sleep: Callable[[float], None] | None = None):
        try:
            delay = float(delay_seconds)
        except (TypeError, ValueError):
            delay = 0.0
        if not math.isfinite(delay):
            delay = 0.0
        self.delay_seconds = max(0.0, delay)
        self._sleep = sleep or time.sleep

    def wait(self) -> None:
        if self.delay_seconds > 0:
            self._sleep(self.delay_seconds)
