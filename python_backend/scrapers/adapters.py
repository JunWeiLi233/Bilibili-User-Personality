from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .rate_limiter import RateLimiter, RateLimitOptionsContract, RateLimitPolicy


def _coerce_limit(value: Any, default: int = 20) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _rate_limit_target(source: str) -> str:
    normalized = str(source or "").strip().lower().replace("_", "-")
    return {
        "bilibili": "bilibili-crawler",
        "bilibili-crawler": "bilibili-crawler",
        "direct-probe": "direct-probe",
        "history-tags": "history-tags",
        "tieba": "tieba",
    }.get(normalized, normalized)


@dataclass(frozen=True)
class ScrapeRequest:
    query: str
    limit: int = 20
    source: str = "bilibili"
    rate_limit: dict[str, int] | None = None

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None = None) -> "ScrapeRequest":
        payload = payload if isinstance(payload, dict) else {}
        query = str(payload.get("query", payload.get("keyword", "")))
        source = str(payload.get("source", "bilibili")).strip().lower().replace("_", "-")
        limit = _coerce_limit(payload.get("limit", payload.get("pageSize", 20)))
        rate_limit = None
        if any(key in payload for key in ("minDelayMs", "delayMs", "jitterMs", "blockCooldownMs", "cooldownMs")):
            rate_limit = RateLimitOptionsContract(RateLimitPolicy.from_payload(payload)).options_for(_rate_limit_target(source))
        return cls(query=query, limit=limit, source=source, rate_limit=rate_limit)


class ScraperAdapter:
    """Base adapter boundary for metadata/comment scrapers."""

    def __init__(self, rate_limiter: RateLimiter):
        self.rate_limiter = rate_limiter

    def build_metadata_request(self, request: ScrapeRequest) -> dict[str, object]:
        result: dict[str, object] = {
            "source": request.source,
            "query": request.query,
            "limit": max(1, _coerce_limit(request.limit)),
        }
        if request.rate_limit:
            result["rateLimit"] = request.rate_limit
        return result

    def build_metadata_request_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, object]:
        self.rate_limiter.wait()
        return self.build_metadata_request(ScrapeRequest.from_payload(payload))
