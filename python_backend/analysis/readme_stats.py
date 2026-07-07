from __future__ import annotations

import argparse
import json
import math
import re
import html
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


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

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        generated_at = str(payload["generatedAt"]) if payload.get("generatedAt") else None
        builder = ReadmeStatsBuilder(now=(lambda: generated_at) if generated_at else self.now)
        sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        coverage = payload.get("coverage") if isinstance(payload.get("coverage"), dict) else {}
        stats = builder.build_stats(sources, dictionary, coverage, generated_at=generated_at)
        renderer = ReadmeStatsSvgRenderer()
        return {
            "ok": True,
            "stats": stats,
            "svg": renderer.render_summary_svg(stats),
            "timelineSvg": renderer.render_timeline_svg(stats["timeline"], stats["generatedAt"]),
            "summary": {
                "comments": stats["comments"],
                "danmaku": stats["danmaku"],
                "keywordTerms": stats["keywordTerms"],
                "timelinePoints": len(stats["timeline"]["points"]),
            },
        }

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


class ReadmeStatsSummary:
    """Shape README stats output into the JS/Python comparator contract."""

    RESULT_KEYS = ("ok", "summary", "stats", "svg", "timelineSvg")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class ReadmeStatsContractComparator:
    """Compare README stats payloads using the JS/Python JSON result contract."""

    def __init__(self, summary: ReadmeStatsSummary | None = None):
        self.summary = summary or ReadmeStatsSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }


