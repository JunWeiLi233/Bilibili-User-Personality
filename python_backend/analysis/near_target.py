from __future__ import annotations

import json
import re
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder


BVID_PATTERN = re.compile(r"(BV[0-9A-Za-z]{8,})")


class NearTargetResolvePlanner:
    """Build near-target resolver plans from dictionary entries and audit actions."""

    def __init__(
        self,
        *,
        target_evidence: int = 3,
        max_need: int = 1,
        batch: int = 12,
        videos_per_term: int = 3,
        pages: int = 3,
        override_terms: list[str] | None = None,
    ):
        self.target_evidence = max(1, int(target_evidence))
        self.max_need = max(1, int(max_need))
        self.batch = max(1, int(batch))
        self.videos_per_term = max(1, int(videos_per_term))
        self.pages = max(1, int(pages))
        self.override_terms = [str(term).strip() for term in override_terms or [] if str(term).strip()]

    def build_plan(self, dictionary: dict[str, Any] | None = None) -> dict[str, Any]:
        dictionary = dictionary if isinstance(dictionary, dict) else {}
        entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        by_term = {str(entry.get("term") or "").strip(): entry for entry in entries if isinstance(entry, dict) and str(entry.get("term") or "").strip()}
        candidates = self._candidate_terms(dictionary, by_term)
        pool_needles = candidates[:200]
        plans = []
        skipped = []
        for term in candidates[: self.batch]:
            entry = by_term.get(term) or {}
            bvids = self._extract_bvids(entry)[: self.videos_per_term]
            if not bvids:
                skipped.append({"term": term, "reason": "no_source_bvids"})
                continue
            plans.append(
                {
                    "term": term,
                    "family": entry.get("family") or "",
                    "evidenceNeeded": self._evidence_needed(entry),
                    "bvids": bvids,
                    "pages": self.pages,
                    "targetExistingTerms": self._unique([term, *pool_needles]),
                }
            )
        videos_planned = sum(len(plan["bvids"]) for plan in plans)
        return {
            "ok": True,
            "targetEvidence": self.target_evidence,
            "maxNeed": self.max_need,
            "batch": self.batch,
            "videosPerTerm": self.videos_per_term,
            "pages": self.pages,
            "candidateCount": len(candidates),
            "candidateTerms": candidates,
            "plannedCount": len(plans),
            "videosPlanned": videos_planned,
            "plans": plans,
            "skipped": skipped,
            "summary": {
                "candidateCount": len(candidates),
                "plannedCount": len(plans),
                "videosPlanned": videos_planned,
            },
        }

    def _candidate_terms(self, dictionary: dict[str, Any], by_term: dict[str, dict[str, Any]]) -> list[str]:
        if self.override_terms:
            return [term for term in self.override_terms if term in by_term]
        audit = CoverageAuditBuilder(
            target_evidence=self.target_evidence,
            max_actions=5000,
            min_coverage_ratio=1,
            require_complete=True,
            require_source_backed_evidence=True,
            require_comment_backed_evidence=True,
        ).build(dictionary)
        terms = []
        for action in audit.get("nextActions") if isinstance(audit.get("nextActions"), list) else []:
            term = str(action.get("term") or "").strip()
            evidence_needed = max(0, int(float(action.get("evidenceNeeded") or 0)))
            if term and term in by_term and 1 <= evidence_needed <= self.max_need:
                terms.append(term)
        return self._unique(terms)

    def _evidence_needed(self, entry: dict[str, Any]) -> int:
        audit = CoverageAuditBuilder(
            target_evidence=self.target_evidence,
            require_source_backed_evidence=True,
            require_comment_backed_evidence=True,
        )
        return max(0, self.target_evidence - audit._coverage_evidence_count(entry))

    def _extract_bvids(self, entry: dict[str, Any]) -> list[str]:
        raw = json.dumps(entry.get("evidenceSources") or [], ensure_ascii=False)
        return self._unique(match.group(1) for match in BVID_PATTERN.finditer(raw))

    def _unique(self, items: Any) -> list[str]:
        seen = set()
        result = []
        for item in items:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            result.append(text)
        return result
