from __future__ import annotations

import base64
import re
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
            return [entry for entry in entries if audit._coverage_evidence_count(entry) < target_evidence]
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
            variants = self._query_variants_for_term(term, family, variants_per_term)
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