class ReadmeStatsRunner:
    """Build README stats and timeline JSON from a compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return ReadmeStatsBuilder().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class ReadmeStatsPayloadContractComparator:
    """Compare Python README stats output against a saved JS-compatible report."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = ReadmeStatsSummary()
        self.comparator = ReadmeStatsContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = ReadmeStatsRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class ReadmeStatsRequest:
    """Analysis-layer request for README stats JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return ReadmeStatsPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return ReadmeStatsRunner(self.payload_path).run()


class ReadmeStatsCommandRequest:
    """Argv-backed analysis-layer request for README stats contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build README stats and timeline JSON from a payload.")
        parser.add_argument("--payload", default="", help="Path to README stats payload JSON. Omit to update repo stats artifacts.")
        parser.add_argument("--root", default=".", help="Repository root for no-payload stats artifact updates.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible README stats report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if not args.payload:
            if args.compare_js_report:
                return {"ok": False, "error": "--compare-js-report requires --payload"}
            return ReadmeStatsRepositoryUpdater(root=args.root).run()
        return ReadmeStatsRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


class ReadmeStatsRepositoryUpdater:
    """Update README stats graph artifacts directly from repository JSON contracts."""

    START_MARKER = "<!-- stats-graph:start -->"
    END_MARKER = "<!-- stats-graph:end -->"

    def __init__(self, root: str | Path = ".", now: Callable[[], str] | None = None):
        self.root = Path(root)
        self.builder = ReadmeStatsBuilder(now=now)
        self.renderer = ReadmeStatsSvgRenderer()

    def run(self) -> dict[str, Any]:
        payload = self._payload()
        built = self.builder.build_from_payload(payload)
        stats = built["stats"]
        timeline = stats["timeline"]
        docs_dir = self.root / "docs" / "stats"
        docs_dir.mkdir(parents=True, exist_ok=True)

        summary_svg_path = docs_dir / "corpus-keyword-stats.svg"
        summary_json_path = docs_dir / "corpus-keyword-stats.json"
        timeline_svg_path = docs_dir / "corpus-growth-timeline.svg"
        timeline_json_path = docs_dir / "corpus-growth-timeline.json"
        self._write_text(summary_svg_path, built["svg"])
        self._write_json(
            summary_json_path,
            {
                **stats,
                "timeline": {
                    "pointCount": len(timeline["points"]),
                    "finalComments": timeline["finalComments"],
                    "finalDanmaku": timeline["finalDanmaku"],
                    "finalTotal": timeline["finalTotal"],
                },
            },
        )
        self._write_text(timeline_svg_path, built["timelineSvg"])
        self._write_json(timeline_json_path, timeline)
        self._update_readme(stats)

        return {
            "ok": True,
            "comments": stats["comments"],
            "danmaku": stats["danmaku"],
            "keywordTerms": stats["keywordTerms"],
            "coverageRatio": stats["coverageRatioLabel"],
            "timelinePoints": len(timeline["points"]),
            "svg": str(summary_svg_path),
            "json": str(summary_json_path),
            "timelineSvg": str(timeline_svg_path),
            "timelineJson": str(timeline_json_path),
        }

    def _payload(self) -> dict[str, Any]:
        data_dir = self.root / "server" / "data"
        direct = CorpusLoader(data_dir / "bilibiliDirectProbeCorpus.json", fallback={"comments": [], "runs": []}).load()
        external = CorpusLoader(data_dir / "huggingFaceKeywordCorpus.json", fallback={"comments": [], "runs": []}).load()
        dictionary = DictionaryLoader(data_dir / "deepseekKeywordDictionary.json").load()
        coverage = safe_read_json_object(data_dir / "keywordCoverageAudit.json")
        return {
            "sources": [
                {"name": "Bilibili direct probe corpus", "comments": direct.comments, "runs": direct.runs},
                {"name": "External Bilibili/Tieba corpus", "comments": external.comments, "runs": external.runs},
            ],
            "dictionary": dictionary.manifest,
            "coverage": coverage,
        }

    def _readme_block(self, stats: dict[str, Any]) -> str:
        timeline_points = len(stats["timeline"]["points"]) if isinstance(stats.get("timeline"), dict) else 0
        return f"""{self.START_MARKER}
## Data Growth / 数据增长

![Corpus and keyword analysis stats](docs/stats/corpus-keyword-stats.svg)

![Comment and danmaku growth over time](docs/stats/corpus-growth-timeline.svg)

| Metric | Value |
|---|---:|
| Comments / replies | {self._format_number(stats.get("comments"))} |
| Danmaku | {self._format_number(stats.get("danmaku"))} |
| Keyword terms analyzed | {self._format_number(stats.get("keywordTerms"))} |
| Coverage ratio | {stats.get("coverageRatioLabel") or "0.00%"} |
| Weak terms | {self._format_number(stats.get("weakTerms"))} |
| Timeline points | {self._format_number(timeline_points)} |

This block is generated by `npm run stats:update` and refreshed by GitHub Actions.
{self.END_MARKER}"""

    def _update_readme(self, stats: dict[str, Any]) -> None:
        readme_path = self.root / "README.md"
        current = readme_path.read_text(encoding="utf-8") if readme_path.exists() else ""
        block = self._readme_block(stats)
        pattern = re.compile(f"{re.escape(self.START_MARKER)}[\\s\\S]*?{re.escape(self.END_MARKER)}")
        if pattern.search(current):
            next_text = pattern.sub(block, current)
        elif re.search(r"\r?\n---\r?\n", current):
            next_text = re.sub(r"\r?\n---\r?\n", f"\n---\n\n{block}\n\n---\n", current, count=1)
        else:
            next_text = f"{current.rstrip()}\n\n{block}\n" if current.strip() else f"{block}\n"
        if next_text != current:
            self._write_text(readme_path, next_text)

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        self._write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")

    def _write_text(self, path: Path, text: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    def _format_number(self, value: Any) -> str:
        return f"{int(_number(value)):,}"


class ReadmeStatsSvgRenderer:
    """Render README stats SVGs from Python-built stats JSON contracts."""

    def render_summary_svg(self, stats: dict[str, Any]) -> str:
        updated = self._date_label(stats.get("generatedAt"))
        coverage_ratio = max(0.0, min(1.0, _number(stats.get("coverageRatio"))))
        coverage_label = stats.get("coverageRatioLabel") or f"{coverage_ratio * 100:.2f}%"
        weak_terms = int(_number(stats.get("weakTerms")))
        evidence_deficit = int(_number(stats.get("evidenceDeficit")))
        return f"""<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430" viewBox="0 0 920 430" role="img" aria-labelledby="title desc">
  <title id="title">Bilibili User Personality data collection and keyword analysis stats</title>
  <desc id="desc">Current counts for collected comments, danmaku, analyzed dictionary keywords, and coverage metrics.</desc>
  <style>
    .bg {{ fill: #f7f0df; }}
    .panel {{ fill: #fffaf0; stroke: #27231c; stroke-width: 2; }}
    .title {{ font: 700 28px Georgia, 'Times New Roman', serif; fill: #27231c; }}
    .sub {{ font: 14px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .label {{ font: 700 18px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }}
    .value {{ font: 700 18px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; text-anchor: start; }}
    .small {{ font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #5d5548; }}
    .metric {{ font: 700 26px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }}
    .tile-label {{ font: 700 15px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .tile-value {{ font: 700 34px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }}
    .stat-icon {{ font: 18px sans-serif; }}
    .stat-num {{ font: 700 16px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }}
    .stat-label {{ font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
  </style>
  <rect class="bg" width="920" height="430" rx="24"/>
  <rect class="panel" x="18" y="18" width="884" height="394" rx="20"/>
  <text x="40" y="62" class="title">Corpus Collection + Keyword Analysis</text>
  <text x="40" y="88" class="sub">auto-generated from repo data on {self._escape(updated)}</text>
  <!-- Coverage donut gauge -->
  <g>
    {self._donut_gauge(190, 252, 78, coverage_ratio, coverage_label, "#3f7558", "coverage")}
  </g>
  <!-- Metric tiles -->
  <g>
    <rect x="400" y="170" width="220" height="90" rx="16" fill="#eadfca" stroke="#27231c"/>
    <text x="510" y="200" text-anchor="middle" class="tile-label">weak terms</text>
    <text x="510" y="240" text-anchor="middle" class="tile-value">{self._format_number(weak_terms)}</text>
    <text x="510" y="253" text-anchor="middle" class="small">&#8595; target: 0</text>
  </g>
  <g>
    <rect x="640" y="170" width="220" height="90" rx="16" fill="#dbe8df" stroke="#27231c"/>
    <text x="750" y="200" text-anchor="middle" class="tile-label">evidence deficit</text>
    <text x="750" y="240" text-anchor="middle" class="tile-value">{self._format_number(evidence_deficit)}</text>
    <text x="750" y="253" text-anchor="middle" class="small">gap to close</text>
  </g>
  <!-- Compact stat row -->
  <g>
    <line x1="40" y1="335" x2="880" y2="335" stroke="#d7ccb8" stroke-width="1"/>
    <text x="140" y="372" text-anchor="middle" class="stat-icon">&#128172;</text>
    <text x="140" y="395" text-anchor="middle" class="stat-num">{self._format_number(stats.get("comments"))}</text>
    <text x="140" y="412" text-anchor="middle" class="stat-label">comments / replies</text>
    <text x="380" y="372" text-anchor="middle" class="stat-icon">&#127916;</text>
    <text x="380" y="395" text-anchor="middle" class="stat-num">{self._format_number(stats.get("danmaku"))}</text>
    <text x="380" y="412" text-anchor="middle" class="stat-label">danmaku</text>
    <text x="620" y="372" text-anchor="middle" class="stat-icon">&#128218;</text>
    <text x="620" y="395" text-anchor="middle" class="stat-num">{self._format_number(stats.get("keywordTerms"))}</text>
    <text x="620" y="412" text-anchor="middle" class="stat-label">keyword terms</text>
  </g>
</svg>
"""

    def render_timeline_svg(self, timeline: dict[str, Any], generated_at: Any) -> str:
        points = timeline.get("points") if isinstance(timeline.get("points"), list) else []
        # Downsample to ~50 points for clean rendering
        sampled = self._downsample_points(points, target=50)
        # Single Y-axis: all three lines (comments, danmaku, total) share one scale
        total_max_raw = max([_number(p.get("total")) for p in sampled if isinstance(p, dict)] + [_number(timeline.get("finalTotal")), 1])
        y_max = self.padded_timeline_max(total_max_raw)
        x0, y0, width, height = 92, 110, 676, 196
        updated = self._date_label(generated_at)
        first_date = self._timeline_date(sampled[0].get("date")) if sampled else "n/a"
        last_date = self._timeline_date(sampled[-1].get("date")) if sampled else "n/a"
        # Y-axis grid — 5 ticks
        grid = "\n".join(
            self._grid_row_k(ratio, y_max, x0, y0, width, height)
            for ratio in (0, 0.25, 0.5, 0.75, 1)
        )
        return f"""<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430" viewBox="0 0 920 430" role="img" aria-labelledby="timeline-title timeline-desc">
  <title id="timeline-title">Comment, danmaku and total collection growth over time</title>
  <desc id="timeline-desc">Cumulative growth lines for comments, danmaku and total across recorded harvest runs.</desc>
  <style>
    .bg {{ fill: #f3ead8; }}
    .panel {{ fill: #fffaf0; stroke: #27231c; stroke-width: 2; }}
    .title {{ font: 700 28px Georgia, 'Times New Roman', serif; fill: #27231c; }}
    .sub {{ font: 14px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .axis {{ font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }}
    .label {{ font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #5d5548; }}
    .legend-text {{ font: 12px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #5d5548; }}
  </style>
  <rect class="bg" width="920" height="430" rx="24"/>
  <rect class="panel" x="18" y="18" width="884" height="394" rx="20"/>
  <text x="40" y="62" class="title">Corpus Growth Over Time</text>
  <text x="40" y="88" class="sub">auto-generated from corpus run history on {self._escape(updated)} | {self._format_number(len(sampled))} points shown (of {self._format_number(len(points))} total)</text>
  <g>
{grid}
    <!-- Chart frame -->
    <line x1="{x0}" y1="{y0 + height}" x2="{x0 + width}" y2="{y0 + height}" stroke="#27231c" stroke-width="2"/>
    <line x1="{x0}" y1="{y0}" x2="{x0}" y2="{y0 + height}" stroke="#27231c" stroke-width="2"/>
    <!-- Comments line -->
    <polyline points="{self._polyline(sampled, "comments", y_max, x0, y0, width, height)}" fill="none" stroke="#8c5f32" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Danmaku line -->
    <polyline points="{self._polyline(sampled, "danmaku", y_max, x0, y0, width, height)}" fill="none" stroke="#3f7558" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Total line -->
    <polyline points="{self._polyline(sampled, "total", y_max, x0, y0, width, height)}" fill="none" stroke="#2b3a55" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Date ticks -->
    <text x="{x0}" y="{y0 + height + 26}" class="axis" text-anchor="start">{self._escape(first_date)}</text>
    <text x="{x0 + width}" y="{y0 + height + 26}" class="axis" text-anchor="end">{self._escape(last_date)}</text>
    <!-- Axis label -->
    <text x="{x0 - 52}" y="{y0 + height // 2}" class="axis" transform="rotate(-90 {x0 - 52} {y0 + height // 2})" text-anchor="middle">Count (K)</text>
  </g>
  <!-- Legend -->
  <g>
    <rect x="72" y="360" width="16" height="16" rx="3" fill="#8c5f32"/><text x="96" y="373" class="legend-text">Comments {self._format_number(timeline.get("finalComments"))}</text>
    <rect x="270" y="360" width="16" height="16" rx="3" fill="#3f7558"/><text x="294" y="373" class="legend-text">Danmaku {self._format_number(timeline.get("finalDanmaku"))}</text>
    <rect x="468" y="360" width="16" height="16" rx="3" fill="#2b3a55"/><text x="492" y="373" class="legend-text">Total {self._format_number(timeline.get("finalTotal"))}</text>
    <text x="880" y="373" class="legend-text" text-anchor="end">Runs: {self._format_number(len(points))}</text>
  </g>
</svg>
"""

    def padded_timeline_max(self, value: Any) -> int | float:
        return ReadmeStatsBuilder().padded_timeline_max(value)

    def _donut_gauge(self, cx: int, cy: int, r: int, ratio: float, label: str, color: str, sublabel: str) -> str:
        circumference = 2 * math.pi * r
        dash = max(0.0, min(1.0, ratio)) * circumference
        return f"""<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#e8e1d2" stroke-width="24"/>
    <circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="{color}" stroke-width="24"
      stroke-dasharray="{dash:.1f} {circumference - dash:.1f}" stroke-linecap="round"
      transform="rotate(-90 {cx} {cy})"/>
    <text x="{cx}" y="{cy - 6}" text-anchor="middle" class="metric" font-size="26">{self._escape(label)}</text>
    <text x="{cx}" y="{cy + 18}" text-anchor="middle" class="small">{self._escape(sublabel)}</text>"""

    def _downsample_points(self, points: list[dict[str, Any]], target: int = 50) -> list[dict[str, Any]]:
        if len(points) <= target:
            return list(points)
        step = max(1, len(points) // target)
        result = points[::step]
        if result[-1] != points[-1]:
            result.append(points[-1])
        return result

    def _format_k(self, value: Any) -> str:
        n = int(_number(value))
        if n >= 1000:
            return f"{n // 1000}K"
        return str(n)

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

    def _grid_row_k(self, ratio: float, max_value: Any, x0: int, y0: int, width: int, height: int) -> str:
        y = y0 + height - (ratio * height)
        return f"""    <line x1="{x0}" y1="{y:.1f}" x2="{x0 + width}" y2="{y:.1f}" stroke="#d7ccb8" stroke-width="1"/>
    <text x="{x0 - 14}" y="{y + 4:.1f}" class="axis" text-anchor="end">{self._format_k(round(_number(max_value) * ratio))}</text>"""

    def _grid_row_k_right(self, ratio: float, max_value: Any, x0: int, y0: int, width: int, height: int) -> str:
        y = y0 + height - (ratio * height)
        return f"""    <line x1="{x0}" y1="{y:.1f}" x2="{x0 + width}" y2="{y:.1f}" stroke="#d7ccb8" stroke-width="1" stroke-dasharray="4,4"/>
    <text x="{x0 + width + 6}" y="{y + 4:.1f}" class="axis-right" text-anchor="start">{self._format_k(round(_number(max_value) * ratio))}</text>"""

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
