from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class AnalyzerRequest:
    comments: list[str]
    keyword_hints: list[str] = field(default_factory=list)
    model: str = "deepseek-v4-flash"
    effort: str = "max"


class DeepSeekAnalyzerClient:
    """Payload builder for a future Python-owned analyzer client."""

    def build_payload(self, request: AnalyzerRequest) -> dict[str, object]:
        return {
            "model": request.model,
            "effort": request.effort,
            "comments": list(request.comments),
            "keyword_hints": list(request.keyword_hints),
        }
