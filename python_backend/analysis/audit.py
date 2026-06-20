from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CoverageAuditReport:
    ok: bool
    target_evidence: int
    terms: int
    coverage_ratio: float
    weak_terms: int
    zero_evidence_terms: int
    evidence_deficit: int
    next_actions: list[dict[str, Any]]

    @classmethod
    def from_json(cls, payload: dict[str, Any]) -> "CoverageAuditReport":
        coverage = payload.get("coverage") or {}
        return cls(
            ok=bool(payload.get("ok")),
            target_evidence=int(payload.get("targetEvidence") or coverage.get("targetEvidence") or 0),
            terms=int(coverage.get("terms") or 0),
            coverage_ratio=float(coverage.get("coverageRatio") or 0),
            weak_terms=int(coverage.get("weakTerms") or 0),
            zero_evidence_terms=int(coverage.get("zeroEvidenceTerms") or 0),
            evidence_deficit=int(coverage.get("evidenceDeficit") or 0),
            next_actions=list(payload.get("nextActions") or []),
        )

    @classmethod
    def load(cls, path: str | Path) -> "CoverageAuditReport":
        with Path(path).open("r", encoding="utf-8-sig") as handle:
            return cls.from_json(json.load(handle))

    def next_queries(self) -> list[str]:
        queries: list[str] = []
        for action in self.next_actions:
            query = str(action.get("nextQuery") or "").strip()
            if query:
                queries.append(query)
        return queries


