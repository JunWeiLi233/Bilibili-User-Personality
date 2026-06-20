from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder


FAMILY_CONTEXT = {
    "attack": "\u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4",
    "absolutes": "\u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4",
    "evidence": "\u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a",
    "evasion": "\u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4",
    "cooperation": "\u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4",
    "correction": "\u66f4\u6b63 \u8bc4\u8bba\u533a",
}

DEFAULT_SEED_QUERIES = [
    "\u4e2d\u6587\u4e92\u8054\u7f51 \u6897 \u8bc4\u8bba\u533a",
    "\u8bc4\u8bba\u533a \u70ed\u8bc4 \u6897",
    "\u4e89\u8bae \u70ed\u8bc4 \u8bc4\u8bba\u533a",
    "\u8f9f\u8c23 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a",
    "\u79d1\u666e \u6570\u636e \u5f15\u7528 \u8bc4\u8bba",
    "\u53d1\u94fe\u63a5 \u8d34\u539f\u6587 \u51fa\u5904 \u8bc4\u8bba",
    "\u4fee\u6b63 \u66f4\u6b63 \u9053\u6b49 \u8bc4\u8bba",
    "\u4e0d\u4f1a\u767e\u5ea6 \u81ea\u5df1\u67e5 \u81ea\u5df1\u641c \u8bc4\u8bba",
    "\u7edd\u5bf9 \u5168\u662f \u6839\u672c\u6ca1\u6709 \u8bc4\u8bba",
    "\u6c34\u519b \u6d17\u5730 \u7ad9\u961f \u8bc4\u8bba\u533a",
]


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _positive_int(value: Any, fallback: int, maximum: int = 10000) -> int:
    try:
        parsed = int(float(value))
    except (TypeError, ValueError):
        parsed = fallback
    return min(maximum, max(1, parsed))


def _unique(items: list[Any]) -> list[Any]:
    seen = set()
    result = []
    for item in items:
        key = item if isinstance(item, str) else id(item)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


