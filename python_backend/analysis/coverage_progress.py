from __future__ import annotations

from typing import Any


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _positive_delta(before: Any, after: Any) -> int | float:
    return max(0, _number(after) - _number(before))


def _reduction(before: Any, after: Any) -> int | float:
    return max(0, _number(before) - _number(after))


def _json_number(value: float) -> int | float:
    return int(value) if float(value).is_integer() else value


class CoverageProgressTracker:
    """Evaluate coverage-gate progress using the same JSON fields as JS harvest loops."""

    def coverage_delta(self, before: dict[str, Any] | None = None, after: dict[str, Any] | None = None) -> dict[str, int | float]:
        before = before or {}
        after = after or {}
        ratio_delta = float(f"{(_number(after.get('coverageRatio')) - _number(before.get('coverageRatio'))):.4f}")
        return {
            "evidenceDeficitReduced": _json_number(_reduction(before.get("evidenceDeficit"), after.get("evidenceDeficit"))),
            "zeroEvidenceResolved": _json_number(_reduction(before.get("zeroEvidenceTerms"), after.get("zeroEvidenceTerms"))),
            "weakTermsResolved": _json_number(_reduction(before.get("weakTerms"), after.get("weakTerms"))),
            "unsourcedEvidenceReduced": _json_number(_reduction(before.get("unsourcedEvidenceTerms"), after.get("unsourcedEvidenceTerms"))),
            "totalEvidenceGained": _json_number(_positive_delta(before.get("totalEvidence"), after.get("totalEvidence"))),
            "termsAdded": _json_number(_positive_delta(before.get("terms"), after.get("terms"))),
            "coverageRatioDelta": _json_number(ratio_delta),
        }

    def has_coverage_delta_progress(self, delta: dict[str, Any] | None = None) -> bool:
        delta = delta or {}
        return (
            _number(delta.get("evidenceDeficitReduced")) > 0
            or _number(delta.get("zeroEvidenceResolved")) > 0
            or _number(delta.get("weakTermsResolved")) > 0
            or _number(delta.get("unsourcedEvidenceReduced")) > 0
            or _number(delta.get("totalEvidenceGained")) > 0
        )

    def coverage_delta_from_harvest(
        self,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        harvest_progress_items: list[dict[str, Any]] | None = None,
    ) -> dict[str, int | float]:
        items = harvest_progress_items if isinstance(harvest_progress_items, list) else []
        harvest_made_evidence_progress = any(
            _number(item.get("evidenceDeficitReduced")) > 0
            or _number(item.get("zeroEvidenceResolved")) > 0
            or _number(item.get("weakTermsResolved")) > 0
            or _number(item.get("evidenceGained")) > 0
            for item in items
            if isinstance(item, dict)
        )
        return self.coverage_delta(before, after) if harvest_made_evidence_progress else self.zero_delta()

    def action_progress_delta(
        self,
        before_actions: list[dict[str, Any]] | None = None,
        after_actions: list[dict[str, Any]] | None = None,
    ) -> dict[str, int | float]:
        after_by_term: dict[str, dict[str, Any]] = {}
        for action in after_actions if isinstance(after_actions, list) else []:
            if not isinstance(action, dict):
                continue
            term = str(action.get("term") or "").strip()
            if term:
                after_by_term[term] = action
        action_terms_resolved = 0
        action_evidence_need_reduced: int | float = 0
        for action in before_actions if isinstance(before_actions, list) else []:
            if not isinstance(action, dict):
                continue
            term = str(action.get("term") or "").strip()
            if not term:
                continue
            before_need = self._action_need(action)
            after_action = after_by_term.get(term)
            if not after_action:
                action_terms_resolved += 1
                action_evidence_need_reduced += before_need
                continue
            action_evidence_need_reduced += max(0, before_need - self._action_need(after_action))
        return {
            "actionTermsResolved": action_terms_resolved,
            "actionEvidenceNeedReduced": _json_number(action_evidence_need_reduced),
        }

    def has_coverage_gate_progress(
        self,
        before: dict[str, Any] | None = None,
        after: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
    ) -> bool:
        options = options or {}
        delta = self.coverage_delta(before, after)
        action_delta = self.action_progress_delta(options.get("beforeActions"), options.get("afterActions"))
        return (
            delta["evidenceDeficitReduced"] > 0
            or delta["zeroEvidenceResolved"] > 0
            or delta["weakTermsResolved"] > 0
            or delta["unsourcedEvidenceReduced"] > 0
            or action_delta["actionTermsResolved"] > 0
            or action_delta["actionEvidenceNeedReduced"] > 0
        )

    def zero_delta(self) -> dict[str, int | float]:
        return {
            "evidenceDeficitReduced": 0,
            "zeroEvidenceResolved": 0,
            "weakTermsResolved": 0,
            "unsourcedEvidenceReduced": 0,
            "totalEvidenceGained": 0,
            "termsAdded": 0,
            "coverageRatioDelta": 0,
        }

    def _action_need(self, action: dict[str, Any]) -> int | float:
        return max(0, _number(action.get("needs")))
