from __future__ import annotations

import math
import re
import html
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


class ReadmeStatsSvgRenderer:
    """Render README stats SVGs from Python-built stats JSON contracts."""

    def render_summary_svg(self, stats: dict[str, Any]) -> str:
        max_value = max(int(_number(stats.get("comments"))), int(_number(stats.get("danmaku"))), int(_number(stats.get("keywordTerms"))), 1)
        updated = self._date_label(stats.get("generatedAt"))
        return f"""<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430" viewBox="0 0 920 430" role="img" aria-labelledby="title desc">
  <title id="title">Bilibili User Personality data collection and keyword analysis stats</title>
  <desc id="desc">Current counts for collected comments, danmaku, and analyzed dictionary keywords.</desc>
  <style>
    .bg {{ fill: #f7f0df; }}
    .panel {{ fill: #fffaf0; stroke: #27231c; stroke-width: 2; }}
    .title {{ font: 700 28px Georgia, 'Times New Roman', serif; fill: #27231c; }}
    .sub {{ font: 14px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .label {{ font: 700 18px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }}
    .value {{ font: 700 18px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; text-anchor: start; }}
    .small {{ font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #5d5548; }}
    .metric {{ font: 700 26px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }}
  </style>
  <rect class="bg" width="920" height="430" rx="24"/>
  <rect class="panel" x="18" y="18" width="884" height="394" rx="20"/>
  <text x="40" y="62" class="title">Corpus Collection + Keyword Analysis</text>
  <text x="40" y="88" class="sub">auto-generated from repo data on {self._escape(updated)}</text>
  <g>
    <rect x="40" y="112" width="250" height="82" rx="16" fill="#eadfca" stroke="#27231c"/>
    <text x="62" y="146" class="small">comments / replies</text>
    <text x="62" y="177" class="metric">{self._format_number(stats.get("comments"))}</text>
    <rect x="318" y="112" width="250" height="82" rx="16" fill="#dbe8df" stroke="#27231c"/>
    <text x="340" y="146" class="small">danmaku</text>
    <text x="340" y="177" class="metric">{self._format_number(stats.get("danmaku"))}</text>
    <rect x="596" y="112" width="250" height="82" rx="16" fill="#e5d7bc" stroke="#27231c"/>
    <text x="618" y="146" class="small">keyword terms analyzed</text>
    <text x="618" y="177" class="metric">{self._format_number(stats.get("keywordTerms"))}</text>
  </g>
  <g>
    {self._bar_row("Comments", stats.get("comments"), "#8c5f32", 246, max_value)}
    {self._bar_row("Danmaku", stats.get("danmaku"), "#3f7558", 292, max_value)}
    {self._bar_row("Keywords", stats.get("keywordTerms"), "#b98522", 338, max_value)}
  </g>
  <text x="40" y="382" class="small">Coverage: {self._escape(stats.get("coverageRatioLabel") or "0.00%")} | Weak terms: {self._format_number(stats.get("weakTerms"))} | Evidence deficit: {self._format_number(stats.get("evidenceDeficit"))}</text>
</svg>
"""

    def render_timeline_svg(self, timeline: dict[str, Any], generated_at: Any) -> str:
        points = timeline.get("points") if isinstance(timeline.get("points"), list) else []
        observed_max = max([_number(point.get("total")) for point in points if isinstance(point, dict)] + [_number(timeline.get("finalTotal")), 1])
        max_value = self.padded_timeline_max(observed_max)
        x0, y0, width, height = 72, 126, 748, 196
        updated = self._date_label(generated_at)
        first_date = self._timeline_date(points[0].get("date")) if points else "n/a"
        last_date = self._timeline_date(points[-1].get("date")) if points else "n/a"
        grid_rows = "\n".join(
            self._grid_row(ratio, max_value, x0, y0, width, height)
            for ratio in (0, 0.25, 0.5, 0.75, 1)
        )
        return f"""<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430" viewBox="0 0 920 430" role="img" aria-labelledby="timeline-title timeline-desc">
  <title id="timeline-title">Comment and danmaku collection growth over time</title>
  <desc id="timeline-desc">Cumulative growth lines for total corpus records, comments, and danmaku across recorded harvest runs.</desc>
  <style>
    .bg {{ fill: #f3ead8; }}
    .panel {{ fill: #fffaf0; stroke: #27231c; stroke-width: 2; }}
    .title {{ font: 700 28px Georgia, 'Times New Roman', serif; fill: #27231c; }}
    .sub {{ font: 14px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .axis {{ font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .label {{ font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #5d5548; }}
  </style>
  <rect class="bg" width="920" height="430" rx="24"/>
  <rect class="panel" x="18" y="18" width="884" height="394" rx="20"/>
  <text x="40" y="62" class="title">Corpus Growth Over Time</text>
  <text x="40" y="88" class="sub">auto-generated from corpus run history on {self._escape(updated)}</text>
  <g>
{grid_rows}
    <line x1="{x0}" y1="{y0 + height}" x2="{x0 + width}" y2="{y0 + height}" stroke="#27231c" stroke-width="2"/>
    <line x1="{x0}" y1="{y0}" x2="{x0}" y2="{y0 + height}" stroke="#27231c" stroke-width="2"/>
    <polyline points="{self._polyline(points, "total", max_value, x0, y0, width, height)}" fill="none" stroke="#27231c" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="{self._polyline(points, "comments", max_value, x0, y0, width, height)}" fill="none" stroke="#8c5f32" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="{self._polyline(points, "danmaku", max_value, x0, y0, width, height)}" fill="none" stroke="#3f7558" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="{x0}" y="{y0 + height + 26}" class="axis">{self._escape(first_date)}</text>
    <text x="{x0 + width}" y="{y0 + height + 26}" class="axis" text-anchor="end">{self._escape(last_date)}</text>
  </g>
  <g>
    <rect x="72" y="360" width="16" height="16" rx="3" fill="#27231c"/><text x="96" y="373" class="label">Total {self._format_number(timeline.get("finalTotal"))}</text>
    <rect x="254" y="360" width="16" height="16" rx="3" fill="#8c5f32"/><text x="278" y="373" class="label">Comments {self._format_number(timeline.get("finalComments"))}</text>
    <rect x="476" y="360" width="16" height="16" rx="3" fill="#3f7558"/><text x="500" y="373" class="label">Danmaku {self._format_number(timeline.get("finalDanmaku"))}</text>
    <text x="720" y="373" class="label">Runs: {self._format_number(len(points))}</text>
  </g>
</svg>
"""

    def padded_timeline_max(self, value: Any) -> int | float:
        return ReadmeStatsBuilder().padded_timeline_max(value)

    def _bar_row(self, label: str, value: Any, color: str, y: int, max_value: int) -> str:
        number = int(_number(value))
        width = max(2, round((number / max_value) * 440)) if max_value > 0 else 2
        return f"""
    <text x="40" y="{y}" class="label">{self._escape(label)}</text>
    <rect x="220" y="{y - 18}" width="440" height="24" rx="12" fill="#e8e1d2"/>
    <rect x="220" y="{y - 18}" width="{width}" height="24" rx="12" fill="{color}"/>
    <text x="680" y="{y}" class="value">{self._format_number(number)}</text>"""

    def _grid_row(self, ratio: float, max_value: Any, x0: int, y0: int, width: int, height: int) -> str:
        y = y0 + height - (ratio * height)
        return f"""    <line x1="{x0}" y1="{y:.1f}" x2="{x0 + width}" y2="{y:.1f}" stroke="#d7ccb8" stroke-width="1"/>
    <text x="58" y="{y + 4:.1f}" class="axis" text-anchor="end">{self._format_number(round(_number(max_value) * ratio))}</text>"""

    def _polyline(self, points: list[dict[str, Any]], value_key: str, max_value: Any, x0: int, y0: int, width: int, height: int) -> str:
        if not points:
            return ""
        max_number = max(1, _number(max_value))

        def y_for_value(value: Any) -> float:
            ratio = max(0.0, min(1.0, _number(value) / max_number))
            return y0 + height - (ratio * height)

        if len(points) == 1:
            y = y_for_value(points[0].get(value_key))
            return f"{x0},{y:.1f} {x0 + width},{y:.1f}"
        values = []
        for index, point in enumerate(points):
            x = x0 + ((index / (len(points) - 1)) * width)
            y = y_for_value(point.get(value_key))
            values.append(f"{x:.1f},{y:.1f}")
        return " ".join(values)

    def _format_number(self, value: Any) -> str:
        return f"{int(_number(value)):,}"

    def _date_label(self, value: Any) -> str:
        valid = ReadmeStatsBuilder()._valid_date(value)
        return valid[:10] if valid else "n/a"

    def _timeline_date(self, value: Any) -> str:
        valid = ReadmeStatsBuilder()._valid_date(value)
        return valid[5:16].replace("T", " ") if valid else "n/a"

    def _escape(self, value: Any) -> str:
        return html.escape(str(value), quote=True)