class KeywordHarvestPlanBuilder:
    """Build the JS keyword-harvest query-plan JSON contract from dictionary/state data."""

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        plan = self.build_query_plan(dictionary, options)
        return {"ok": True, "plan": plan, "queries": [item["query"] for item in plan]}

    def build_query_plan(self, dictionary: dict[str, Any] | None = None, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        options = options if isinstance(options, dict) else {}
        max_queries = _positive_int(options.get("maxQueries"), 12)
        coverage_mode = _clean_text(options.get("coverageMode") or "balanced").lower()
        target_evidence = _positive_int(options.get("targetEvidence"), 3, 1000)
        seed_queries = self._seed_queries(options)
        priority_queries = options.get("priorityQueries") if isinstance(options.get("priorityQueries"), list) else self._parse_template_list(options.get("priorityQueries"))
        entries = self._entries_for_plan(dictionary, options, target_evidence, coverage_mode)
        action_map = {self._entry_term(entry): self._action_for_entry(entry, options, target_evidence) for entry in entries}

        dictionary_plan = self._dictionary_plan(entries, options, coverage_mode)
        priority_plan = self._priority_plan(priority_queries, action_map)
        seed_plan = [{"query": query, "source": "seed"} for query in seed_queries]
        ordered = [*priority_plan, *dictionary_plan, *seed_plan] if coverage_mode == "all-weak" else [*priority_plan, *seed_plan, *dictionary_plan]
        return self._dedupe_and_limit(ordered, max_queries)

    def build_queries(self, dictionary: dict[str, Any] | None = None, options: dict[str, Any] | None = None) -> list[str]:
        return [item["query"] for item in self.build_query_plan(dictionary, options)]

    def _entries_for_plan(self, dictionary: dict[str, Any], options: dict[str, Any], target_evidence: int, coverage_mode: str) -> list[dict[str, Any]]:
        entries = [entry for entry in dictionary.get("entries") or [] if isinstance(entry, dict) and self._entry_term(entry)]
        audit = CoverageAuditBuilder(
            target_evidence=target_evidence,
            require_source_backed_evidence=options.get("requireSourceBackedEvidence") is True or options.get("requireCommentBackedEvidence") is True,
            require_comment_backed_evidence=options.get("requireCommentBackedEvidence") is True,
        )
        entries = sorted(entries, key=lambda entry: (audit._coverage_evidence_count(entry), _clean_text(entry.get("family") or "attack"), self._entry_term(entry)))
        if coverage_mode == "all-weak":
            require_source = options.get("requireSourceBackedEvidence") is True or options.get("requireCommentBackedEvidence") is True
            weak_entries = [
                entry
                for entry in entries
                if audit._coverage_evidence_count(entry) < target_evidence
                or (require_source and audit._evidence_count(entry) > 0 and not audit._has_coverage_evidence_source(entry))
            ]
            return self._sort_all_weak_entries(weak_entries, options, audit, target_evidence)
        family_counts: dict[str, int] = {}
        limit = _positive_int(options.get("termsPerFamily"), 4, 20)
        selected = []
        for entry in entries:
            family = _clean_text(entry.get("family") or "attack")
            if family_counts.get(family, 0) >= limit:
                continue
            family_counts[family] = family_counts.get(family, 0) + 1
            selected.append(entry)
        return selected

    def _sort_all_weak_entries(
        self,
        entries: list[dict[str, Any]],
        options: dict[str, Any],
        audit: CoverageAuditBuilder,
        target_evidence: int,
    ) -> list[dict[str, Any]]:
        term_attempts = options.get("termAttempts") if isinstance(options.get("termAttempts"), dict) else {}
        retry_limit = max(0, int(float(options.get("retryBeforeUnattemptedLimit", 3) or 0)))

        def rank(entry: dict[str, Any]) -> tuple[int, int, int, str, str]:
            term = self._entry_term(entry)
            attempt = self._term_attempt(term_attempts, term) or {}
            attempts = max(0, int(float(attempt.get("attempts") or 0)))
            successful = self._effective_successful_attempts(attempt)
            if attempts > 0 and successful == 0 and attempts < retry_limit:
                group = 0
            elif attempts == 0:
                group = 1
            else:
                group = 2
            evidence_needed = max(0, target_evidence - audit._coverage_evidence_count(entry))
            return (group, audit._coverage_evidence_count(entry), evidence_needed, _clean_text(entry.get("family") or "attack"), term)

        return sorted(entries, key=rank)

    def _dictionary_plan(self, entries: list[dict[str, Any]], options: dict[str, Any], coverage_mode: str) -> list[dict[str, Any]]:
        variants_per_term = _positive_int(options.get("queryVariantsPerTerm"), 2)
        term_attempts = options.get("termAttempts") if isinstance(options.get("termAttempts"), dict) else {}
        plan = []
        for entry in entries:
            term = self._entry_term(entry)
            family = _clean_text(entry.get("family") or "attack")
            attempt = self._term_attempt(term_attempts, term) or {}
            attempts = max(0, int(float(attempt.get("attempts") or 0)))
            successful = self._effective_successful_attempts(attempt)
            tried = {_clean_text(item.get("query")) for item in attempt.get("queries") or [] if isinstance(item, dict) and _clean_text(item.get("query"))}
            adaptive_variants_per_term = variants_per_term
            if coverage_mode == "all-weak" and attempts > 0 and successful == 0:
                adaptive_variants_per_term = min(
                    self._query_variant_count_for_term(term, family),
                    max(variants_per_term, attempts + variants_per_term),
                )
            variants = self._query_variants_for_term(term, family, adaptive_variants_per_term)
            if coverage_mode == "all-weak":
                variants = [*([item for item in variants if item["query"] not in tried]), *([item for item in variants if item["query"] in tried])]
            for variant in variants:
                metadata = self._metadata_for_entry(entry, options, attempts, successful)
                plan.append(
                    {
                        "query": variant["query"],
                        "source": "dictionary",
                        "term": metadata["term"],
                        "family": metadata["family"],
                        "evidenceCount": metadata["evidenceCount"],
                        "sourcedEvidence": metadata["sourcedEvidence"],
                        "recommendationGroup": metadata["recommendationGroup"],
                        "priorAttempts": metadata["priorAttempts"],
                        "priorSuccessfulAttempts": metadata["priorSuccessfulAttempts"],
                        "variantIndex": variant["variantIndex"],
                        "builtInVariant": variant["builtInVariant"],
                        "previouslyTried": variant["query"] in tried,
                    }
                )
        return plan

    def _priority_plan(self, priority_queries: list[Any], action_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        plan = []
        actions = list(action_map.values())
        for item in priority_queries:
            provided = item if isinstance(item, dict) else None
            query = _clean_text((provided or {}).get("nextQuery") or (provided or {}).get("query") or item)
            if not query:
                continue
            matched = provided or next((action for action in actions if action.get("nextQuery") == query or query in action.get("suggestedQueries", [])), None)
            if not matched:
                plan.append({"query": query, "source": "priority"})
                continue
            priority = {"query": query, "source": "priority"}
            for key in ["term", "family"]:
                if _clean_text(matched.get(key)):
                    priority[key] = _clean_text(matched.get(key))
            if "evidenceCount" in matched:
                priority["evidenceCount"] = max(0, int(float(matched.get("evidenceCount") or 0)))
            if "sourcedEvidence" in matched:
                priority["sourcedEvidence"] = matched.get("sourcedEvidence") is True
            if _clean_text(matched.get("recommendationGroup")):
                priority["recommendationGroup"] = _clean_text(matched.get("recommendationGroup"))
            if "attempts" in matched:
                priority["priorAttempts"] = max(0, int(float(matched.get("attempts") or 0)))
            if "successfulAttempts" in matched:
                priority["priorSuccessfulAttempts"] = max(0, int(float(matched.get("successfulAttempts") or 0)))
            priority["variantIndex"] = None
            priority["builtInVariant"] = True
            priority["previouslyTried"] = False
            plan.append(priority)
        return plan

    def _action_for_entry(self, entry: dict[str, Any], options: dict[str, Any], target_evidence: int) -> dict[str, Any]:
        metadata = self._metadata_for_entry(entry, options, 0, 0)
        return {
            **metadata,
            "action": "harvest",
            "nextQuery": self._query_variants_for_term(metadata["term"], metadata["family"], 1)[0]["query"],
            "suggestedQueries": [],
            "attempts": 0,
            "successfulAttempts": 0,
            "targetEvidence": target_evidence,
        }

    def _metadata_for_entry(self, entry: dict[str, Any], options: dict[str, Any], attempts: int, successful: int) -> dict[str, Any]:
        audit = CoverageAuditBuilder(require_comment_backed_evidence=options.get("requireCommentBackedEvidence") is True)
        term = self._entry_term(entry)
        return {
            "source": "dictionary",
            "term": term,
            "family": _clean_text(entry.get("family") or "attack"),
            "evidenceCount": audit._evidence_count(entry),
            "sourcedEvidence": audit._has_coverage_evidence_source(entry),
            "recommendationGroup": term,
            "priorAttempts": attempts,
            "priorSuccessfulAttempts": successful,
        }

    def _query_variants_for_term(self, term: str, family: str, limit: int) -> list[dict[str, Any]]:
        queries = [
            f"{term} {FAMILY_CONTEXT.get(family, '\u8bc4\u8bba\u533a \u70ed\u8bc4')}",
            f"{term} \u8bc4\u8bba\u533a",
            f"{term} \u70ed\u8bc4",
            f"{term} \u5f39\u5e55",
            f"{term} \u4e89\u8bae \u8bc4\u8bba\u533a",
        ]
        variants = [{"query": self._normalize_query(query), "variantIndex": index, "builtInVariant": True} for index, query in enumerate(queries)]
        return _unique(variants)[:limit]

    def _query_variant_count_for_term(self, term: str, family: str) -> int:
        return len(self._query_variants_for_term(term, family, 10000))

    def _dedupe_and_limit(self, items: list[dict[str, Any]], max_queries: int) -> list[dict[str, Any]]:
        seen = set()
        result = []
        for item in items:
            query = _clean_text(item.get("query"))
            if not query or query in seen:
                continue
            seen.add(query)
            result.append({**item, "query": query})
            if len(result) >= max_queries:
                break
        return result

    def _seed_queries(self, options: dict[str, Any]) -> list[str]:
        if "seedQueries" in options:
            return [_clean_text(item) for item in options.get("seedQueries") or [] if _clean_text(item)]
        return DEFAULT_SEED_QUERIES

    def _parse_template_list(self, value: Any) -> list[str]:
        return [item.strip() for item in re.split(r"[\r\n;|]+", str(value or "")) if item.strip()]

    def _entry_term(self, entry: dict[str, Any]) -> str:
        return _clean_text(entry.get("term"))

    def _term_attempt(self, term_attempts: dict[str, Any], term: str) -> dict[str, Any] | None:
        raw = term_attempts.get(term)
        if isinstance(raw, dict):
            return raw
        encoded = term_attempts.get(base64.urlsafe_b64encode(term.encode("utf-8")).decode("ascii").rstrip("="))
        return encoded if isinstance(encoded, dict) else None

    def _effective_successful_attempts(self, attempt: dict[str, Any]) -> int:
        successful = max(0, int(float(attempt.get("successfulAttempts") or 0)))
        if successful == 0 or "lastEvidenceCount" not in attempt:
            return successful
        return successful if float(attempt.get("lastEvidenceCount") or 0) != float(attempt.get("evidenceAtPlanTime") or 0) else 0

    def _normalize_query(self, query: str) -> str:
        seen = set()
        tokens = []
        for token in str(query or "").strip().split():
            if token and token not in seen:
                seen.add(token)
                tokens.append(token)
        return " ".join(tokens)


class KeywordHarvestPlanSummary:
    """Shape keyword harvest plans into the JS/Python comparator contract."""

    RESULT_KEYS = ("queries", "plan")
    PLAN_KEYS = ("query", "source", "term", "family")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        plan = result.get("plan") if isinstance(result.get("plan"), list) else []
        return {
            "queries": result.get("queries") if isinstance(result.get("queries"), list) else [item.get("query") for item in plan if isinstance(item, dict)],
            "plan": [
                {key: item.get(key) for key in self.PLAN_KEYS}
                for item in plan
                if isinstance(item, dict)
            ],
        }


class KeywordHarvestPlanContractComparator:
    """Compare keyword harvest plan payloads using the shared summary contract."""

    def __init__(self, summary: KeywordHarvestPlanSummary | None = None):
        self.summary = summary or KeywordHarvestPlanSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class KeywordHarvestPlanRunner:
    """Build keyword-harvest query plans from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = KeywordHarvestPlanBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.builder.build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class KeywordHarvestPlanPayloadContractComparator:
    """Compare Python keyword-harvest plans against saved JS-compatible plan JSON."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.summary = KeywordHarvestPlanSummary()
        self.comparator = KeywordHarvestPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = KeywordHarvestPlanRunner(self.payload_path).run()
        js_result = self._read_js_plan()
        return self.comparator.compare(python_result, js_result)

    def _read_js_plan(self) -> dict[str, Any]:
        if not self.js_plan_path.exists():
            return {}
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
