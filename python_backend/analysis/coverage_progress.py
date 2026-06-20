from __future__ import annotations

import base64
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder


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


class CoverageProgressSummary:
    """Shape coverage-progress results into the JS/Python comparator summary contract."""

    RESULT_KEYS = (
        "delta",
        "harvestDelta",
        "actionDelta",
        "exhaustedTerms",
        "hasDeltaProgress",
        "hasHarvestProgress",
        "hasGateProgress",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class CoverageProgressTracker:
    """Evaluate coverage-gate progress using the same JSON fields as JS harvest loops."""

    def run_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        before = payload.get("before") if isinstance(payload.get("before"), dict) else {}
        after = payload.get("after") if isinstance(payload.get("after"), dict) else {}
        harvest_progress = payload.get("harvestProgress") if isinstance(payload.get("harvestProgress"), list) else []
        options = {
            "beforeActions": payload.get("beforeActions") if isinstance(payload.get("beforeActions"), list) else [],
            "afterActions": payload.get("afterActions") if isinstance(payload.get("afterActions"), list) else [],
        }
        delta = self.coverage_delta(before, after)
        harvest_delta = self.coverage_delta_from_harvest(before, after, harvest_progress)
        action_delta = self.action_progress_delta(options["beforeActions"], options["afterActions"])
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        state = payload.get("state") if isinstance(payload.get("state"), dict) else {}
        exhausted_options = payload.get("exhaustedOptions") if isinstance(payload.get("exhaustedOptions"), dict) else {}
        return {
            "ok": True,
            "delta": delta,
            "harvestDelta": harvest_delta,
            "actionDelta": action_delta,
            "exhaustedTerms": self.select_exhausted_terms(dictionary, state, exhausted_options),
            "hasDeltaProgress": self.has_coverage_delta_progress(delta),
            "hasHarvestProgress": self.has_coverage_delta_progress(harvest_delta),
            "hasGateProgress": self.has_coverage_gate_progress(before, after, options),
        }

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

    def select_exhausted_terms(
        self,
        dictionary: dict[str, Any] | None = None,
        state: dict[str, Any] | None = None,
        options: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        options = options or {}
        target_evidence = _positive_int(options.get("targetEvidence"), 3, 1000)
        attempt_threshold = _positive_int(options.get("attemptThreshold"), 10, 100000)
        require_zero_evidence = options.get("requireZeroEvidence") is not False
        audit_builder = CoverageAuditBuilder(
            target_evidence=target_evidence,
            require_source_backed_evidence=options.get("requireSourceBackedEvidence") is True,
            require_comment_backed_evidence=options.get("requireCommentBackedEvidence") is True,
        )
        term_attempts = state.get("termAttempts") if isinstance(state, dict) and isinstance(state.get("termAttempts"), dict) else {}
        exhausted: list[dict[str, Any]] = []
        entries = dictionary.get("entries") if isinstance(dictionary, dict) and isinstance(dictionary.get("entries"), list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            term = str(entry.get("term") or "").strip()
            if not term:
                continue
            evidence = audit_builder._coverage_evidence_count(entry)
            if evidence >= target_evidence:
                continue
            if require_zero_evidence and evidence > 0:
                continue
            attempts = max(0, int(_number((self._term_attempt(term_attempts, term) or {}).get("attempts"))))
            if attempts >= attempt_threshold:
                exhausted.append({"term": term, "family": entry.get("family") or "", "attempts": attempts, "evidence": evidence})
        return exhausted

    def _action_need(self, action: dict[str, Any]) -> int | float:
        if "needs" in action:
            return max(0, _number(action.get("needs")))
        return max(0, _number(action.get("evidenceNeeded")))

    def _term_attempt(self, term_attempts: dict[str, Any], term: str) -> dict[str, Any] | None:
        raw = term_attempts.get(term)
        if isinstance(raw, dict):
            return raw
        encoded = term_attempts.get(_term_attempt_key(term))
        return encoded if isinstance(encoded, dict) else None


def _positive_int(value: Any, fallback: int, max_value: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return min(max_value, max(1, parsed))


def _term_attempt_key(term: str) -> str:
    encoded = base64.urlsafe_b64encode(term.encode("utf-8")).decode("ascii")
    return encoded.rstrip("=")
