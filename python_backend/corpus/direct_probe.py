from __future__ import annotations

import argparse
import html
import json
import random
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from python_backend.analysis.comment_coverage import _is_contract_scalar
from python_backend.corpus.loader import CorpusLoader
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object
from python_backend.scrapers.rate_limiter import RateLimitPolicy


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _has_han(value: Any) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", _clean_text(value)))


def _list_field(entry: dict[str, Any], key: str) -> list[Any]:
    value = entry.get(key) if isinstance(entry, dict) else None
    return value if isinstance(value, list) else []


def _evidence_count(entry: dict[str, Any]) -> int:
    count = entry.get("evidenceCount")
    if count is None:
        count = len(_list_field(entry, "evidence") or _list_field(entry, "evidenceSamples"))
    try:
        return max(0, int(count))
    except (TypeError, ValueError):
        return 0


def _is_video_context_source(source: dict[str, Any]) -> bool:
    sample = _clean_text(source.get("sample"))
    source_text = _clean_text(source.get("source"))
    return (
        sample.startswith("Bilibili video context:")
        or sample.startswith("Bilibili public video title:")
        or "search-discovered video context" in source_text
    )


def _is_comment_backed_sample(sample: Any) -> bool:
    sample_text = _clean_text(sample)
    return bool(
        sample_text
        and not sample_text.startswith("Bilibili video context:")
        and not sample_text.startswith("Bilibili public video title:")
    )


def _has_comment_scan_source(entry: dict[str, Any]) -> bool:
    for source in _list_field(entry, "evidenceSources"):
        source_text = _clean_text(source.get("source") if isinstance(source, dict) else "")
        if source_text.startswith("Bilibili public ") and "comment scan" in source_text:
            return True
    return False


def _comment_backed_evidence_count(entry: dict[str, Any]) -> int:
    raw_count = _evidence_count(entry)
    if raw_count == 0:
        return 0
    samples = set()
    for source in _list_field(entry, "evidenceSources"):
        if not isinstance(source, dict):
            continue
        sample = _clean_text(source.get("sample"))
        if sample and not _is_video_context_source(source) and _is_comment_backed_sample(sample):
            samples.add(sample)
    if _has_comment_scan_source(entry):
        for sample in _list_field(entry, "evidenceSamples"):
            sample_text = _clean_text(sample)
            if _is_comment_backed_sample(sample_text):
                samples.add(sample_text)
    return min(raw_count, len(samples))


def _coverage_evidence_count(entry: dict[str, Any], require_comment_backed_evidence: bool = False) -> int:
    if require_comment_backed_evidence:
        return _comment_backed_evidence_count(entry)
    count = entry.get("coverageEvidenceCount")
    if count is None:
        return _evidence_count(entry)
    try:
        return max(0, int(count))
    except (TypeError, ValueError):
        return 0


