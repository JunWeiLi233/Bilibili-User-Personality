from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .rate_limiter import RateLimiter


def _coerce_limit(value: Any, default: int = 20) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class ScrapeRequest:
    query: str
    limit: int = 20
    source: str = "bilibili"

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None = None) -> "ScrapeRequest":
        payload = payload if isinstance(payload, dict) else {}
        query = str(payload.get("query", payload.get("keyword", "")))
        source = str(payload.get("source", "bilibili"))
        limit = _coerce_limit(payload.get("limit", payload.get("pageSize", 20)))
        return cls(query=query, limit=limit, source=source)


class ScraperAdapter:
    """Base adapter boundary for metadata/comment scrapers."""

    def __init__(self, rate_limiter: RateLimiter):
        self.rate_limiter = rate_limiter

    def build_metadata_request(self, request: ScrapeRequest) -> dict[str, object]:
        return {
            "source": request.source,
            "query": request.query,
            "limit": max(1, _coerce_limit(request.limit)),
        }

    def build_metadata_request_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, object]:
        self.rate_limiter.wait()
        return self.build_metadata_request(ScrapeRequest.from_payload(payload))
