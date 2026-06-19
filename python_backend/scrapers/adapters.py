from __future__ import annotations

from dataclasses import dataclass

from .rate_limiter import RateLimiter


@dataclass(frozen=True)
class ScrapeRequest:
    query: str
    limit: int = 20
    source: str = "bilibili"


class ScraperAdapter:
    """Base adapter boundary for metadata/comment scrapers."""

    def __init__(self, rate_limiter: RateLimiter):
        self.rate_limiter = rate_limiter

    def build_metadata_request(self, request: ScrapeRequest) -> dict[str, object]:
        return {
            "source": request.source,
            "query": request.query,
            "limit": max(1, int(request.limit)),
        }