def _unique(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _generated_colloquial_aliases(term: str) -> list[str]:
    aliases = []
    if len(term) >= 4:
        for suffix in ["\u554a", "\u5427", "\u5462", "\u561b", "\u5457"]:
            aliases.append(term[:-1] if term.endswith(suffix) else f"{term}{suffix}")
        aliases.append(term[:-1] if term.endswith("\u4e86") and len(term) > 4 else f"{term}\u4e86")
    if term == "\u5403\u76f8\u592a\u96be\u770b":
        aliases.extend(["\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86", "\u5403\u76f8\u96be\u770b"])
    return aliases


def _evidence_needles(entry: dict[str, Any]) -> list[str]:
    aliases = entry.get("aliases") if isinstance(entry.get("aliases"), list) else []
    examples = entry.get("examples") if isinstance(entry.get("examples"), list) else []
    values = [
        _clean_text(entry.get("term")),
        *[_clean_text(alias) for alias in aliases if _is_contract_scalar(alias)],
        *[_clean_text(example) for example in examples if _is_contract_scalar(example)],
    ]
    values.extend(_generated_colloquial_aliases(values[0]) if values and values[0] else [])
    return [value for value in _unique(values) if len(value) >= 2]


def _existing_samples(entry: dict[str, Any]) -> set[str]:
    samples = []
    samples.extend(_list_field(entry, "evidence"))
    samples.extend(_list_field(entry, "evidenceSamples"))
    samples.extend(source.get("sample") for source in _list_field(entry, "evidenceSources") if isinstance(source, dict))
    return {_clean_text(sample) for sample in samples if _clean_text(sample)}


class DirectProbeCorpusSummary:
    """Extract comparator-friendly summaries from direct probe corpus results."""

    SUMMARY_KEYS = ("commentMessages", "runQueries", "runCommentsAdded")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        corpus = result.get("corpus") if isinstance(result.get("corpus"), dict) else {}
        comments = corpus.get("comments") if isinstance(corpus.get("comments"), list) else []
        runs = corpus.get("runs") if isinstance(corpus.get("runs"), list) else []
        summary = {
            "commentCount": len(comments),
            "runCount": len(runs),
            "commentMessages": [comment.get("message") for comment in comments if isinstance(comment, dict)],
            "runQueries": [run.get("query") for run in runs if isinstance(run, dict)],
            "runCommentsAdded": [run.get("commentsAdded") for run in runs if isinstance(run, dict)],
        }
        return summary


class DirectProbeCorpusContractComparator:
    """Compare direct-probe corpus updates using summarized JSON contract fields."""

    def __init__(self, summary: DirectProbeCorpusSummary | None = None):
        self.summary = summary or DirectProbeCorpusSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class DirectProbeCorpusRunner:
    """Build a direct Bilibili probe corpus update from JSON contract files."""

    def __init__(self, existing_path: str | Path, comments_path: str | Path, run_path: str | Path):
        self.existing_path = Path(existing_path)
        self.comments_path = Path(comments_path)
        self.run_path = Path(run_path)
        self.builder = DirectProbeCorpusBuilder()
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        loaded = CorpusLoader(self.existing_path, fallback={"version": 1, "comments": [], "runs": []}).load()
        existing = {**loaded.manifest, "comments": loaded.comments, "runs": loaded.runs}
        comments_payload = self._read_json(self.comments_path, [])
        comments = comments_payload.get("comments") if isinstance(comments_payload, dict) else comments_payload
        run = self._read_json_object(self.run_path, {})
        return self.builder.build_probe_corpus_result(existing, comments if isinstance(comments, list) else [], run)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        return self.reader.read_value(path, fallback)

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        payload = self._read_json(path, fallback)
        return payload if isinstance(payload, dict) else fallback


class DirectProbeCorpusPayloadRunner:
    """Build a direct Bilibili probe corpus update from one JSON payload file."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = DirectProbeCorpusBuilder()
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        loaded = CorpusLoader.load_from_payload(self._existing_corpus_payload(payload))
        existing = {**loaded.manifest, "comments": loaded.comments, "runs": loaded.runs}
        comments_payload = payload.get("comments") if isinstance(payload.get("comments"), list) else []
        run = payload.get("run") if isinstance(payload.get("run"), dict) else {}
        return self.builder.build_probe_corpus_result(existing, comments_payload, run)

    def _existing_corpus_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if isinstance(payload.get("existing"), dict):
            return {"corpus": payload["existing"]}
        if isinstance(payload.get("corpus"), dict) or payload.get("corpusPath") or payload.get("path"):
            return payload
        return {"corpus": {"version": 1, "comments": [], "runs": []}}

    def _read_payload(self) -> dict[str, Any]:
        payload = self.reader.read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class DirectProbeCorpusPayloadContractComparator:
    """Compare file-backed direct-probe corpus updates against saved JS-compatible JSON."""

    def __init__(self, existing_path: str | Path, comments_path: str | Path, run_path: str | Path, js_report_path: str | Path):
        self.existing_path = Path(existing_path)
        self.comments_path = Path(comments_path)
        self.run_path = Path(run_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DirectProbeCorpusSummary()
        self.comparator = DirectProbeCorpusContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = DirectProbeCorpusRunner(self.existing_path, self.comments_path, self.run_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class DirectProbeCorpusJsonPayloadContractComparator:
    """Compare one-file direct-probe corpus payload output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DirectProbeCorpusSummary()
        self.comparator = DirectProbeCorpusContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = DirectProbeCorpusPayloadRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class DirectProbeCorpusRequest:
    """Corpus-layer request object for direct Bilibili probe corpus JSON contract modes."""

    def __init__(
        self,
        existing_path: str | Path | None = None,
        comments_path: str | Path | None = None,
        run_path: str | Path | None = None,
        *,
        payload_path: str | Path | None = None,
        compare_js_report_path: str | Path | None = None,
    ):
        self.existing_path = Path(existing_path) if existing_path else None
        self.comments_path = Path(comments_path) if comments_path else None
        self.run_path = Path(run_path) if run_path else None
        self.payload_path = Path(payload_path) if payload_path else None
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.payload_path:
            if self.compare_js_report_path:
                return DirectProbeCorpusJsonPayloadContractComparator(
                    self.payload_path,
                    self.compare_js_report_path,
                ).compare()
            return DirectProbeCorpusPayloadRunner(self.payload_path).run()
        if self.existing_path is None or self.comments_path is None or self.run_path is None:
            raise ValueError("existing_path, comments_path, and run_path are required when payload_path is not provided")
        if self.compare_js_report_path:
            return DirectProbeCorpusPayloadContractComparator(
                self.existing_path,
                self.comments_path,
                self.run_path,
                self.compare_js_report_path,
            ).compare()
        return DirectProbeCorpusRunner(self.existing_path, self.comments_path, self.run_path).run()


class DirectProbeCorpusCommandRequest:
    """Argv-backed corpus-layer request for direct probe corpus updates."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a JS-compatible Bilibili direct probe corpus update.")
        parser.add_argument("--payload", default="", help="Single JSON payload containing existing, comments, and run.")
        parser.add_argument("--existing", default="server/data/bilibiliDirectProbeCorpus.json")
        parser.add_argument("--comments", default="", help="JSON list or object with a comments array.")
        parser.add_argument("--run", default="", help="Direct probe run JSON object.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct probe corpus report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        parser = self.parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if not args.payload and (not args.comments or not args.run):
            parser.error("--comments and --run are required unless --payload is provided")
        return DirectProbeCorpusRequest(
            existing_path=args.existing,
            comments_path=args.comments,
            run_path=args.run,
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report,
        ).run()


class DirectProbePlanSummary:
    """Extract comparator-friendly summaries from direct Bilibili probe plans."""

    PLAN_KEYS = (
        "nextReplyCursor",
        "viewUrl",
        "replyUrl",
        "replyPageUrl",
        "replyThreadUrl",
        "searchUrls",
        "syntheticCookie",
    )

    def summarize(self, plan: dict[str, Any] | None = None) -> dict[str, Any]:
        plan = plan if isinstance(plan, dict) else {}
        return {key: plan.get(key) for key in self.PLAN_KEYS if key in plan}


class DirectProbePlanContractComparator:
    """Compare direct-probe plans using the JS/Python JSON contract."""

    def __init__(self, summary: DirectProbePlanSummary | None = None):
        self.summary = summary or DirectProbePlanSummary()

    def compare(self, python_plan: dict[str, Any] | None, js_plan: dict[str, Any] | None) -> dict[str, Any]:
        python_plan = python_plan if isinstance(python_plan, dict) else {}
        js_plan = js_plan if isinstance(js_plan, dict) else {}
        mismatches = [
            {"key": key, "python": python_plan.get(key), "js": js_plan.get(key)}
            for key in self.summary.PLAN_KEYS
            if key in js_plan and python_plan.get(key) != js_plan.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_plan),
            "js": self.summary.summarize(js_plan),
        }


class DirectProbePlanRunner:
    """Build deterministic direct Bilibili probe planning outputs from JSON."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = DirectProbeCorpusBuilder()
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.builder.build_plan_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        payload = self.reader.read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class DirectProbePlanPayloadContractComparator:
    """Compare file-backed direct-probe plans against saved JS-compatible plan JSON."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.summary = DirectProbePlanSummary()
        self.comparator = DirectProbePlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_plan = DirectProbePlanRunner(self.payload_path).run()
        js_plan = self._read_js_plan()
        return self.comparator.compare(python_plan, js_plan)

    def _read_js_plan(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_plan_path)


class DirectProbePlanRequest:
    """Corpus-layer request for direct probe planning JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_plan_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_plan_path = Path(compare_js_plan_path) if compare_js_plan_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_plan_path:
            return DirectProbePlanPayloadContractComparator(self.payload_path, self.compare_js_plan_path).compare()
        return DirectProbePlanRunner(self.payload_path).run()


class DirectProbePlanCommandRequest:
    """Argv-backed corpus-layer request for direct probe planning commands."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build direct Bilibili probe planning JSON from a payload.")
        parser.add_argument("--payload", required=True, help="Path to direct probe plan JSON payload.")
        parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible direct probe plan JSON to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DirectProbePlanRequest(args.payload, compare_js_plan_path=args.compare_js_plan or None).run()


class DirectProbeCommandRunner:
    """Run the direct Bilibili evidence probe loop from a JSON-compatible payload."""

    def __init__(self, payload: dict[str, Any] | None = None, builder: "DirectProbeCorpusBuilder" | None = None):
        self.payload = payload if isinstance(payload, dict) else {}
        self.builder = builder or DirectProbeCorpusBuilder()

    def run(self) -> dict[str, Any]:
        options = self._options()
        audit = self.payload.get("audit") if isinstance(self.payload.get("audit"), dict) else {}
        dictionary = self.payload.get("dictionary") if isinstance(self.payload.get("dictionary"), dict) else {}
        existing_corpus = self.payload.get("existingCorpus") if isinstance(self.payload.get("existingCorpus"), dict) else {}
        actions = self._actions(audit, options)
        scanned_keys = set(self.builder.collect_scanned_probe_video_keys(existing_corpus))
        source_videos_by_term = self.builder.build_evidence_source_videos_for_actions(
            dictionary,
            actions,
            {"maxPerAction": options["sourceVideosPerAction"], "corpus": existing_corpus},
        )
        comments: list[dict[str, Any]] = []
        scanned_videos: list[dict[str, Any]] = []
        warnings: list[str] = []

        for action in actions:
            try:
                videos = self._videos_for_action(action, source_videos_by_term, scanned_keys, options)
            except Exception as error:
                warnings.append(f"{action.get('query')}: search {error}")
                videos = []
            for video in videos:
                key = self.builder.probe_video_key(video)
                if key:
                    scanned_keys.add(key)
                scanned_videos.append(
                    {
                        "key": key,
                        "term": action.get("term"),
                        "query": action.get("query"),
                        "bvid": video.get("bvid"),
                        "aid": video.get("aid"),
                        "rootRpid": video.get("rootRpid"),
                        "title": video.get("title"),
                    }
                )
                try:
                    comments.extend(self._comments_for_video(video))
                except Exception as error:
                    label = video.get("bvid") or (f"av{video.get('aid')}" if video.get("aid") else key or "(unknown video)")
                    warnings.append(f"{action.get('query')} {label}: replies {error}")

        entries = self.builder.build_fresh_evidence_entries(
            dictionary,
            comments,
            {
                "targetEvidence": 3,
                "maxSamplesPerTerm": 3,
                "targetTerms": [action.get("term") for action in actions],
                "requireCommentBackedEvidence": True,
            },
        )
        result: dict[str, Any] = {
            "ok": True,
            "write": options["write"],
            "options": options,
            "actions": actions,
            "commentsCollected": len(comments),
            "comments": comments,
            "scannedVideos": scanned_videos,
            "warnings": warnings,
            "entries": entries,
        }
        if options["write"]:
            result["corpus"] = self.builder.build_probe_corpus(
                existing_corpus,
                comments,
                {"at": options.get("now"), "actions": actions, "videos": scanned_videos, "warnings": warnings},
            )
        return result

    def _options(self) -> dict[str, Any]:
        raw = self.payload.get("options") if isinstance(self.payload.get("options"), dict) else {}
        return {
            "maxActions": self.builder._bounded_int(raw.get("maxActions"), 4, 1, 50),
            "offset": self.builder._bounded_int(raw.get("offset"), 0, 0, 1000),
            "videosPerQuery": self.builder.bounded_probe_videos_per_query(raw.get("videosPerQuery"), 5),
            "sourceVideosPerAction": self.builder._bounded_int(raw.get("sourceVideosPerAction"), 6, 0, 50),
            "includeDanmaku": raw.get("includeDanmaku") is True,
            "usePythonLiveFetch": raw.get("usePythonLiveFetch") is True,
            "write": raw.get("write") is True,
            "cookie": _clean_text(raw.get("cookie")),
            "now": _clean_text(raw.get("now")),
        }

    def _actions(self, audit: dict[str, Any], options: dict[str, Any]) -> list[dict[str, Any]]:
        explicit_queries = self.payload.get("explicitQueries") if isinstance(self.payload.get("explicitQueries"), list) else []
        actions = [
            {"term": _clean_text(item.get("term") or item.get("query")), "query": _clean_text(item.get("query") or item.get("term"))}
            for item in explicit_queries
            if isinstance(item, dict) and _clean_text(item.get("query") or item.get("term"))
        ]
        if not actions:
            next_actions = audit.get("nextActions") if isinstance(audit.get("nextActions"), list) else []
            selected = next_actions[options["offset"] : options["offset"] + options["maxActions"]]
            actions = [
                {
                    "term": _clean_text(action.get("term")),
                    "query": _clean_text(action.get("nextQuery") or action.get("query") or action.get("term")),
                }
                for action in selected
                if isinstance(action, dict) and _clean_text(action.get("nextQuery") or action.get("query") or action.get("term"))
            ]
        explicit_aids = self.payload.get("explicitAids") if isinstance(self.payload.get("explicitAids"), list) else []
        aids = [_clean_text(aid).removeprefix("av") for aid in explicit_aids if re.match(r"^(?:av)?\d+$", _clean_text(aid), flags=re.IGNORECASE)]
        if aids:
            actions.insert(
                0,
                {
                    "term": "explicit Bilibili AIDs",
                    "query": "explicit Bilibili AIDs",
                    "explicitVideos": [{"aid": aid, "title": f"explicit aid {aid}"} for aid in aids],
                },
            )
        return actions[: options["maxActions"]]

    def _videos_for_action(
        self,
        action: dict[str, Any],
        source_videos_by_term: dict[str, list[dict[str, Any]]],
        scanned_keys: set[str],
        options: dict[str, Any],
    ) -> list[dict[str, Any]]:
        explicit_videos = action.get("explicitVideos") if isinstance(action.get("explicitVideos"), list) else []
        source_videos = self.builder.filter_unscanned_probe_videos(source_videos_by_term.get(_clean_text(action.get("term"))) or [], scanned_keys)
        search_videos = [] if explicit_videos else self._search_videos(_clean_text(action.get("query")))
        ranked = self.builder.rank_probe_videos_for_action(search_videos, action)
        return self._merge_videos([*explicit_videos, *source_videos], ranked, options["videosPerQuery"] + len(source_videos) + len(explicit_videos))

    def _search_videos(self, query: str) -> list[dict[str, Any]]:
        search_videos = self.payload.get("searchVideos") if isinstance(self.payload.get("searchVideos"), dict) else {}
        videos = search_videos.get(query, [])
        return [video for video in videos if isinstance(video, dict)]

    def _comments_for_video(self, video: dict[str, Any]) -> list[dict[str, Any]]:
        comments_by_video = self.payload.get("videoComments") if isinstance(self.payload.get("videoComments"), dict) else {}
        comments = comments_by_video.get(self.builder.probe_video_key(video), [])
        return [comment for comment in comments if isinstance(comment, dict)]

    def _merge_videos(self, primary: list[dict[str, Any]], fallback: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        videos: list[dict[str, Any]] = []
        seen: set[str] = set()
        for video in [*primary, *fallback]:
            key = self.builder.probe_video_key(video)
            if not key or key in seen:
                continue
            seen.add(key)
            videos.append(video)
            if len(videos) >= limit:
                break
        return videos


class DirectProbeLiveFetcher:
    """Fetch live Bilibili reply and danmaku comments behind an injectable transport seam."""

    def __init__(
        self,
        fetch_json: Callable[[str, str, dict[str, Any]], dict[str, Any]] | None = None,
        fetch_text: Callable[[str, str, dict[str, Any]], str] | None = None,
        builder: "DirectProbeCorpusBuilder" | None = None,
    ):
        self.builder = builder or DirectProbeCorpusBuilder()
        self.fetch_json = fetch_json or self._fetch_json
        self.fetch_text = fetch_text or self._fetch_text

    def fetch_video_comments(self, video: dict[str, Any] | None, options: dict[str, Any] | None = None) -> list[dict[str, str]]:
        options = options if isinstance(options, dict) else {}
        target = self._resolve_video(video, options)
        comments: list[dict[str, str]] = []
        reply_mode = _clean_text(options.get("replyMode")) or "cursor"
        if reply_mode not in {"cursor", "page", "both"}:
            reply_mode = "cursor"
        reply_pages = self.builder._bounded_int(options.get("replyPages"), 2, 1, 5)
        reply_page_size = self.builder._bounded_int(options.get("replyPageSize"), 20, 1, 50)
        reply_cursor_skip_pages = self.builder.bounded_reply_cursor_skip_pages(options.get("replyCursorSkipPages"), 0)

        if target.get("rootRpid"):
            for page in range(1, reply_pages + 1):
                url = self.builder.build_bilibili_reply_thread_url(target, target.get("rootRpid"), page, reply_page_size)
                if not url:
                    raise ValueError("missing video aid/root for reply thread")
                payload = self.fetch_json(url, self._video_referer(target, reply=target.get("rootRpid")), options)
                if page >= reply_cursor_skip_pages:
                    self.builder.collect_reply_messages((payload.get("data") or {}).get("replies"), target, comments)
                if not ((payload.get("data") or {}).get("replies") or []):
                    break

        if reply_mode in {"cursor", "both"}:
            cursor = 0
            total_pages = reply_cursor_skip_pages + reply_pages
            for page_index in range(total_pages):
                url = self.builder.build_bilibili_reply_url(target, cursor, reply_page_size)
                if not url:
                    raise ValueError("missing video aid for replies")
                payload = self.fetch_json(url, self._video_referer(target), options)
                if page_index >= reply_cursor_skip_pages:
                    self.builder.collect_reply_messages((payload.get("data") or {}).get("replies"), target, comments)
                next_cursor = self.builder.next_reply_cursor(payload, cursor)
                if next_cursor is None:
                    break
                cursor = next_cursor

        if reply_mode in {"page", "both"}:
            start_page = self.builder._bounded_int(options.get("replyStartPage"), 1, 1, 20)
            for page in range(start_page, start_page + reply_pages):
                url = self.builder.build_bilibili_reply_page_url(target, page, reply_page_size)
                if not url:
                    raise ValueError("missing video aid for page replies")
                payload = self.fetch_json(url, self._video_referer(target), options)
                replies = (payload.get("data") or {}).get("replies") or []
                self.builder.collect_reply_messages(replies, target, comments)
                if not replies:
                    break

        if options.get("includeDanmaku") is True:
            comments.extend(self.fetch_video_danmaku(target, options))
        return comments

    def fetch_video_danmaku(self, video: dict[str, Any] | None, options: dict[str, Any] | None = None) -> list[dict[str, str]]:
        options = options if isinstance(options, dict) else {}
        target = self._resolve_video(video, options)
        cid = _clean_text(target.get("cid"))
        if not cid:
            return []
        url = f"https://api.bilibili.com/x/v1/dm/list.so?{urlencode({'oid': cid})}"
        xml = self.fetch_text(url, self._video_referer(target), options)
        return self.builder.collect_danmaku_messages(xml, target)

    def _resolve_video(self, video: dict[str, Any] | None, options: dict[str, Any]) -> dict[str, Any]:
        target = dict(video) if isinstance(video, dict) else {}
        if target.get("aid") and (target.get("cid") or not target.get("bvid")):
            return target
        view_url = self.builder.build_bilibili_view_url(target)
        if not view_url:
            raise ValueError("missing video aid/bvid")
        view = self.fetch_json(view_url, self._video_referer(target), options)
        data = view.get("data") if isinstance(view.get("data"), dict) else {}
        aid = data.get("aid") or target.get("aid")
        if not aid:
            raise ValueError("missing video aid from view response")
        pages = data.get("pages") if isinstance(data.get("pages"), list) else []
        first_page = pages[0] if pages and isinstance(pages[0], dict) else {}
        return {
            **target,
            "aid": _clean_text(aid),
            "bvid": _clean_text(target.get("bvid") or data.get("bvid")),
            "cid": _clean_text(data.get("cid") or first_page.get("cid") or target.get("cid")),
        }

    def _video_referer(self, video: dict[str, Any], reply: Any | None = None) -> str:
        if video.get("bvid"):
            suffix = f"?reply={_clean_text(reply)}" if reply else ""
            return f"https://www.bilibili.com/video/{_clean_text(video.get('bvid'))}/{suffix}"
        if video.get("aid"):
            suffix = f"?reply={_clean_text(reply)}" if reply else ""
            return f"https://www.bilibili.com/video/av{_clean_text(video.get('aid'))}/{suffix}"
        return "https://www.bilibili.com/"

    def _fetch_json(self, url: str, referer: str, options: dict[str, Any]) -> dict[str, Any]:
        payload = json.loads(self._fetch_text(url, referer, options))
        if not isinstance(payload, dict):
            raise ValueError("Bilibili API returned non-object JSON")
        if payload.get("code") not in (None, 0):
            raise ValueError(f"code {payload.get('code')}: {payload.get('message') or 'Bilibili API error'}")
        return payload

    def _fetch_text(self, url: str, referer: str, options: dict[str, Any]) -> str:
        timeout = max(1.0, _number(options.get("requestTimeoutMs") or 12000) / 1000)
        headers = self.builder.build_bilibili_web_headers(
            referer,
            {
                "cookie": options.get("cookie"),
                "userAgent": options.get("userAgent"),
            },
        )
        request = Request(url, headers=headers)
        with urlopen(request, timeout=timeout) as response:
            status = getattr(response, "status", 200)
            if status < 200 or status >= 300:
                raise ValueError(f"HTTP {status}")
            return response.read().decode("utf-8", errors="replace")


class DirectProbeLiveFetchPayloadRunner:
    """Run live direct-probe fetching from a JSON payload contract."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        request_log: list[dict[str, Any]] = []
        fetcher = self._build_fetcher(payload, request_log)
        try:
            comments = fetcher.fetch_video_comments(
                payload.get("video") if isinstance(payload.get("video"), dict) else {},
                payload.get("options") if isinstance(payload.get("options"), dict) else {},
            )
        except Exception as error:
            return {
                "ok": False,
                "error": str(error),
                "comments": [],
                "commentCount": 0,
                "requests": request_log,
            }
        return {
            "ok": True,
            "comments": comments,
            "commentCount": len(comments),
            "requests": request_log,
        }

    def _read_payload(self) -> dict[str, Any]:
        payload = self.reader.read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}

    def _build_fetcher(self, payload: dict[str, Any], request_log: list[dict[str, Any]]) -> DirectProbeLiveFetcher:
        json_responses = payload.get("jsonResponses") if isinstance(payload.get("jsonResponses"), dict) else None
        text_responses = payload.get("textResponses") if isinstance(payload.get("textResponses"), dict) else None
        if json_responses is None and text_responses is None:
            base_fetcher = DirectProbeLiveFetcher()

            def live_json(url: str, referer: str, options: dict[str, Any]) -> dict[str, Any]:
                request_log.append(self._request_log_entry("json", url, referer, options))
                return base_fetcher._fetch_json(url, referer, options)

            def live_text(url: str, referer: str, options: dict[str, Any]) -> str:
                request_log.append(self._request_log_entry("text", url, referer, options))
                return base_fetcher._fetch_text(url, referer, options)

            return DirectProbeLiveFetcher(fetch_json=live_json, fetch_text=live_text, builder=base_fetcher.builder)

        json_responses = json_responses or {}
        text_responses = text_responses or {}

        def fixture_json(url: str, referer: str, options: dict[str, Any]) -> dict[str, Any]:
            request_log.append(self._request_log_entry("json", url, referer, options))
            response = json_responses.get(url)
            if not isinstance(response, dict):
                raise ValueError(f"Missing fixture JSON response for {url}")
            return response

        def fixture_text(url: str, referer: str, options: dict[str, Any]) -> str:
            request_log.append(self._request_log_entry("text", url, referer, options))
            if url not in text_responses:
                raise ValueError(f"Missing fixture text response for {url}")
            return str(text_responses.get(url) or "")

        return DirectProbeLiveFetcher(fetch_json=fixture_json, fetch_text=fixture_text)

    def _request_log_entry(self, kind: str, url: str, referer: str, options: dict[str, Any]) -> dict[str, Any]:
        return {
            "kind": kind,
            "url": url,
            "referer": referer,
            "cookie": _clean_text(options.get("cookie")),
        }