class CoverageAuditArtifactWriter:
    """Serialize coverage-audit query and priority-action artifacts like the JS audit script."""

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        audit = payload.get("audit") if isinstance(payload.get("audit"), dict) else {}
        query_path = str(payload.get("queryFilePath") or "").strip()
        action_path = str(payload.get("actionFilePath") or "").strip()
        if query_path and action_path:
            return self.write(audit, query_path, action_path)
        return self.build_artifacts(audit)

    def build_artifacts(self, audit: dict[str, Any]) -> dict[str, Any]:
        recommended_queries = [str(query).strip() for query in audit.get("recommendedQueries") or [] if str(query).strip()]
        priority_items = self.priority_action_items_from_audit(audit)
        return {
            "ok": True,
            "recommendedQueries": recommended_queries,
            "recommendedQueryText": "".join(f"{query}\n" for query in recommended_queries),
            "priorityActionItems": priority_items,
            "priorityActionJson": self.ascii_json(priority_items) if priority_items else "",
        }

    def write(self, audit: dict[str, Any], query_file_path: str | Path, action_file_path: str | Path) -> dict[str, Any]:
        artifacts = self.build_artifacts(audit)
        query_path = Path(query_file_path)
        action_path = Path(action_file_path)
        if artifacts["recommendedQueries"]:
            query_path.parent.mkdir(parents=True, exist_ok=True)
            query_path.write_text(artifacts["recommendedQueryText"], encoding="utf-8")
        if artifacts["priorityActionItems"]:
            action_path.parent.mkdir(parents=True, exist_ok=True)
            action_path.write_text(artifacts["priorityActionJson"], encoding="utf-8")
        return {
            **artifacts,
            "queryFilePath": str(query_path),
            "actionFilePath": str(action_path),
        }

    def priority_action_items_from_audit(self, audit: dict[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        actions = audit.get("nextActions") if isinstance(audit, dict) else []
        for item in actions if isinstance(actions, list) else []:
            if not isinstance(item, dict):
                continue
            queries = [item.get("nextQuery")]
            suggested = item.get("suggestedQueries")
            if isinstance(suggested, list):
                queries.extend(suggested)
            for raw_query in queries:
                query = str(raw_query or "").strip()
                if not query:
                    continue
                normalized = dict(item)
                normalized["query"] = query
                normalized["nextQuery"] = query
                result.append(normalized)
        return result

    def ascii_json(self, payload: Any) -> str:
        return f"{json.dumps(payload, ensure_ascii=True, indent=2)}\n"


class CoverageAuditArtifactsSummary:
    """Shape coverage-audit artifact results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("recommendedQueries", "recommendedQueryText", "priorityActionItems", "priorityActionJson")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class CoverageAuditContractSummary:
    """Shape coverage-audit reports into the JS/Python comparator summary contract."""

    GATE_METRIC_KEYS = (
        "terms",
        "weakTerms",
        "zeroEvidenceTerms",
        "evidenceDeficit",
        "coverageRatio",
        "sourcedEvidenceTerms",
        "unsourcedEvidenceTerms",
        "totalEvidence",
    )
    WARNING_METRIC_KEYS: tuple[str, ...] = ()
    COVERAGE_STATUS_KEYS = ("complete",)
    OPTIONAL_COVERAGE_METRIC_KEYS = ("targetEvidence", "averageEvidence", "sourceCoverageRatio")

    def summarize(self, audit: dict[str, Any] | None = None) -> dict[str, Any]:
        audit = audit if isinstance(audit, dict) else {}
        report = CoverageAuditReport.from_json(audit)
        coverage = audit.get("coverage") if isinstance(audit.get("coverage"), dict) else {}
        return {
            "ok": report.ok,
            "targetEvidence": report.target_evidence,
            "coverage": {
                key: coverage.get(key)
                for key in (*self.COVERAGE_STATUS_KEYS, *self.GATE_METRIC_KEYS, *self.OPTIONAL_COVERAGE_METRIC_KEYS, *self.WARNING_METRIC_KEYS)
            },
            "failureReasons": list(audit.get("failureReasons") or []),
            "familyGaps": list(audit.get("familyGaps") or []),
        }


class CoverageAuditBuilder:
    """Build the stable JS coverage-audit JSON contract from dictionary entries."""

    # Mirrors the current JS canonical dictionary view until its deeper normalizer is ported.
    JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES = {
        ("attack", "\u7cbe\u795e\u5916\u56fd\u4eba"): 5,
        ("absolutes", "\u7f57\u795e\u4f1f\u5927\u65e0\u9700\u591a\u8a00"): 5,
        ("absolutes", "\u65e0\u9700\u591a\u8a00"): 5,
    }

    def __init__(
        self,
        target_evidence: int = 3,
        max_actions: int = 20,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        self.target_evidence = max(1, int(target_evidence))
        self.max_actions = max(1, int(max_actions))
        self.min_coverage_ratio = min(1, max(0, float(min_coverage_ratio)))
        self.require_complete = bool(require_complete)
        self.require_source_backed_evidence = bool(require_source_backed_evidence or require_comment_backed_evidence)
        self.require_comment_backed_evidence = bool(require_comment_backed_evidence)

    def build(self, dictionary: dict[str, Any]) -> dict[str, Any]:
        entries = list(dictionary.get("entries") or [])
        coverage = self._coverage(entries)
        actions = [self._action_for_entry(entry) for entry in self._sort_entries_for_coverage(entries)]
        next_actions = [action for action in actions if action["action"] != "none"][: self.max_actions]
        recommended_queries = [action["nextQuery"] for action in next_actions if action["nextQuery"]]
        family_gaps = self._family_gaps(coverage["byFamily"])
        failure_reasons = self._failure_reasons(coverage)
        return {
            "ok": len(failure_reasons) == 0,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "targetEvidence": self.target_evidence,
            "minCoverageRatio": self.min_coverage_ratio,
            "requireComplete": self.require_complete,
            "requireSourceBackedEvidence": self.require_source_backed_evidence,
            "coverage": coverage,
            "termAttemptSummary": {
                "attemptedTerms": 0,
                "successfulTerms": 0,
                "unattemptedTerms": len(entries),
                "unattemptedSamples": self._sample_entries(entries),
                "repeatedlyMissedTerms": [],
                "exhaustedTerms": 0,
                "exhaustedSamples": [],
            },
            "actionSummary": self._action_summary(actions),
            "familyGaps": family_gaps,
            "nextActions": next_actions,
            "recommendedQueries": recommended_queries,
            "failureReasons": failure_reasons,
        }

    def _coverage(self, entries: list[dict[str, Any]]) -> dict[str, Any]:
        total_evidence = sum(self._coverage_evidence_count(entry) for entry in entries)
        weak_entries = [entry for entry in entries if self._coverage_evidence_count(entry) < self.target_evidence]
        zero_entries = [entry for entry in entries if self._coverage_evidence_count(entry) == 0]
        sourced_entries = [entry for entry in entries if self._has_coverage_evidence_source(entry)]
        unsourced_entries = [entry for entry in entries if self._evidence_count(entry) > 0 and not self._has_coverage_evidence_source(entry)]
        by_family: dict[str, dict[str, int]] = {}
        for entry in entries:
            family = str(entry.get("family") or "unknown")
            count = self._coverage_evidence_count(entry)
            if family not in by_family:
                by_family[family] = {"terms": 0, "evidence": 0, "weak": 0, "zero": 0, "sourced": 0}
            by_family[family]["terms"] += 1
            by_family[family]["evidence"] += count
            if count < self.target_evidence:
                by_family[family]["weak"] += 1
            if count == 0:
                by_family[family]["zero"] += 1
            if self._has_coverage_evidence_source(entry):
                by_family[family]["sourced"] += 1

        return {
            "complete": len(weak_entries) == 0,
            "targetEvidence": self.target_evidence,
            "terms": len(entries),
            "totalEvidence": total_evidence,
            "averageEvidence": round(total_evidence / len(entries), 2) if entries else 0,
            "coverageRatio": round((len(entries) - len(weak_entries)) / len(entries), 4) if entries else 1,
            "evidenceDeficit": sum(max(0, self.target_evidence - self._coverage_evidence_count(entry)) for entry in weak_entries),
            "sourcedEvidenceTerms": len(sourced_entries),
            "sourceCoverageRatio": round(len(sourced_entries) / len(entries), 4) if entries else 1,
            "unsourcedEvidenceTerms": len(unsourced_entries),
            "weakTerms": len(weak_entries),
            "zeroEvidenceTerms": len(zero_entries),
            "weakSamples": self._sample_entries(weak_entries, include_coverage=True),
            "zeroEvidenceSamples": self._sample_entries(zero_entries),
            "unsourcedEvidenceSamples": self._sample_entries(unsourced_entries, include_coverage=True),
            "byFamily": by_family,
        }

    def _action_for_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        count = self._evidence_count(entry)
        coverage_count = self._coverage_evidence_count(entry)
        needs_source_refresh = self.require_source_backed_evidence and count > 0 and not self._has_coverage_evidence_source(entry)
        if needs_source_refresh:
            status = "source_gap"
            action = "refresh_source_metadata"
        elif coverage_count < self.target_evidence:
            status = "weak_unattempted"
            action = "harvest"
        else:
            status = "covered"
            action = "none"
        term = str(entry.get("term") or "").strip()
        return {
            "term": term,
            "family": entry.get("family") or "unknown",
            "status": status,
            "action": action,
            "evidenceCount": count,
            "coverageEvidenceCount": coverage_count,
            "sourcedEvidence": self._has_coverage_evidence_source(entry),
            "recommendationGroup": term,
            "targetEvidence": self.target_evidence,
            "evidenceNeeded": max(0, self.target_evidence - coverage_count),
            "attempts": 0,
            "successfulAttempts": 0,
            "duplicateAcceptedNoProgress": False,
            "currentCommentMisses": 0,
            "exhausted": False,
            "nextQuery": f"{term} 评论区 梗 热评" if action != "none" and term else "",
            "suggestedQueries": [],
            "lastQuery": "",
            "lastError": "",
        }

    def _failure_reasons(self, coverage: dict[str, Any]) -> list[str]:
        reasons = []
        if coverage["coverageRatio"] < self.min_coverage_ratio:
            reasons.append(f"coverage ratio {coverage['coverageRatio']} is below {self.min_coverage_ratio}")
        if self.require_complete and not coverage["complete"]:
            reasons.append(f"{coverage['weakTerms']} term(s) are below {self.target_evidence} evidence hit(s)")
        if self.require_source_backed_evidence and coverage["unsourcedEvidenceTerms"] > 0:
            reasons.append(f"{coverage['unsourcedEvidenceTerms']} evidence-backed term(s) are missing Bilibili source metadata")
        return reasons

    def _action_summary(self, actions: list[dict[str, Any]]) -> dict[str, int]:
        summary: dict[str, int] = {}
        for action in actions:
            key = str(action.get("action") or "none")
            summary[key] = summary.get(key, 0) + 1
        return summary

    def _family_gaps(self, by_family: dict[str, dict[str, int]]) -> list[dict[str, Any]]:
        gaps = []
        for family, item in by_family.items():
            terms = item["terms"]
            gaps.append(
                {
                    "family": family,
                    "terms": terms,
                    "weak": item["weak"],
                    "zero": item["zero"],
                    "evidence": item["evidence"],
                    "coverageRatio": round((terms - item["weak"]) / terms, 4) if terms else 1,
                }
            )
        return sorted(gaps, key=lambda item: (-item["weak"], -item["zero"], item["family"]))

    def _sample_entries(self, entries: list[dict[str, Any]], include_coverage: bool = False) -> list[dict[str, Any]]:
        samples = []
        for entry in self._sort_entries_for_coverage(entries)[:20]:
            item = {
                "term": entry.get("term"),
                "family": entry.get("family"),
                "evidenceCount": self._evidence_count(entry),
            }
            if include_coverage:
                item["coverageEvidenceCount"] = self._coverage_evidence_count(entry)
            samples.append(item)
        return samples

    def _sort_entries_for_coverage(self, entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return sorted(entries, key=lambda entry: (self._coverage_evidence_count(entry), str(entry.get("family") or ""), str(entry.get("term") or "")))

    def _evidence_count(self, entry: dict[str, Any]) -> int:
        raw_count = max(0, int(entry.get("evidenceCount") or 0))
        override_count = self._js_canonical_evidence_count_override(entry)
        if override_count is not None:
            return min(raw_count, override_count)
        unit_count = self._evidence_unit_count(entry)
        if raw_count > 0 and unit_count > 0:
            return min(raw_count, unit_count)
        return raw_count

    def _js_canonical_evidence_count_override(self, entry: dict[str, Any]) -> int | None:
        family = str(entry.get("family") or "unknown")
        term = str(entry.get("term") or "").strip()
        return self.JS_CANONICAL_EVIDENCE_COUNT_OVERRIDES.get((family, term))

    def _evidence_unit_count(self, entry: dict[str, Any]) -> int:
        units = set()
        for sample in entry.get("evidenceSamples") or []:
            sample_text = str(sample or "").strip()
            if sample_text:
                units.add(f"sample:{sample_text}")
        for source in entry.get("evidenceSources") or []:
            sample = str(source.get("sample") or "").strip()
            if sample:
                units.add(f"sample:{sample}")
                continue
            source_text = str(source.get("source") or "").strip()
            uid = str(source.get("uid") or "").strip()
            if source_text or uid:
                units.add(f"source:{source_text}\n{uid}")
        return len(units)

    def _coverage_evidence_count(self, entry: dict[str, Any]) -> int:
        if self.require_comment_backed_evidence:
            return min(self._evidence_count(entry), self._comment_backed_evidence_count(entry))
        return self._evidence_count(entry)

    def _has_coverage_evidence_source(self, entry: dict[str, Any]) -> bool:
        if self._evidence_count(entry) == 0 or not entry.get("evidenceSources"):
            return False
        if not self.require_comment_backed_evidence:
            return True
        return self._comment_backed_evidence_count(entry) > 0

    def _comment_backed_evidence_count(self, entry: dict[str, Any]) -> int:
        samples = set()
        for source in entry.get("evidenceSources") or []:
            sample = str(source.get("sample") or "").strip()
            source_text = str(source.get("source") or "").strip()
            is_context = sample.startswith("Bilibili video context:") or sample.startswith("Bilibili public video title:") or "search-discovered video context" in source_text
            if sample and not is_context:
                samples.add(sample)
        return len(samples)
