from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


class VideoKeywordDiscoveryReportSummary:
    """Shape video keyword discovery reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "report", "priorityActionItems", "trainingDiagnostics", "queryDiagnostics", "roundSummary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class VideoKeywordDiscoveryReportContractComparator:
    """Compare discovery reports using the JS/Python JSON contract."""

    def __init__(self, summary: VideoKeywordDiscoveryReportSummary | None = None):
        self.summary = summary or VideoKeywordDiscoveryReportSummary()

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


class VideoKeywordDiscoveryReportRunner:
    """Build a video keyword discovery report from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "report").strip().lower()
        if mode == "diagnostics":
            return HarvestDiagnostics().build_from_payload(payload)
        return VideoKeywordDiscoveryReporter().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class VideoKeywordDiscoveryReportPayloadContractComparator:
    """Compare file-backed Python discovery reports against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoKeywordDiscoveryReportSummary()
        self.comparator = VideoKeywordDiscoveryReportContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = VideoKeywordDiscoveryReportRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class VideoKeywordDiscoveryReporter:
    """Serialize video keyword discovery reports using the JS harvest-loop JSON contract."""

    def __init__(self, now: Callable[[], str] | None = None):
        self.now = now or self._iso_now

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        reporter = VideoKeywordDiscoveryReporter(now=(lambda: str(payload["generatedAt"])) if payload.get("generatedAt") else self.now)
        result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        report = reporter.serialize_report(result, str(payload.get("statePath") or ""), str(payload.get("reportPath") or ""))
        return {
            "ok": True,
            "mode": "report",
            "report": report,
            "priorityActionItems": reporter.priority_action_items_from_harvest_result(result),
        }

    def priority_action_items_from_coverage_actions(self, actions: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for action in actions if isinstance(actions, list) else []:
            if not isinstance(action, dict) or not action.get("action") or action.get("action") == "none":
                continue
            queries = [_clean_text(action.get("nextQuery"))]
            if isinstance(action.get("suggestedQueries"), list):
                queries.extend(_clean_text(query) for query in action.get("suggestedQueries"))
            for query in [query for query in queries if query]:
                item = dict(action)
                item["query"] = query
                item["nextQuery"] = query
                items.append(item)
        return items

    def priority_action_items_from_harvest_result(self, result: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        result = result or {}
        actions = result.get("priorityCoverageActions")
        if not isinstance(actions, list) or not actions:
            actions = result.get("coverageActions")
        return self.priority_action_items_from_coverage_actions(actions)

    def serialize_report(self, result: dict[str, Any], state_path: str, report_path: str) -> dict[str, Any]:
        rounds = result.get("rounds") if isinstance(result.get("rounds"), list) else []
        return {
            "generatedAt": self.now(),
            "statePath": state_path,
            "reportPath": report_path,
            "requestedRounds": result.get("requestedRounds"),
            "growth": result.get("growth"),
            "coverage": result.get("coverage"),
            "coverageActions": result.get("coverageActions"),
            "state": result.get("state"),
            "rounds": [self._serialize_round(round_item, index) for index, round_item in enumerate(rounds)],
        }

    def count_accepted_evidence_hits_for_result(self, result: dict[str, Any] | None = None) -> int:
        sample_keys: set[str] = set()
        fallback_counts: dict[str, int] = {}
        for entry in self._accepted_evidence_entries(result or {}):
            term = _clean_text(entry.get("term"))
            if not term:
                continue
            sample_count = 0
            for sample in entry.get("evidenceSamples") if isinstance(entry.get("evidenceSamples"), list) else []:
                clean = _clean_text(sample)
                if clean:
                    sample_keys.add(f"{term}\0{clean}")
                    sample_count += 1
            for source in entry.get("evidenceSources") if isinstance(entry.get("evidenceSources"), list) else []:
                if not isinstance(source, dict):
                    continue
                clean = _clean_text(source.get("sample"))
                if clean:
                    sample_keys.add(f"{term}\0{clean}")
                    sample_count += 1
            if sample_count == 0:
                fallback_counts[term] = max(fallback_counts.get(term, 0), _number(entry.get("evidenceCount")))
        for key in sample_keys:
            fallback_counts.pop(key.split("\0")[0], None)
        return len(sample_keys) + sum(fallback_counts.values())

    def _serialize_round(self, round_item: dict[str, Any], index: int) -> dict[str, Any]:
        round_item = round_item if isinstance(round_item, dict) else {}
        results = round_item.get("results") if isinstance(round_item.get("results"), list) else []
        return {
            "round": index + 1,
            "queries": round_item.get("queries"),
            "candidateQueries": round_item.get("candidateQueries"),
            "growth": round_item.get("growth"),
            "coverage": round_item.get("coverage"),
            "coverageProgress": round_item.get("coverageProgress"),
            "acceptedEvidenceCount": round_item.get("acceptedEvidenceCount") or 0,
            "coverageIncreasingAcceptedEvidenceCount": round_item.get("coverageIncreasingAcceptedEvidenceCount") or 0,
            "termAttemptSummary": round_item.get("termAttemptSummary"),
            "trainingDiagnostics": round_item.get("trainingDiagnostics"),
            "queryDiagnostics": round_item.get("queryDiagnostics"),
            "warnings": round_item.get("warnings"),
            "results": [self._serialize_result(item, round_item) for item in results],
        }

    def _serialize_result(self, item: dict[str, Any], round_item: dict[str, Any]) -> dict[str, Any]:
        item = item if isinstance(item, dict) else {}
        result = item.get("result") if isinstance(item.get("result"), dict) else {}
        videos = result.get("videos") if isinstance(result.get("videos"), list) else []
        comments = result.get("comments") if isinstance(result.get("comments"), list) else []
        keyword_training = result.get("keywordTraining") if isinstance(result.get("keywordTraining"), dict) else {}
        query = item.get("query")
        return {
            "query": query,
            "ok": bool(result.get("ok")),
            "error": result.get("error") or "",
            "videos": [
                {"bvid": video.get("bvid"), "title": video.get("title"), "sourceUrl": video.get("sourceUrl")}
                for video in videos
                if isinstance(video, dict)
            ],
            "comments": len(comments),
            "evidenceRejected": keyword_training.get("evidenceRejected") or 0,
            "existingDictionaryEvidence": keyword_training.get("dictionaryEvidenceEntries") or [],
            "acceptedEvidenceCount": self.count_accepted_evidence_hits_for_result(result),
            "controversialPopularQueries": result.get("controversialPopularQueries") or [],
            "controversialPopularSearchOrder": result.get("controversialPopularSearchOrder") if result.get("controversialPopularSearchOrder") is not None else None,
            "plan": self._plan_item_for_query(round_item.get("plan"), query),
            "entries": result.get("entries") or [],
        }

    def _accepted_evidence_entries(self, result: dict[str, Any]) -> list[dict[str, Any]]:
        entries: list[dict[str, Any]] = []
        if isinstance(result.get("entries"), list):
            entries.extend(entry for entry in result.get("entries") if isinstance(entry, dict))
        keyword_training = result.get("keywordTraining") if isinstance(result.get("keywordTraining"), dict) else {}
        if isinstance(keyword_training.get("dictionaryEvidenceEntries"), list):
            entries.extend(entry for entry in keyword_training.get("dictionaryEvidenceEntries") if isinstance(entry, dict))
        return entries

    def _plan_item_for_query(self, plan: Any, query: Any) -> dict[str, Any] | None:
        if not isinstance(plan, list):
            return None
        for item in plan:
            if isinstance(item, dict) and item.get("query") == query:
                return item
        return None

    def _iso_now(self) -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class HarvestDiagnostics:
    """Summarize harvest result diagnostics using the JS keyword-harvest contract."""

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        results = payload.get("results") if isinstance(payload.get("results"), list) else []
        round_item = payload.get("round") if isinstance(payload.get("round"), dict) else {"results": results}
        return {
            "ok": True,
            "mode": "diagnostics",
            "trainingDiagnostics": self.summarize_training_diagnostics(results),
            "queryDiagnostics": self.summarize_query_diagnostics(results),
            "roundSummary": self.summarize_round(round_item),
        }

    def count_accepted_evidence_hits(self, entries: list[dict[str, Any]] | None = None) -> int:
        total = 0
        for entry in entries if isinstance(entries, list) else []:
            if not isinstance(entry, dict):
                continue
            samples: set[str] = set()
            for sample in entry.get("evidenceSamples") if isinstance(entry.get("evidenceSamples"), list) else []:
                clean = _clean_text(sample)
                if clean:
                    samples.add(clean)
            for source in entry.get("evidenceSources") if isinstance(entry.get("evidenceSources"), list) else []:
                if not isinstance(source, dict):
                    continue
                clean = _clean_text(source.get("sample"))
                if clean:
                    samples.add(clean)
            total += len(samples) or _number(entry.get("evidenceCount"))
        return total

    def summarize_training_diagnostics(self, results: list[dict[str, Any]] | None = None) -> dict[str, int]:
        diagnostics = {
            "deepseekCalls": 0,
            "fallbackCalls": 0,
            "evidenceRejected": 0,
            "dictionaryEvidenceTerms": 0,
            "dictionaryEvidenceCount": 0,
            "generatedTerms": 0,
        }
        for item in results if isinstance(results, list) else []:
            result = item.get("result") if isinstance(item, dict) and isinstance(item.get("result"), dict) else {}
            training = result.get("keywordTraining") if isinstance(result.get("keywordTraining"), dict) else None
            if not training:
                continue
            if training.get("available") and training.get("keyConfigured"):
                diagnostics["deepseekCalls"] += 1
            if training.get("usedFallback"):
                diagnostics["fallbackCalls"] += 1
            diagnostics["evidenceRejected"] += _number(training.get("evidenceRejected"))
            dictionary_entries = training.get("dictionaryEvidenceEntries") if isinstance(training.get("dictionaryEvidenceEntries"), list) else []
            diagnostics["dictionaryEvidenceTerms"] += len(dictionary_entries)
            diagnostics["dictionaryEvidenceCount"] += self.count_accepted_evidence_hits(dictionary_entries)
            generated = training.get("generatedEntries")
            if isinstance(generated, list):
                diagnostics["generatedTerms"] += len(generated)
            else:
                entries = result.get("entries") if isinstance(result.get("entries"), list) else []
                diagnostics["generatedTerms"] += len(entries)
        return diagnostics

    def summarize_query_diagnostics(self, results: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        summaries: list[dict[str, Any]] = []
        for item in results if isinstance(results, list) else []:
            result = item.get("result") if isinstance(item, dict) and isinstance(item.get("result"), dict) else {}
            diagnostics = result.get("collectionDiagnostics") if isinstance(result.get("collectionDiagnostics"), dict) else {}
            summaries.append(
                {
                    "query": item.get("query") if isinstance(item, dict) else None,
                    "ok": bool(result.get("ok")),
                    "error": result.get("error") or "",
                    "discoveredVideos": _number(diagnostics.get("discoveredVideos")),
                    "discoveryContextVideos": _number(diagnostics.get("discoveryContextVideos")),
                    "scannedVideos": _number(diagnostics.get("scannedVideos")),
                    "commentsCollected": _number(diagnostics.get("commentsCollected")),
                    "trainingTextChars": _number(diagnostics.get("trainingTextChars")),
                    "targetExistingTerms": diagnostics.get("targetExistingTerms") if isinstance(diagnostics.get("targetExistingTerms"), list) else [],
                    "targetTextHits": diagnostics.get("targetTextHits") if isinstance(diagnostics.get("targetTextHits"), list) else [],
                    "acceptedTerms": diagnostics.get("acceptedTerms") if isinstance(diagnostics.get("acceptedTerms"), list) else [],
                    "evidenceRejected": _number(diagnostics.get("evidenceRejected")),
                    "sampleVideos": diagnostics.get("sampleVideos")[:5] if isinstance(diagnostics.get("sampleVideos"), list) else [],
                }
            )
        return summaries

    def summarize_round(self, round_item: dict[str, Any] | None = None) -> dict[str, Any]:
        round_item = round_item if isinstance(round_item, dict) else {}
        results = round_item.get("results") if isinstance(round_item.get("results"), list) else []
        ok_results = [item for item in results if isinstance(item, dict) and isinstance(item.get("result"), dict) and item["result"].get("ok")]
        return {
            "okResults": len(ok_results),
            "videosScanned": sum(len(item["result"].get("videos") if isinstance(item["result"].get("videos"), list) else []) for item in ok_results),
            "commentsCollected": sum(len(item["result"].get("comments") if isinstance(item["result"].get("comments"), list) else []) for item in ok_results),
            "evidenceRejected": sum(_number(item["result"].get("keywordTraining", {}).get("evidenceRejected") if isinstance(item["result"].get("keywordTraining"), dict) else 0) for item in ok_results),
            "acceptedEvidenceCount": sum(VideoKeywordDiscoveryReporter().count_accepted_evidence_hits_for_result(item.get("result") or {}) for item in ok_results),
            "existingDictionaryEvidenceTerms": sum(len(item["result"].get("keywordTraining", {}).get("dictionaryEvidenceEntries") or []) if isinstance(item["result"].get("keywordTraining"), dict) else 0 for item in ok_results),
        }