class DirectProbeLiveFetchCommandRequest:
    """Argv-backed request for direct-probe live fetch JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Fetch Bilibili direct-probe comments from a JSON payload.")
        parser.add_argument("--payload", required=True, help="Path to a direct-probe live fetch JSON payload.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DirectProbeLiveFetchPayloadRunner(args.payload).run()


class DirectProbeCorpusBuilder:
    """Pure Python contract helpers for Bilibili direct evidence probe data."""

    def build_plan_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        action = payload.get("action") if isinstance(payload.get("action"), dict) else {}
        videos = payload.get("videos") if isinstance(payload.get("videos"), list) else []
        source = payload.get("source") or ""
        source_refs = self.extract_bilibili_video_refs(source)
        primary_ref = source_refs[0] if source_refs else {}
        cursor_payload = payload.get("cursorPayload") if isinstance(payload.get("cursorPayload"), dict) else {}
        query = action.get("query") or action.get("term") or ""
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        actions = payload.get("actions") if isinstance(payload.get("actions"), list) else ([action] if action else [])
        source_video_options = {
            "maxPerAction": payload.get("maxPerAction", 0),
            "corpus": payload.get("corpus") if isinstance(payload.get("corpus"), dict) else {},
        }
        result = {
            "ok": True,
            "needles": self.probe_search_needles(action),
            "rankedVideos": self.rank_probe_videos_for_action(videos, action),
            "sourceRefs": source_refs,
            "evidenceSourceVideos": self.build_evidence_source_videos_for_actions(dictionary, actions, source_video_options),
            "nextReplyCursor": self.next_reply_cursor(cursor_payload, payload.get("cursorFallback", 0)),
            "viewUrl": self.build_bilibili_view_url(primary_ref),
            "replyUrl": self.build_bilibili_reply_url(primary_ref, payload.get("replyPage", 0), payload.get("pageSize", 20)),
            "replyPageUrl": self.build_bilibili_reply_page_url(primary_ref, payload.get("replyPageNumber", 1), payload.get("pageSize", 20)),
            "replyThreadUrl": self.build_bilibili_reply_thread_url(
                primary_ref,
                primary_ref.get("rootRpid"),
                payload.get("replyThreadPage", 1),
                payload.get("pageSize", 20),
            ),
            "searchUrls": self.build_bilibili_search_urls(query, payload.get("searchOptions") if isinstance(payload.get("searchOptions"), dict) else {}),
            "pacing": RateLimitPolicy(
                min_delay_ms=payload.get("delayMs", 3000),
                jitter_ms=payload.get("jitterMs", 1500),
                block_cooldown_ms=0,
            ).to_direct_probe_options(),
        }
        if payload.get("referer"):
            result["headers"] = self.build_bilibili_web_headers(
                payload.get("referer"),
                {
                    "cookie": payload.get("cookie"),
                    "userAgent": payload.get("userAgent"),
                },
            )
        synthetic_cookie = payload.get("syntheticCookie") if isinstance(payload.get("syntheticCookie"), dict) else None
        if synthetic_cookie is not None:
            random_value = synthetic_cookie.get("randomValue", 0.5)
            result["syntheticCookie"] = self.make_synthetic_bilibili_cookie(
                random_fn=lambda: random_value,
                now_ms=synthetic_cookie.get("nowMs"),
            )
        return result

    GENERIC_QUERY_TOKENS = {
        "attack",
        "b站",
        "bilibili",
        "评论",
        "评论区",
        "评论回复",
        "回复",
        "回复区",
        "热评",
        "弹幕",
        "梗",
        "节奏",
        "b站评论",
    }

    def bounded_probe_videos_per_query(self, value: Any, fallback: int = 5) -> int:
        return self._bounded_int(value, fallback, 0, 20)

    def bounded_reply_cursor_skip_pages(self, value: Any, fallback: int = 0) -> int:
        return self._bounded_int(value, fallback, 0, 20)

    def probe_search_needles(self, action: dict[str, Any] | None = None) -> list[str]:
        action = action if isinstance(action, dict) else {}
        term = _clean_text(action.get("term"))
        query = _clean_text(action.get("query"))
        candidates = [term, *re.split(r"[\s,，、;；]+", query)]
        seen: set[str] = set()
        needles: list[str] = []
        for candidate in candidates:
            token = _clean_text(re.sub(r"^[\"'!?！？。；，,、()[\]【】]+|[\"'!?！？。；，,、()[\]【】]+$", "", candidate))
            if len(token) < 2 or token.lower() in self.GENERIC_QUERY_TOKENS or token in seen:
                continue
            seen.add(token)
            needles.append(token)
        return needles

    def score_probe_video_for_action(self, video: dict[str, Any] | None = None, action: dict[str, Any] | None = None) -> int:
        video = video if isinstance(video, dict) else {}
        action = action if isinstance(action, dict) else {}
        title = self._normalize_probe_text(video.get("title") or video.get("name") or video.get("description"))
        if not title:
            return 0
        score = 0
        term = self._normalize_probe_text(action.get("term"))
        if term and term in title:
            score += 100
        for needle in self.probe_search_needles(action):
            normalized = self._normalize_probe_text(needle)
            if not normalized or normalized == term:
                continue
            if normalized in title:
                score += 20 if len(normalized) >= 4 else 8
        return score

    def rank_probe_videos_for_action(self, videos: list[dict[str, Any]] | None, action: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        scored = [
            (self.score_probe_video_for_action(video, action), index, video)
            for index, video in enumerate(videos if isinstance(videos, list) else [])
            if isinstance(video, dict)
        ]
        return [item[2] for item in sorted(scored, key=lambda item: (-item[0], item[1]))]

    def probe_video_key(self, video: dict[str, Any] | None = None) -> str:
        video = video if isinstance(video, dict) else {}
        bvid = _clean_text(video.get("bvid")).rstrip("/")
        if bvid:
            return f"bvid:{bvid}"
        aid = re.sub(r"^av", "", _clean_text(video.get("aid")).rstrip("/"), flags=re.IGNORECASE)
        if aid:
            return f"aid:{aid}"
        return ""

    def extract_bilibili_video_refs(self, text: Any = "") -> list[dict[str, str]]:
        refs: list[dict[str, str]] = []
        seen: set[str] = set()
        source = str(text or "")
        pattern = re.compile(r"(?:https?://)?(?:www\.)?bilibili\.com/video/((?:BV[0-9A-Za-z]+)|(?:av\d+))")
        for match in pattern.finditer(source):
            video_id = match.group(1)
            ref: dict[str, str] = {"bvid": video_id} if video_id.startswith("BV") else {"aid": video_id[2:]}
            tail = source[match.start() : match.end() + 200]
            reply_match = re.search(r"[?&]reply=(\d+)", tail)
            if reply_match:
                ref["rootRpid"] = reply_match.group(1)
            key = f"bvid:{ref['bvid']}" if "bvid" in ref else f"aid:{ref['aid']}"
            if key in seen:
                continue
            seen.add(key)
            refs.append(ref)
        return refs

    def collect_scanned_probe_video_keys(self, corpus: dict[str, Any] | None = None) -> list[str]:
        corpus = corpus if isinstance(corpus, dict) else {}
        keys: set[str] = set()
        for run in corpus.get("runs") if isinstance(corpus.get("runs"), list) else []:
            if not isinstance(run, dict):
                continue
            for video in run.get("videos") if isinstance(run.get("videos"), list) else []:
                if not isinstance(video, dict):
                    continue
                key = _clean_text(video.get("key")) or self.probe_video_key(video)
                if key:
                    keys.add(key)
        for comment in corpus.get("comments") if isinstance(corpus.get("comments"), list) else []:
            if not isinstance(comment, dict):
                continue
            for ref in self.extract_bilibili_video_refs(comment.get("source")):
                key = self.probe_video_key(ref)
                if key:
                    keys.add(key)
        return sorted(keys)

    def filter_unscanned_probe_videos(self, videos: list[dict[str, Any]] | None = None, scanned_keys: set[str] | list[str] | None = None) -> list[dict[str, Any]]:
        scanned = set(scanned_keys or [])
        seen: set[str] = set()
        result: list[dict[str, Any]] = []
        for video in videos if isinstance(videos, list) else []:
            if not isinstance(video, dict):
                continue
            key = self.probe_video_key(video)
            if not key or key in seen or key in scanned:
                continue
            seen.add(key)
            result.append(video)
        return result

    def build_bilibili_view_url(self, video: dict[str, Any] | None = None) -> str | None:
        video = video if isinstance(video, dict) else {}
        params: dict[str, str] = {}
        if video.get("bvid"):
            params["bvid"] = _clean_text(video.get("bvid"))
        elif video.get("aid"):
            params["aid"] = _clean_text(video.get("aid"))
        else:
            return None
        return f"https://api.bilibili.com/x/web-interface/view?{urlencode(params)}"

    def build_bilibili_reply_url(self, video: dict[str, Any] | None = None, page: Any = 0, page_size: Any = 20) -> str | None:
        video = video if isinstance(video, dict) else {}
        if not video.get("aid"):
            return None
        params = {
            "type": "1",
            "oid": _clean_text(video.get("aid")),
            "mode": "3",
            "next": str(max(0, int(_number(page)))),
            "ps": str(max(1, min(int(_number(page_size) or 20), 50))),
        }
        return f"https://api.bilibili.com/x/v2/reply/main?{urlencode(params)}"

    def build_bilibili_reply_page_url(self, video: dict[str, Any] | None = None, page: Any = 1, page_size: Any = 20) -> str | None:
        video = video if isinstance(video, dict) else {}
        if not video.get("aid"):
            return None
        params = {
            "type": "1",
            "oid": _clean_text(video.get("aid")),
            "sort": "2",
            "pn": str(max(1, int(_number(page) or 1))),
            "ps": str(max(1, min(int(_number(page_size) or 20), 50))),
        }
        return f"https://api.bilibili.com/x/v2/reply?{urlencode(params)}"

    def build_bilibili_reply_thread_url(self, video: dict[str, Any] | None = None, root_rpid: Any = None, page: Any = 1, page_size: Any = 20) -> str | None:
        video = video if isinstance(video, dict) else {}
        root = root_rpid if root_rpid is not None else video.get("rootRpid")
        if not video.get("aid") or not root:
            return None
        params = {
            "type": "1",
            "oid": _clean_text(video.get("aid")),
            "root": _clean_text(root),
            "pn": str(max(1, int(_number(page) or 1))),
            "ps": str(max(1, min(int(_number(page_size) or 20), 50))),
        }
        return f"https://api.bilibili.com/x/v2/reply/reply?{urlencode(params)}"

    def next_reply_cursor(self, payload: dict[str, Any] | None = None, fallback: Any = 0) -> int | None:
        payload = payload if isinstance(payload, dict) else {}
        data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        cursor = data.get("cursor") if isinstance(data.get("cursor"), dict) else {}
        if cursor.get("is_end") is True or cursor.get("is_end") == 1:
            return None
        next_value = _number(cursor.get("next"))
        if next_value > 0:
            return int(next_value)
        return max(0, int(_number(fallback))) + 1

    def build_bilibili_search_urls(self, query: Any, options: dict[str, Any] | None = None) -> list[str]:
        options = options if isinstance(options, dict) else {}
        pages = max(1, min(int(_number(options.get("pages")) or 1), 10))
        page_size = max(1, min(int(_number(options.get("pageSize")) or 20), 20))
        urls = []
        for index in range(pages):
            params = {
                "search_type": "video",
                "keyword": _clean_text(query),
                "page": str(index + 1),
                "page_size": str(page_size),
            }
            urls.append(f"https://api.bilibili.com/x/web-interface/search/type?{urlencode(params)}")
        return urls

    def build_bilibili_web_headers(self, referer: Any, options: dict[str, Any] | None = None) -> dict[str, str]:
        options = options if isinstance(options, dict) else {}
        referer_text = _clean_text(referer)
        user_agent = options.get("userAgent") or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        )
        parsed = urlparse(referer_text)
        origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else "https://www.bilibili.com"
        headers = {
            "user-agent": user_agent,
            "accept": "application/json, text/plain, */*",
            "accept-language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
            "cache-control": "no-cache",
            "pragma": "no-cache",
            "referer": referer_text,
            "origin": origin,
            "sec-ch-ua": '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="99"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-mode": "cors",
            "sec-fetch-dest": "empty",
            "sec-fetch-site": "same-site",
        }
        if options.get("cookie"):
            headers["cookie"] = _clean_text(options.get("cookie"))
        return headers

    def make_synthetic_bilibili_cookie(self, random_fn: Callable[[], float] | None = None, now_ms: Any | None = None) -> str:
        rand = random_fn or random.random
        now_value = _number(now_ms) if now_ms is not None else time.time() * 1000
        epoch = int(now_value // 1000)

        def hex_chars(length: int) -> str:
            chars = []
            for _index in range(length):
                value = max(0, min(int(_number(rand()) * 16), 15))
                chars.append(format(value, "x").upper())
            return "".join(chars)

        return "; ".join(
            [
                f"buvid3={hex_chars(8)}-{hex_chars(4)}-{hex_chars(4)}-{hex_chars(4)}-{hex_chars(13)}infoc",
                f"buvid4={hex_chars(8)}-{hex_chars(4)}-{hex_chars(4)}-{hex_chars(4)}-{hex_chars(12)}-{epoch}-1",
                f"b_nut={epoch}",
                f"_uuid={hex_chars(8)}-{hex_chars(4)}-{hex_chars(4)}-{hex_chars(4)}-{hex_chars(15)}infoc",
                f"b_lsid={hex_chars(8)}_{hex_chars(10)}",
            ]
        )

    def build_evidence_source_videos_for_actions(
        self,
        dictionary: dict[str, Any] | None = None,
        actions: list[dict[str, Any]] | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, list[dict[str, str]]]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        options = options if isinstance(options, dict) else {}
        max_per_action = max(0, min(int(_number(options.get("maxPerAction"))), 50))
        if not max_per_action:
            return {}

        entries = {
            _clean_text(entry.get("term")): entry
            for entry in dictionary.get("entries") or []
            if isinstance(entry, dict) and _clean_text(entry.get("term"))
        }
        corpus_sources_by_message: dict[str, str] = {}
        corpus = options.get("corpus") if isinstance(options.get("corpus"), dict) else {}
        for comment in corpus.get("comments") if isinstance(corpus.get("comments"), list) else []:
            if not isinstance(comment, dict):
                continue
            message = _clean_text(comment.get("message"))
            if not message:
                continue
            source = _clean_text(comment.get("source"))
            existing = corpus_sources_by_message.get(message)
            if existing is None or self._corpus_source_recovery_priority(source) < self._corpus_source_recovery_priority(existing):
                corpus_sources_by_message[message] = source

        result: dict[str, list[dict[str, str]]] = {}
        for action in actions if isinstance(actions, list) else []:
            if not isinstance(action, dict):
                continue
            term = _clean_text(action.get("term"))
            if not term or term not in entries:
                continue
            entry = entries[term]
            candidate_sources: list[Any] = []
            candidate_sources.extend(
                source.get("source")
                for source in _list_field(entry, "evidenceSources")
                if isinstance(source, dict)
            )
            candidate_sources.extend(
                corpus_sources_by_message.get(_clean_text(sample))
                for sample in _list_field(entry, "evidenceSamples")
            )
            candidate_sources = sorted(candidate_sources, key=self._corpus_source_recovery_priority)
            videos: list[dict[str, str]] = []
            seen: set[str] = set()
            for source in candidate_sources:
                for ref in self.extract_bilibili_video_refs(source):
                    key = self.probe_video_key(ref)
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    videos.append({**ref, "title": f"existing evidence source for {term}"})
                    if len(videos) >= max_per_action:
                        break
                if len(videos) >= max_per_action:
                    break
            if videos:
                result[term] = videos
        return result

    def collect_reply_messages(self, replies: list[Any] | None, video: dict[str, Any] | None = None, bucket: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
        video = video or {}
        bucket = bucket if bucket is not None else []
        for reply in replies if isinstance(replies, list) else []:
            if not isinstance(reply, dict):
                continue
            message = _clean_text((reply.get("content") or {}).get("message") if isinstance(reply.get("content"), dict) else "")
            if message:
                bucket.append(
                    {
                        "message": message,
                        "uid": _clean_text(reply.get("mid") or (reply.get("member") or {}).get("mid")),
                        "source": self._source_for_video(video, "comment"),
                    }
                )
            self.collect_reply_messages(reply.get("replies"), video, bucket)
        return bucket

    def collect_danmaku_messages(self, xml: str, video: dict[str, Any] | None = None) -> list[dict[str, str]]:
        video = video or {}
        comments = []
        uid = _clean_text(video.get("bvid") or video.get("cid") or video.get("aid"))
        for match in re.finditer(r"<d\b[^>]*>([\s\S]*?)</d>", str(xml or ""), re.IGNORECASE):
            message = _clean_text(html.unescape(match.group(1)))
            if not message:
                continue
            comments.append({"message": message, "uid": uid, "source": self._source_for_video(video, "danmaku")})
        return comments

    def build_fresh_evidence_entries(self, dictionary: dict[str, Any] | None, comments: list[Any] | None, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        options = options or {}
        target_evidence = max(1, int(options.get("targetEvidence") or 3))
        max_samples = max(1, int(options.get("maxSamplesPerTerm") or 3))
        target_terms = {_clean_text(term) for term in options.get("targetTerms") or [] if _clean_text(term)}
        require_comment_backed = options.get("requireCommentBackedEvidence") is True
        entries = []

        for entry in (dictionary or {}).get("entries") or []:
            if not isinstance(entry, dict):
                continue
            term = _clean_text(entry.get("term"))
            if not term:
                continue
            if term not in target_terms and _coverage_evidence_count(entry, require_comment_backed) >= target_evidence:
                continue
            needles = _evidence_needles(entry)
            seen = _existing_samples(entry)
            matches = []
            for comment in comments if isinstance(comments, list) else []:
                if not isinstance(comment, dict):
                    continue
                message = _clean_text(comment.get("message"))
                if not message or message in seen or not any(needle in message for needle in needles):
                    continue
                seen.add(message)
                matches.append(
                    {
                        "source": _clean_text(comment.get("source")) or "Bilibili public direct comment probe",
                        "uid": _clean_text(comment.get("uid")),
                        "sample": message,
                    }
                )
                if len(matches) >= max_samples:
                    break
            if matches:
                entries.append(
                    {
                        "term": term,
                        "family": entry.get("family") or "attack",
                        "meaning": entry.get("meaning") or "",
                        "evidence": [match["sample"] for match in matches],
                        "evidenceSamples": [match["sample"] for match in matches],
                        "evidenceSources": matches,
                    }
                )
        return entries

    def build_probe_corpus(self, existing: dict[str, Any] | None, comments: list[Any] | None, run: dict[str, Any] | None = None) -> dict[str, Any]:
        existing = existing if isinstance(existing, dict) else {}
        run = run if isinstance(run, dict) else {}
        previous_comments = [
            comment for comment in existing.get("comments") or [] if isinstance(comment, dict) and self.is_analyzable_message(comment.get("message"))
        ]
        seen = {_clean_text(comment.get("message")) for comment in previous_comments if _clean_text(comment.get("message"))}
        next_comments = list(previous_comments)
        comments_added = 0

        for comment in comments if isinstance(comments, list) else []:
            if not isinstance(comment, dict):
                continue
            message = _clean_text(comment.get("message"))
            if not message or not self.is_analyzable_message(message) or message in seen:
                continue
            seen.add(message)
            comments_added += 1
            next_comments.append({"message": message, "source": _clean_text(comment.get("source")), "uid": _clean_text(comment.get("uid"))})

        at = _clean_text(run.get("at")) or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return {
            "version": int(existing.get("version") or 1),
            "comments": next_comments,
            "runs": [
                *(existing.get("runs") if isinstance(existing.get("runs"), list) else []),
                {**run, "at": at, "commentsCollected": len(comments or []), "commentsAdded": comments_added},
            ],
            "updatedAt": at,
        }

    def build_probe_corpus_result(self, existing: dict[str, Any] | None, comments: list[Any] | None, run: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"ok": True, "corpus": self.build_probe_corpus(existing, comments, run)}

    def is_analyzable_message(self, value: Any) -> bool:
        return _has_han(value)

    def _source_for_video(self, video: dict[str, Any], kind: str) -> str:
        prefix = f"Bilibili public direct {kind} probe"
        bvid = _clean_text(video.get("bvid"))
        aid = _clean_text(video.get("aid"))
        if bvid:
            return f"{prefix}: https://www.bilibili.com/video/{bvid}/"
        if aid:
            return f"{prefix}: https://www.bilibili.com/video/av{aid}/"
        return prefix

    def _bounded_int(self, value: Any, fallback: int, minimum: int, maximum: int) -> int:
        try:
            number = int(float(value))
        except (TypeError, ValueError):
            number = fallback
        return max(minimum, min(number, maximum))

    def _normalize_probe_text(self, value: Any) -> str:
        text = re.sub(r"<[^>]+>", "", _clean_text(value))
        text = re.sub(r"&[^;\s]+;", " ", text)
        return text.lower()

    def _corpus_source_recovery_priority(self, source: Any = "") -> int:
        text = _clean_text(source)
        if re.search(r"[?&]reply=\d+", text):
            return 0
        if "comment probe" in text or "reply detail probe" in text:
            return 1
        if "danmaku" in text:
            return 3
        return 2
