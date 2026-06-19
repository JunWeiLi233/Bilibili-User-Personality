from __future__ import annotations

import json
from dataclasses import dataclass
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
        with Path(path).open("r", encoding="utf-8") as handle:
            return cls.from_json(json.load(handle))

    def next_queries(self) -> list[str]:
        queries: list[str] = []
        for action in self.next_actions:
            query = str(action.get("nextQuery") or "").strip()
            if query:
                queries.append(query)
        return queries
