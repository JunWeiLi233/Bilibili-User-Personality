from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder
from python_backend.analysis.harvest_plan import KeywordHarvestPlanBuilder


def term_attempt_key(term: Any) -> str:
    text = str(term or "")
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def _non_negative_int(value: Any) -> int:
    return max(0, int(_number(value)))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class HarvestTermAttemptSummarizer:
    """Summarize harvest termAttempts using the JS keyword-harvest JSON shape."""

    def __init__(self, strategy_version: int = 7):
        self.strategy_version = max(0, int(_number(strategy_version)))
        self.audit = CoverageAuditBuilder()
        self.plan_builder = KeywordHarvestPlanBuilder()

    def summarize(
        self,
        state: dict[str, Any] | None = None,
        dictionary: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        state = state if isinstance(state, dict) else {}
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        options = options if isinstance(options, dict) else {}
        entries = [entry for entry in dictionary.get("entries") or [] if isinstance(entry, dict)]
        attempts = self._current_attempts(state)
        attempted_terms = [item for item in attempts.values() if isinstance(item, dict) and _number(item.get("attempts")) > 0]
        successful_terms = [item for item in attempted_terms if self._effective_successful_attempts(item) > 0]
        entry_terms = {_clean_text(entry.get("term")) for entry in entries if _clean_text(entry.get("term"))}
        unattempted = [
            {"term": entry.get("term"), "family": entry.get("family"), "evidenceCount": self.audit._evidence_count(entry)}
            for entry in entries
            if _clean_text(entry.get("term")) and not self._get_attempt(attempts, _clean_text(entry.get("term")))
        ]
        repeatedly_missed = [
            {
                "term": item.get("term"),
                "family": item.get("family"),
                "attempts": _non_negative_int(item.get("attempts")),
                "lastQuery": item.get("lastQuery") or "",
                "lastError": item.get("lastError") or "",
            }
            for item in sorted(
                [item for item in attempted_terms if self._effective_successful_attempts(item) == 0],
                key=lambda item: (-_non_negative_int(item.get("attempts")), _clean_text(item.get("term"))),
            )[:20]
        ]
        exhausted = self._exhausted_terms(entries, attempts, options)
        return {
            "attemptedTerms": len([item for item in attempted_terms if _clean_text(item.get("term")) in entry_terms]),
            "successfulTerms": len([item for item in successful_terms if _clean_text(item.get("term")) in entry_terms]),
            "unattemptedTerms": len(unattempted),
            "unattemptedSamples": self.audit._sample_entries(unattempted)[:20],
            "repeatedlyMissedTerms": repeatedly_missed,
            "exhaustedTerms": len(exhausted),
            "exhaustedSamples": exhausted,
        }

    def _current_attempts(self, state: dict[str, Any]) -> dict[str, Any]:
        if "harvestStrategyVersion" in state and _number(state.get("harvestStrategyVersion")) < self.strategy_version:
            return {}
        attempts = state.get("termAttempts")
        return attempts if isinstance(attempts, dict) else {}

    def _get_attempt(self, attempts: dict[str, Any], term: str) -> dict[str, Any] | None:
        raw = attempts.get(term_attempt_key(term)) or attempts.get(term)
        return raw if isinstance(raw, dict) else None

    def _effective_successful_attempts(self, attempt: dict[str, Any]) -> int:
        successful = _non_negative_int(attempt.get("successfulAttempts"))
        if successful == 0 or "lastEvidenceCount" not in attempt:
            return successful
        return successful if _number(attempt.get("lastEvidenceCount")) != _number(attempt.get("evidenceAtPlanTime")) else 0

    def _attempted_queries(self, attempt: dict[str, Any]) -> set[str]:
        return {
            _clean_text(item.get("query"))
            for item in attempt.get("queries") or []
            if isinstance(item, dict) and _clean_text(item.get("query"))
        }

    def _exhausted_terms(self, entries: list[dict[str, Any]], attempts: dict[str, Any], options: dict[str, Any]) -> list[dict[str, Any]]:
        exhausted = []
        for entry in entries:
            term = _clean_text(entry.get("term"))
            if not term:
                continue
            family = _clean_text(entry.get("family") or "attack")
            attempt = self._get_attempt(attempts, term)
            if not attempt or self._effective_successful_attempts(attempt) > 0:
                continue
            tried = self._attempted_queries(attempt)
            if not tried:
                continue
            variants = self.plan_builder._query_variants_for_term(term, family, 10000)
            if not variants or not all(_clean_text(item.get("query")) in tried for item in variants):
                continue
            exhausted.append(
                {
                    "term": term,
                    "family": family,
                    "evidenceCount": self.audit._evidence_count(entry),
                    "attempts": _non_negative_int(attempt.get("attempts")),
                    "variantsTried": len(variants),
                    "lastQuery": attempt.get("lastQuery") or "",
                    "lastError": attempt.get("lastError") or "",
                    "suggestedQueries": [],
                }
            )
        exhausted.sort(key=lambda item: (item["evidenceCount"], item["term"]))
        return exhausted[:20]


class HarvestCoverageActionBuilder:
    """Build state-aware harvest coverage actions using the JS keyword-harvest JSON shape."""

    def __init__(self, strategy_version: int = 7):
        self.strategy_version = max(0, int(_number(strategy_version)))
        self.plan_builder = KeywordHarvestPlanBuilder()

    def build_actions(
        self,
        dictionary: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        state = state if isinstance(state, dict) else {}
        options = options if isinstance(options, dict) else {}
        target_evidence = max(1, int(_number(options.get("targetEvidence")) or 3))
        require_comment = options.get("requireCommentBackedEvidence") is True
        require_source = options.get("requireSourceBackedEvidence") is True or require_comment
        audit = CoverageAuditBuilder(
            target_evidence=target_evidence,
            require_source_backed_evidence=require_source,
            require_comment_backed_evidence=require_comment,
        )
        entries = audit._sort_entries_for_coverage([entry for entry in dictionary.get("entries") or [] if isinstance(entry, dict)])
        attempts = self._current_attempts(state)
        searched_queries = {_clean_text(query) for query in state.get("searchedQueries") or [] if _clean_text(query)}
        return [self._action_for_entry(entry, attempts, searched_queries, audit, target_evidence, options) for entry in entries]

    def _action_for_entry(
        self,
        entry: dict[str, Any],
        attempts: dict[str, Any],
        searched_queries: set[str],
        audit: CoverageAuditBuilder,
        target_evidence: int,
        options: dict[str, Any],
    ) -> dict[str, Any]:
        term = _clean_text(entry.get("term"))
        family = _clean_text(entry.get("family") or "attack")
        attempt = self._get_attempt(attempts, term)
        count = audit._evidence_count(entry)
        coverage_count = audit._coverage_evidence_count(entry)
        attempts_count = _non_negative_int((attempt or {}).get("attempts"))
        successful_attempts = self._effective_successful_attempts(attempt or {})
        tried_queries = self._attempted_queries(attempt or {}) | searched_queries
        needs_source_refresh = (
            (options.get("requireSourceBackedEvidence") is True or options.get("requireCommentBackedEvidence") is True)
            and count > 0
            and not audit._has_coverage_evidence_source(entry)
        )
        exhausted = self._is_exhausted(term, family, attempt or {}, tried_queries)
        next_variant = self._next_variant(term, family, tried_queries)
        status = "covered"
        action = "none"
        if needs_source_refresh:
            status = "source_gap"
            action = "refresh_source_metadata" if next_variant else "add_query_template"
        elif coverage_count < target_evidence and exhausted:
            status = "exhausted"
            action = "add_query_template"
        elif coverage_count < target_evidence and attempts_count == 0:
            status = "weak_unattempted"
            action = "harvest"
        elif coverage_count < target_evidence and successful_attempts == 0:
            status = "weak_missed"
            action = "retry_with_new_variant" if next_variant else "add_query_template"
        elif coverage_count < target_evidence:
            status = "weak_partial"
            action = "harvest_more_evidence"
        return {
            "term": term,
            "family": family,
            "status": status,
            "action": action,
            "evidenceCount": count,
            "coverageEvidenceCount": coverage_count,
            "sourcedEvidence": audit._has_coverage_evidence_source(entry),
            "recommendationGroup": term,
            "targetEvidence": target_evidence,
            "evidenceNeeded": max(0, target_evidence - coverage_count),
            "attempts": attempts_count,
            "successfulAttempts": successful_attempts,
            "duplicateAcceptedNoProgress": False,
            "currentCommentMisses": 0,
            "exhausted": exhausted,
            "nextQuery": next_variant.get("query") if action != "none" and next_variant else "",
            "suggestedQueries": [],
            "lastQuery": (attempt or {}).get("lastQuery") or "",
            "lastError": (attempt or {}).get("lastError") or "",
        }

    def _current_attempts(self, state: dict[str, Any]) -> dict[str, Any]:
        if "harvestStrategyVersion" in state and _number(state.get("harvestStrategyVersion")) < self.strategy_version:
            return {}
        attempts = state.get("termAttempts")
        return attempts if isinstance(attempts, dict) else {}

    def _get_attempt(self, attempts: dict[str, Any], term: str) -> dict[str, Any] | None:
        raw = attempts.get(term_attempt_key(term)) or attempts.get(term)
        return raw if isinstance(raw, dict) else None

    def _effective_successful_attempts(self, attempt: dict[str, Any]) -> int:
        successful = _non_negative_int(attempt.get("successfulAttempts"))
        if successful == 0 or "lastEvidenceCount" not in attempt:
            return successful
        return successful if _number(attempt.get("lastEvidenceCount")) != _number(attempt.get("evidenceAtPlanTime")) else 0

    def _attempted_queries(self, attempt: dict[str, Any]) -> set[str]:
        return {
            _clean_text(item.get("query"))
            for item in attempt.get("queries") or []
            if isinstance(item, dict) and _clean_text(item.get("query"))
        }

    def _next_variant(self, term: str, family: str, tried_queries: set[str]) -> dict[str, Any] | None:
        for variant in self.plan_builder._query_variants_for_term(term, family, 10000):
            if _clean_text(variant.get("query")) not in tried_queries:
                return variant
        return None

    def _is_exhausted(self, term: str, family: str, attempt: dict[str, Any], tried_queries: set[str]) -> bool:
        if not attempt or self._effective_successful_attempts(attempt) > 0 or not tried_queries:
            return False
        variants = self.plan_builder._query_variants_for_term(term, family, 10000)
        return bool(variants) and all(_clean_text(variant.get("query")) in tried_queries for variant in variants)


class HarvestStateFinalizer:
    """Build the persisted keyword-harvest state JSON contract after a run."""

    def __init__(self, strategy_version: int = 7):
        self.strategy_version = max(0, int(_number(strategy_version)))

    def finalize_state(
        self,
        previous_state: dict[str, Any] | None = None,
        searched_queries: list[Any] | None = None,
        scanned_bvids: list[Any] | None = None,
        term_attempts: dict[str, Any] | None = None,
        queries: list[Any] | None = None,
        results: list[dict[str, Any]] | None = None,
        warnings: list[Any] | None = None,
        growth: dict[str, Any] | None = None,
        coverage: dict[str, Any] | None = None,
        coverage_progress: dict[str, Any] | None = None,
        training_diagnostics: dict[str, Any] | None = None,
        query_diagnostics: list[dict[str, Any]] | None = None,
        accepted_evidence_count: int = 0,
        coverage_increasing_accepted_evidence_count: int = 0,
        term_attempt_summary: dict[str, Any] | None = None,
        backfilled_attempts: int = 0,
        finished_at: str | None = None,
    ) -> dict[str, Any]:
        previous_state = previous_state if isinstance(previous_state, dict) else {}
        results = results if isinstance(results, list) else []
        warnings = warnings if isinstance(warnings, list) else []
        growth = growth if isinstance(growth, dict) else {}
        coverage = coverage if isinstance(coverage, dict) else {}
        coverage_progress = coverage_progress if isinstance(coverage_progress, dict) else {}
        training_diagnostics = training_diagnostics if isinstance(training_diagnostics, dict) else {}
        query_diagnostics = query_diagnostics if isinstance(query_diagnostics, list) else []
        term_attempt_summary = term_attempt_summary if isinstance(term_attempt_summary, dict) else {}
        finished_at = finished_at or _now_iso()
        prior_runs = self._current_strategy_runs(previous_state)
        run = {
            "at": finished_at,
            "strategyVersion": self.strategy_version,
            "queries": len(queries if isinstance(queries, list) else []),
            "successfulQueries": sum(1 for item in results if isinstance(item, dict) and (item.get("result") or {}).get("ok")),
            "videosScanned": sum(len((item.get("result") or {}).get("videos") or []) for item in results if isinstance(item, dict)),
            "commentsCollected": sum(len((item.get("result") or {}).get("comments") or []) for item in results if isinstance(item, dict)),
            "evidenceRejected": _non_negative_int(training_diagnostics.get("evidenceRejected")),
            "trainingDiagnostics": training_diagnostics,
            "queryDiagnostics": query_diagnostics,
            "acceptedEvidenceCount": _non_negative_int(accepted_evidence_count),
            "coverageIncreasingAcceptedEvidenceCount": _non_negative_int(coverage_increasing_accepted_evidence_count),
            "dictionaryBefore": _non_negative_int(growth.get("before")),
            "dictionaryAfter": _non_negative_int(growth.get("after")),
            "dictionaryAdded": _non_negative_int(growth.get("added")),
            "weakTermsResolved": _non_negative_int(coverage_progress.get("weakTermsResolved")),
            "zeroEvidenceResolved": _non_negative_int(coverage_progress.get("zeroEvidenceResolved")),
            "evidenceGained": _non_negative_int(coverage_progress.get("evidenceGained")),
            "evidenceDeficitReduced": _non_negative_int(coverage_progress.get("evidenceDeficitReduced")),
            "attemptedTerms": _non_negative_int(term_attempt_summary.get("attemptedTerms")),
            "successfulTerms": _non_negative_int(term_attempt_summary.get("successfulTerms")),
            "unattemptedTerms": _non_negative_int(term_attempt_summary.get("unattemptedTerms")),
            "exhaustedTerms": _non_negative_int(term_attempt_summary.get("exhaustedTerms")),
            "backfilledAttempts": _non_negative_int(backfilled_attempts),
            "weakTerms": _non_negative_int(coverage.get("weakTerms")),
            "zeroEvidenceTerms": _non_negative_int(coverage.get("zeroEvidenceTerms")),
            "warnings": len(warnings),
        }
        return {
            "version": 1,
            "harvestStrategyVersion": self.strategy_version,
            "updatedAt": finished_at,
            "searchedQueries": sorted({_clean_text(query) for query in searched_queries or [] if _clean_text(query)}),
            "scannedBvids": sorted({_clean_text(bvid) for bvid in scanned_bvids or [] if _clean_text(bvid)}),
            "termAttempts": term_attempts if isinstance(term_attempts, dict) else {},
            "runs": [*prior_runs[-49:], run],
        }

    def _current_strategy_runs(self, state: dict[str, Any]) -> list[dict[str, Any]]:
        runs = [run for run in state.get("runs") or [] if isinstance(run, dict)]
        if "harvestStrategyVersion" not in state:
            return runs
        if _number(state.get("harvestStrategyVersion")) < self.strategy_version:
            return []
        return [run for run in runs if _number(run.get("strategyVersion")) >= self.strategy_version]


class HarvestStateSummary:
    """Shape harvest-state updates into the JS/Python comparator contract."""

    SUMMARY_KEYS = ("termAttempts", "backfilled")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        attempts = result.get("termAttempts") if isinstance(result.get("termAttempts"), dict) else {}
        summary: dict[str, Any] = {"termAttempts": attempts}
        if "backfilled" in result:
            summary["backfilled"] = result.get("backfilled")
        return summary


class HarvestStateContractComparator:
    """Compare harvest-state payloads using the JS/Python summary contract."""

    def __init__(self, summary: HarvestStateSummary | None = None):
        self.summary = summary or HarvestStateSummary()

    def compare(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {"ok": not mismatches, "mismatches": mismatches, "python": python_summary, "js": js_summary}


class HarvestTermAttemptUpdater:
    """Update keyword-harvest termAttempts using the JS keywordHarvest state contract."""

    def __init__(self, strategy_version: int = 0):
        self.strategy_version = max(0, int(_number(strategy_version)))
        self.plan_builder = KeywordHarvestPlanBuilder()

    def update_term_attempt(
        self,
        term_attempts: dict[str, Any] | None,
        plan_item: dict[str, Any] | None,
        result: dict[str, Any] | None,
        finished_at: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        attempts = dict(term_attempts or {})
        plan_item = plan_item if isinstance(plan_item, dict) else {}
        result = result if isinstance(result, dict) else {}
        options = options if isinstance(options, dict) else {}
        term = _clean_text(plan_item.get("term"))
        if not term:
            return attempts

        key = term_attempt_key(term)
        current = self._get_term_attempt(attempts, term) or {}
        accepted_terms = self._accepted_result_terms(result)
        evidence_entry = self._find_evidence_entry(result, term)
        dictionary_entry = self._find_result_dictionary_entry(result, term)
        planned_evidence_count = _number(plan_item.get("coverageEvidenceCount", plan_item.get("evidenceCount", current.get("evidenceAtPlanTime", 0))))
        evidence_entry_count = self._coverage_evidence_count(evidence_entry, options)
        dictionary_count = self._coverage_evidence_count(dictionary_entry, options)
        evidence_entry_gained = bool(result.get("ok")) and evidence_entry_count > planned_evidence_count
        dictionary_gained = bool(result.get("ok")) and term in accepted_terms and dictionary_count > planned_evidence_count
        hit = evidence_entry_gained or dictionary_gained
        hit_evidence_count = max(evidence_entry_count, dictionary_count)
        prior_successful = _non_negative_int(current.get("successfulAttempts"))
        if not hit and prior_successful > 0 and "evidenceAtPlanTime" in current:
            evidence_at_plan_time = current.get("evidenceAtPlanTime")
        else:
            evidence_at_plan_time = plan_item.get("evidenceCount", current.get("evidenceAtPlanTime", 0))
        at = finished_at or _now_iso()
        query_record = {
            "at": at,
            "query": plan_item.get("query"),
            "strategyVersion": self.strategy_version,
            "ok": bool(result.get("ok")),
            "hit": hit,
            "videos": len(result.get("videos") if isinstance(result.get("videos"), list) else []),
            "comments": len(result.get("comments") if isinstance(result.get("comments"), list) else []),
            "error": result.get("error") or "",
        }
        previous_queries = current.get("queries") if isinstance(current.get("queries"), list) else []
        attempts[key] = {
            "key": key,
            "term": term,
            "family": plan_item.get("family") or current.get("family") or "unknown",
            "evidenceAtPlanTime": evidence_at_plan_time,
            "lastVariantIndex": plan_item.get("variantIndex", current.get("lastVariantIndex", None)),
            "attempts": _non_negative_int(current.get("attempts")) + 1,
            "successfulAttempts": prior_successful + (1 if hit else 0),
            "lastAttemptAt": at,
            "lastSuccessfulAt": at if hit else current.get("lastSuccessfulAt") or None,
            "lastQuery": plan_item.get("query"),
            "lastError": "" if result.get("ok") else result.get("error") or "",
            "lastEvidenceCount": hit_evidence_count if hit else _non_negative_int(current.get("lastEvidenceCount")),
            "queries": [*previous_queries, query_record][-20:],
        }
        return attempts

    def backfill_searched_queries(
        self,
        term_attempts: dict[str, Any] | None,
        dictionary: dict[str, Any] | None,
        searched_queries: list[Any] | None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        attempts = dict(term_attempts or {})
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        options = options if isinstance(options, dict) else {}
        searched = {_clean_text(query) for query in searched_queries or [] if _clean_text(query)}
        backfilled_at = _clean_text(options.get("backfilledAt")) or _now_iso()
        strategy_version = max(0, int(_number(options.get("harvestStrategyVersion", self.strategy_version))))
        backfilled = 0
        entries = [entry for entry in dictionary.get("entries") or [] if isinstance(entry, dict)]

        for entry in entries:
            term = _clean_text(entry.get("term"))
            if not term:
                continue
            family = _clean_text(entry.get("family") or "attack")
            key = term_attempt_key(term)
            current = dict(self._get_term_attempt(attempts, term) or {})
            tried = {
                _clean_text(item.get("query"))
                for item in current.get("queries") or []
                if isinstance(item, dict) and _clean_text(item.get("query"))
            }
            for variant in self.plan_builder._query_variants_for_term(term, family, 10000):
                query = _clean_text(variant.get("query"))
                if not query or query not in searched or query in tried:
                    continue
                at = current.get("lastAttemptAt") or backfilled_at
                query_record = {
                    "at": at,
                    "query": query,
                    "strategyVersion": strategy_version,
                    "ok": True,
                    "hit": False,
                    "videos": 0,
                    "comments": 0,
                    "error": "backfilled from searched query history",
                }
                previous_queries = current.get("queries") if isinstance(current.get("queries"), list) else []
                next_attempt = {
                    "key": key,
                    "term": term,
                    "family": current.get("family") or family,
                    "evidenceAtPlanTime": current.get("evidenceAtPlanTime", _non_negative_int(entry.get("evidenceCount"))),
                    "lastVariantIndex": variant.get("variantIndex"),
                    "attempts": _non_negative_int(current.get("attempts")) + 1,
                    "successfulAttempts": _non_negative_int(current.get("successfulAttempts")),
                    "lastAttemptAt": at,
                    "lastSuccessfulAt": current.get("lastSuccessfulAt") or None,
                    "lastQuery": query,
                    "lastError": current.get("lastError") or "",
                    "lastEvidenceCount": _non_negative_int(current.get("lastEvidenceCount")),
                    "queries": [*previous_queries, query_record][-20:],
                }
                attempts[key] = next_attempt
                current = dict(next_attempt)
                tried.add(query)
                backfilled += 1
        return {"termAttempts": attempts, "backfilled": backfilled}

    def update_related_target_attempts(
        self,
        term_attempts: dict[str, Any] | None,
        dictionary: dict[str, Any] | None,
        plan_item: dict[str, Any] | None,
        result: dict[str, Any] | None,
        finished_at: str | None = None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        attempts = dict(term_attempts or {})
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        plan_item = plan_item if isinstance(plan_item, dict) else {}
        result = result if isinstance(result, dict) else {}
        options = options if isinstance(options, dict) else {}
        primary_term = _clean_text(plan_item.get("term"))
        if not primary_term:
            return attempts

        diagnostics = result.get("collectionDiagnostics") if isinstance(result.get("collectionDiagnostics"), dict) else {}
        targets = [_clean_text(term) for term in diagnostics.get("targetExistingTerms") or [] if _clean_text(term)]
        if not targets:
            return attempts
        entries = {
            _clean_text(entry.get("term")): entry
            for entry in dictionary.get("entries") or []
            if isinstance(entry, dict) and _clean_text(entry.get("term"))
        }
        related_attempt_terms = {_clean_text(term) for term in options.get("relatedAttemptTerms") or [] if _clean_text(term)}
        accepted_terms = self._accepted_result_terms(result)
        for term in targets:
            if not term or term == primary_term:
                continue
            if related_attempt_terms and term not in related_attempt_terms and term not in accepted_terms:
                continue
            entry = entries.get(term)
            attempts = self.update_term_attempt(
                attempts,
                {
                    **plan_item,
                    "term": term,
                    "family": (entry or {}).get("family") or plan_item.get("family"),
                    "evidenceCount": _non_negative_int((entry or {}).get("evidenceCount")) if entry else plan_item.get("evidenceCount"),
                },
                result,
                finished_at=finished_at,
                options=options,
            )
        return attempts

    def _get_term_attempt(self, term_attempts: dict[str, Any], term: str) -> dict[str, Any] | None:
        encoded = term_attempt_key(term)
        raw = term_attempts.get(encoded)
        if isinstance(raw, dict):
            return raw
        raw = term_attempts.get(term)
        return raw if isinstance(raw, dict) else None

    def _accepted_result_terms(self, result: dict[str, Any]) -> set[str]:
        terms: list[Any] = []
        diagnostics = result.get("collectionDiagnostics") if isinstance(result.get("collectionDiagnostics"), dict) else {}
        keyword_training = result.get("keywordTraining") if isinstance(result.get("keywordTraining"), dict) else {}
        if isinstance(diagnostics.get("acceptedTerms"), list):
            terms.extend(diagnostics.get("acceptedTerms") or [])
        if isinstance(result.get("entries"), list):
            terms.extend(entry.get("term") for entry in result.get("entries") if isinstance(entry, dict))
        if isinstance(keyword_training.get("dictionaryEvidenceEntries"), list):
            terms.extend(entry.get("term") for entry in keyword_training.get("dictionaryEvidenceEntries") if isinstance(entry, dict))
        return {_clean_text(term) for term in terms if _clean_text(term)}

    def _find_evidence_entry(self, result: dict[str, Any], term: str) -> dict[str, Any] | None:
        keyword_training = result.get("keywordTraining") if isinstance(result.get("keywordTraining"), dict) else {}
        entries = []
        if isinstance(result.get("entries"), list):
            entries.extend(result.get("entries") or [])
        if isinstance(keyword_training.get("dictionaryEvidenceEntries"), list):
            entries.extend(keyword_training.get("dictionaryEvidenceEntries") or [])
        return next((entry for entry in entries if isinstance(entry, dict) and _clean_text(entry.get("term")) == term), None)

    def _find_result_dictionary_entry(self, result: dict[str, Any], term: str) -> dict[str, Any] | None:
        dictionary = result.get("dictionary") if isinstance(result.get("dictionary"), dict) else {}
        entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        return next((entry for entry in entries if isinstance(entry, dict) and _clean_text(entry.get("term")) == term), None)

    def _coverage_evidence_count(self, entry: dict[str, Any] | None, options: dict[str, Any]) -> int:
        if not isinstance(entry, dict):
            return 0
        audit = CoverageAuditBuilder(require_comment_backed_evidence=options.get("requireCommentBackedEvidence") is True)
        return audit._coverage_evidence_count(entry)


class HarvestStatePayloadProcessor:
    """Dispatch JS-compatible harvest-state JSON payloads to class-owned state operations."""

    def process(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        strategy_version = payload.get("strategyVersion") or options.get("harvestStrategyVersion") or 0
        summary_strategy_version = payload.get("strategyVersion") or options.get("harvestStrategyVersion") or 7
        term_attempts = self._term_attempts_from_payload(payload)
        mode = str(payload.get("mode") or "").strip().lower()

        if mode == "summary":
            summarizer = HarvestTermAttemptSummarizer(strategy_version=summary_strategy_version)
            state = payload.get("state") if isinstance(payload.get("state"), dict) else {"termAttempts": term_attempts}
            dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
            return {"ok": True, "termAttemptSummary": summarizer.summarize(state, dictionary, options=options)}

        if mode == "coverage-actions":
            builder = HarvestCoverageActionBuilder(strategy_version=summary_strategy_version)
            state = payload.get("state") if isinstance(payload.get("state"), dict) else {"termAttempts": term_attempts}
            dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
            return {"ok": True, "coverageActions": builder.build_actions(dictionary, state, options=options)}

        if mode == "finalize":
            finalizer = HarvestStateFinalizer(strategy_version=summary_strategy_version)
            state = finalizer.finalize_state(
                previous_state=payload.get("previousState") if isinstance(payload.get("previousState"), dict) else payload.get("state"),
                searched_queries=payload.get("searchedQueries") if isinstance(payload.get("searchedQueries"), list) else [],
                scanned_bvids=payload.get("scannedBvids") if isinstance(payload.get("scannedBvids"), list) else [],
                term_attempts=term_attempts,
                queries=payload.get("queries") if isinstance(payload.get("queries"), list) else [],
                results=payload.get("results") if isinstance(payload.get("results"), list) else [],
                warnings=payload.get("warnings") if isinstance(payload.get("warnings"), list) else [],
                growth=payload.get("growth") if isinstance(payload.get("growth"), dict) else {},
                coverage=payload.get("coverage") if isinstance(payload.get("coverage"), dict) else {},
                coverage_progress=payload.get("coverageProgress") if isinstance(payload.get("coverageProgress"), dict) else {},
                training_diagnostics=payload.get("trainingDiagnostics") if isinstance(payload.get("trainingDiagnostics"), dict) else {},
                query_diagnostics=payload.get("queryDiagnostics") if isinstance(payload.get("queryDiagnostics"), list) else [],
                accepted_evidence_count=payload.get("acceptedEvidenceCount") or 0,
                coverage_increasing_accepted_evidence_count=payload.get("coverageIncreasingAcceptedEvidenceCount") or 0,
                term_attempt_summary=payload.get("termAttemptSummary") if isinstance(payload.get("termAttemptSummary"), dict) else {},
                backfilled_attempts=payload.get("backfilledAttempts") or 0,
                finished_at=payload.get("finishedAt"),
            )
            return {"ok": True, "state": state}

        updater = HarvestTermAttemptUpdater(strategy_version=strategy_version)
        if mode == "backfill":
            dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
            searched_queries = payload.get("searchedQueries") if isinstance(payload.get("searchedQueries"), list) else []
            result = updater.backfill_searched_queries(term_attempts, dictionary, searched_queries, options=options)
            return {"ok": True, **result}

        if mode == "related":
            dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
            next_attempts = updater.update_related_target_attempts(
                term_attempts,
                dictionary,
                payload.get("planItem") if isinstance(payload.get("planItem"), dict) else {},
                payload.get("result") if isinstance(payload.get("result"), dict) else {},
                finished_at=payload.get("finishedAt") or payload.get("attemptFinishedAt"),
                options=options,
            )
            return {"ok": True, "termAttempts": next_attempts}

        next_attempts = updater.update_term_attempt(
            term_attempts,
            payload.get("planItem") if isinstance(payload.get("planItem"), dict) else {},
            payload.get("result") if isinstance(payload.get("result"), dict) else {},
            finished_at=payload.get("finishedAt") or payload.get("attemptFinishedAt"),
            options=options,
        )
        return {"ok": True, "termAttempts": next_attempts}

    def _term_attempts_from_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        term_attempts = payload.get("termAttempts") if isinstance(payload.get("termAttempts"), dict) else {}
        if isinstance(payload.get("state"), dict) and isinstance(payload["state"].get("termAttempts"), dict):
            return payload["state"]["termAttempts"]
        return term_attempts
