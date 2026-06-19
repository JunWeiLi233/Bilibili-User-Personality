from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> int:
    try:
        return max(0, int(float(value or 0)))
    except (TypeError, ValueError):
        return 0


class VideoKeywordDiscoveryReporter:
    """Serialize video keyword discovery reports using the JS harvest-loop JSON contract."""

    def __init__(self, now: Callable[[], str] | None = None):
        self.now = now or self._iso_now

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
