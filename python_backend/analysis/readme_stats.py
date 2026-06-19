from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Callable


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _json_number(value: float) -> int | float:
    return int(value) if float(value).is_integer() else value


class ReadmeStatsBuilder:
    """Build README data-growth stats from JS-compatible corpus JSON payloads."""

    def __init__(self, now: Callable[[], str] | None = None):
        self.now = now or self._iso_now

    def unique_comments(self, comments: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for record in comments if isinstance(comments, list) else []:
            if not isinstance(record, dict) or not self._has_han_text(record.get("message")):
                continue
            key = "\n".join(
                [
                    _clean_text(record.get("platform")),
                    _clean_text(record.get("sourceUrl") or record.get("source")),
                    _clean_text(record.get("message")),
                ]
            )
            if key in seen:
                continue
            seen.add(key)
            unique.append(record)
        return unique

    def summarize_corpus(self, name: str, comments: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        unique = self.unique_comments(comments)
        danmaku = [record for record in unique if self.is_danmaku_record(record)]
        return {
            "name": name,
            "total": len(unique),
            "comments": len(unique) - len(danmaku),
            "danmaku": len(danmaku),
        }

    def build_collection_timeline(self, sources: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        events: list[dict[str, Any]] = []
        final_comments = 0
        final_danmaku = 0

        for source in sources if isinstance(sources, list) else []:
            if not isinstance(source, dict):
                continue
            unique = self.unique_comments(source.get("comments") if isinstance(source.get("comments"), list) else [])
            danmaku_count = len([record for record in unique if self.is_danmaku_record(record)])
            comment_count = max(0, len(unique) - danmaku_count)
            total = max(1, len(unique))
            danmaku_ratio = danmaku_count / total
            final_comments += comment_count
            final_danmaku += danmaku_count

            for run in source.get("runs") if isinstance(source.get("runs"), list) else []:
                if not isinstance(run, dict):
                    continue
                date = self._valid_date(run.get("at"))
                added = self._run_added_count(run)
                if not date or added <= 0:
                    continue
                danmaku = min(added, max(0, self._js_round(added * danmaku_ratio)))
                events.append(
                    {
                        "date": date,
                        "source": source.get("name") or "corpus",
                        "added": _json_number(added),
                        "comments": _json_number(added - danmaku),
                        "danmaku": _json_number(danmaku),
                    }
                )

        events.sort(key=lambda event: self._timestamp(event["date"]))

        comments = 0.0
        danmaku = 0.0
        points: list[dict[str, Any]] = []
        for event in events:
            comments += _number(event.get("comments"))
            danmaku += _number(event.get("danmaku"))
            points.append(
                {
                    "date": event["date"],
                    "source": event["source"],
                    "added": event["added"],
                    "comments": _json_number(comments),
                    "danmaku": _json_number(danmaku),
                    "total": _json_number(comments + danmaku),
                }
            )

        if points:
            last = points[-1]
            if last["comments"] != final_comments or last["danmaku"] != final_danmaku:
                comment_scale = final_comments / last["comments"] if _number(last["comments"]) > 0 else 0
                danmaku_scale = final_danmaku / last["danmaku"] if _number(last["danmaku"]) > 0 else 0
                previous_comments = 0
                previous_danmaku = 0
                scaled_points: list[dict[str, Any]] = []
                for index, point in enumerate(points):
                    is_last = index == len(points) - 1
                    scaled_comments = (
                        final_comments
                        if is_last
                        else min(final_comments, max(previous_comments, self._js_round(_number(point["comments"]) * comment_scale)))
                    )
                    scaled_danmaku = (
                        final_danmaku
                        if is_last
                        else min(final_danmaku, max(previous_danmaku, self._js_round(_number(point["danmaku"]) * danmaku_scale)))
                    )
                    previous_comments = scaled_comments
                    previous_danmaku = scaled_danmaku
                    scaled_points.append(
                        {
                            **point,
                            "comments": _json_number(scaled_comments),
                            "danmaku": _json_number(scaled_danmaku),
                            "total": _json_number(scaled_comments + scaled_danmaku),
                        }
                    )
                points = scaled_points
        elif final_comments > 0 or final_danmaku > 0:
            points.append(
                {
                    "date": self.now(),
                    "source": "current corpus",
                    "added": final_comments + final_danmaku,
                    "comments": final_comments,
                    "danmaku": final_danmaku,
                    "total": final_comments + final_danmaku,
                }
            )

        return {
            "finalComments": final_comments,
            "finalDanmaku": final_danmaku,
            "finalTotal": final_comments + final_danmaku,
            "points": points,
        }

    def build_stats(
        self,
        sources: list[dict[str, Any]] | None = None,
        dictionary: dict[str, Any] | None = None,
        coverage: dict[str, Any] | None = None,
        generated_at: str | None = None,
    ) -> dict[str, Any]:
        sources = sources if isinstance(sources, list) else []
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        coverage = coverage if isinstance(coverage, dict) else {}
        summaries = [self.summarize_corpus(str(source.get("name") or ""), source.get("comments")) for source in sources if isinstance(source, dict)]
        timeline = self.build_collection_timeline(sources)
        coverage_payload = coverage.get("coverage") if isinstance(coverage.get("coverage"), dict) else coverage
        coverage_ratio = _number(coverage_payload.get("coverageRatio"))
        entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        return {
            "generatedAt": generated_at or self.now(),
            "comments": sum(int(source["comments"]) for source in summaries),
            "danmaku": sum(int(source["danmaku"]) for source in summaries),
            "keywordTerms": len(entries),
            "coverageRatio": coverage_ratio,
            "coverageRatioLabel": f"{coverage_ratio * 100:.2f}%",
            "weakTerms": _json_number(_number(coverage_payload.get("weakTerms"))),
            "evidenceDeficit": _json_number(_number(coverage_payload.get("evidenceDeficit"))),
            "sources": summaries,
            "timeline": timeline,
        }

    def padded_timeline_max(self, value: Any) -> int | float:
        raw = max(1.0, _number(value) or 1.0)
        padded = raw * 1.08
        magnitude = 10 ** max(0, math.floor(math.log10(padded)) - 1)
        return _json_number(math.ceil(padded / magnitude) * magnitude)

    def is_danmaku_record(self, record: dict[str, Any] | None = None) -> bool:
        record = record or {}
        text = " ".join(
            [
                _clean_text(record.get("platform")),
                _clean_text(record.get("source")),
                _clean_text(record.get("sourceKind")),
                _clean_text(record.get("type")),
                _clean_text(record.get("file")),
            ]
        )
        return bool(re.search(r"danmaku", text, re.IGNORECASE))

    def _has_han_text(self, value: Any) -> bool:
        return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))

    def _run_added_count(self, run: dict[str, Any]) -> float:
        for key in ("commentsAdded", "addedComments", "commentsCollected", "importedRows"):
            if run.get(key) is not None:
                value = _number(run.get(key))
                return value if value > 0 else 0
        return 0

    def _valid_date(self, value: Any) -> str | None:
        try:
            text = str(value or "").strip()
            if not text:
                return None
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except ValueError:
            return None

    def _timestamp(self, value: str) -> float:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.timestamp()

    def _js_round(self, value: float) -> int:
        return math.floor(value + 0.5)

    def _iso_now(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
