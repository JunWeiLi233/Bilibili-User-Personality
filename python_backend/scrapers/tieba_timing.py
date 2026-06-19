from __future__ import annotations

from typing import Any


def _js_number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class TiebaScrapeTiming:
    """Compute Tieba scraper timing budgets using the JS scrape-run contract."""

    def compute_hard_stop_ms(self, options: dict[str, Any] | None = None) -> int:
        options = options or {}
        max_queries = max(1, _js_number(options.get("maxQueries")) or 1)
        overall_timeout_ms = max(0, _js_number(options.get("overallTimeoutMs")) or 0)
        block_cooldown_ms = max(0, _js_number(options.get("blockCooldownMs")) or 0)
        hard_stop = max((overall_timeout_ms + block_cooldown_ms) * max_queries + 10000, overall_timeout_ms + 10000)
        return int(hard_stop)
