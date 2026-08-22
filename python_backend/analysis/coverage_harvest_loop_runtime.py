from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditBuilder
from python_backend.analysis.coverage_progress import CoverageProgressTracker
from python_backend.runtime.json_contracts import JsonContractReader


class CoverageHarvestLoopRuntimeGate:
    """Describe whether the Python coverage-loop command can own the requested runtime."""

    LIVE_HARVEST_BLOCKER = {
        "blocker": "live_harvest_runtime_not_integrated",
        "reason": "Python coverage-loop command owns no-live audit and mock cycle contracts, but live harvesting is still delegated to the legacy JS runtime.",
    }

    def describe(self, *, audit: dict[str, Any] | None = None, max_cycles: int = 0) -> dict[str, Any]:
        audit = audit if isinstance(audit, dict) else {}
        if audit.get("ok") is True:
            return {"runtimeMode": "no_live_audit_gate"}
        if max_cycles <= 0:
            return {"runtimeMode": "no_live_cycle_limit"}
        return {"runtimeMode": "deferred_live_harvest", "replacementBlockers": [dict(self.LIVE_HARVEST_BLOCKER)]}


class CoverageHarvestLoopExternalHarvestAdapter:
    """Execute an external JSON harvest command for Python-owned loop orchestration."""

    def __init__(self, command: list[Any] | str):
        if isinstance(command, str):
            try:
                parsed = json.loads(command)
            except json.JSONDecodeError as error:
                raise ValueError(f"harvest command must be valid JSON: {error}") from error
        else:
            parsed = command
        if not isinstance(parsed, list) or not parsed:
            raise ValueError("harvest command must be a non-empty JSON array")
        if not all(isinstance(item, (str, int, float, bool)) or item is None for item in parsed):
            raise ValueError("harvest command tokens must be strings, numbers, booleans, or null")
        if not str(parsed[0]).strip():
            raise ValueError("harvest command executable must be non-empty")
        self.command = [str(item) for item in parsed]

    def preflight(self) -> dict[str, Any]:
        return {
            "ok": True,
            "runtimeMode": "external_harvest_preflight",
            "willExecute": False,
            "commandTemplate": list(self.command),
            "commandPreview": [part.replace("{payload}", "<payload>") for part in self.command],
            "payloadPlaceholder": "{payload}",
            "environment": {
                "PYTHONUTF8": "1",
                "PYTHONIOENCODING": "utf-8",
            },
        }

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="coverage-loop-harvest-") as temp_dir:
            payload_path = Path(temp_dir) / "request.json"
            payload_path.write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            command = [part.replace("{payload}", str(payload_path)) for part in self.command]
            completed = subprocess.run(
                command,
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
                env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
            )
        if not completed.stdout.strip():
            raise ValueError("external harvest command produced no JSON output")
        try:
            output = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            raise ValueError(f"external harvest command returned invalid JSON: {error}") from error
        if not isinstance(output, dict):
            raise ValueError("external harvest command must return a JSON object")
        return output


class CoverageHarvestLoopExternalHarvestRequestBuilder:
    """Build the JSON request passed from Python loop orchestration to harvest adapters."""

    def __init__(
        self,
        *,
        dictionary_path: str | Path,
        state_path: str | Path,
        report_path: str | Path,
        deepseek: dict[str, Any] | None = None,
        rounds_per_cycle: int = 1,
        max_queries: int = 12,
        target_evidence: int = 3,
        max_actions: int = 12,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        prioritize_source_gaps: bool = False,
        retry_before_unattempted_limit: int = 3,
        include_danmaku: bool = False,
        reset_state: bool = False,
        skip_seen: bool = True,
        discovery_options: dict[str, Any] | None = None,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.report_path = Path(report_path)
        self.deepseek = deepseek if isinstance(deepseek, dict) else {}
        self.options = {
            "rounds": rounds_per_cycle,
            "maxQueries": max_queries,
            "targetEvidence": target_evidence,
            "maxActions": max_actions,
            "minCoverageRatio": min_coverage_ratio,
            "requireComplete": bool(require_complete),
            "requireSourceBackedEvidence": bool(require_source_backed_evidence),
            "requireCommentBackedEvidence": bool(require_comment_backed_evidence),
            "prioritizeSourceGaps": bool(prioritize_source_gaps),
            "retryBeforeUnattemptedLimit": retry_before_unattempted_limit,
            "includeDanmaku": bool(include_danmaku),
            "resetState": bool(reset_state),
            "skipSeen": bool(skip_seen),
            **(discovery_options if isinstance(discovery_options, dict) else {}),
        }

    def build(
        self,
        *,
        cycle: int,
        audit: dict[str, Any] | None,
        priority_queries: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import _positive_int
        options = dict(self.options)
        options["resetState"] = bool(options.get("resetState")) and _positive_int(cycle, 1) == 1
        return {
            "cycle": _positive_int(cycle, 1),
            "dictionaryPath": str(self.dictionary_path),
            "statePath": str(self.state_path),
            "reportPath": str(self.report_path),
            "deepseek": dict(self.deepseek),
            "priorityQueries": priority_queries if isinstance(priority_queries, list) else [],
            "audit": audit if isinstance(audit, dict) else {},
            "options": options,
        }


class CoverageHarvestLoopMockHarvestRunner:
    """Run a file-backed coverage loop cycle using a JSON harvest payload."""

    def __init__(
        self,
        *,
        dictionary_path: str | Path,
        report_path: str | Path,
        payload_path: str | Path,
        max_cycles: int = 1,
        rounds_per_cycle: int = 1,
        target_evidence: int = 3,
        max_actions: int = 12,
        min_coverage_ratio: float = 1,
        require_complete: bool = True,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
        generated_at: str | None = None,
    ):
        from python_backend.analysis.coverage_loop import (
            CoverageHarvestLoopCommandRunner,
            CoverageHarvestLoopCycleReportBuilder,
            CoverageHarvestLoopPlanner,
            _positive_int,
        )
        self.dictionary_path = Path(dictionary_path)
        self.report_path = Path(report_path)
        self.payload_path = Path(payload_path)
        self.max_actions = max(1, _positive_int(max_actions, 12))
        self.audit_builder = CoverageAuditBuilder(
            target_evidence=target_evidence,
            max_actions=max_actions,
            min_coverage_ratio=min_coverage_ratio,
            require_complete=require_complete,
            require_source_backed_evidence=require_source_backed_evidence,
            require_comment_backed_evidence=require_comment_backed_evidence,
        )
        self.report_builder = CoverageHarvestLoopCycleReportBuilder(
            generated_at=generated_at or CoverageHarvestLoopCommandRunner._now(),
            max_cycles=max_cycles,
            rounds_per_cycle=rounds_per_cycle,
        )

    def run(self) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import CoverageHarvestLoopPlanner, CoverageHarvestLoopCommandRunner
        payload = JsonContractReader().read_value(self.payload_path, {})
        payload = payload if isinstance(payload, dict) else {}
        before_dictionary = JsonContractReader({"version": 1, "entries": []}).read_object(self.dictionary_path)
        after_dictionary = payload.get("afterDictionary") if isinstance(payload.get("afterDictionary"), dict) else before_dictionary
        before_audit = self.audit_builder.build(before_dictionary)
        after_audit = self.audit_builder.build(after_dictionary)
        priority_queries = CoverageHarvestLoopPlanner().priority_query_items_from_audit(
            before_audit,
            self.max_actions,
        )
        report = self.report_builder.build(
            cycle=payload.get("cycle", 1),
            priority_queries=priority_queries,
            harvest=payload.get("harvest") if isinstance(payload.get("harvest"), dict) else {},
            before_audit=before_audit,
            after_audit=after_audit,
            stop_reason=str(payload.get("stopReason") or ""),
        )
        CoverageHarvestLoopCommandRunner.write_report_file(self.report_path, report)
        return report


class CoverageHarvestLoopExhaustedPruner:
    """Apply the JS coverage-loop exhausted-term prune contract to a dictionary file."""

    def __init__(
        self,
        *,
        dictionary_path: str | Path,
        state_path: str | Path,
        target_evidence: int = 3,
        attempt_threshold: int = 0,
        include_partial: bool = False,
        require_source_backed_evidence: bool = False,
        require_comment_backed_evidence: bool = False,
    ):
        from python_backend.analysis.coverage_loop import _non_negative_int, _positive_int
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.target_evidence = max(1, _positive_int(target_evidence, 3))
        self.attempt_threshold = max(0, _non_negative_int(attempt_threshold, 0, 100000))
        self.include_partial = bool(include_partial)
        self.require_source_backed_evidence = bool(require_source_backed_evidence)
        self.require_comment_backed_evidence = bool(require_comment_backed_evidence)
        self.tracker = CoverageProgressTracker()

    def run(self, dictionary: dict[str, Any] | None = None) -> dict[str, Any]:
        from python_backend.analysis.coverage_loop import _non_negative_int, _positive_int
        dictionary = dictionary if isinstance(dictionary, dict) else JsonContractReader({"version": 1, "entries": []}).read_object(self.dictionary_path)
        if self.attempt_threshold <= 0:
            return {"ok": True, "pruned": 0, "dictionary": dictionary, "exhausted": []}
        state = JsonContractReader({"termAttempts": {}}).read_object(self.state_path)
        exhausted = self.tracker.select_exhausted_terms(
            dictionary,
            state,
            {
                "targetEvidence": self.target_evidence,
                "attemptThreshold": self.attempt_threshold,
                "requireZeroEvidence": not self.include_partial,
                "requireSourceBackedEvidence": self.require_source_backed_evidence,
                "requireCommentBackedEvidence": self.require_comment_backed_evidence,
            },
        )
        if not exhausted:
            return {"ok": True, "pruned": 0, "dictionary": dictionary, "exhausted": []}
        remove_terms = {str(item.get("term") or "").strip() for item in exhausted if isinstance(item, dict)}
        before_entries = dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []
        after_entries = [
            entry
            for entry in before_entries
            if not (isinstance(entry, dict) and str(entry.get("term") or "").strip() in remove_terms)
        ]
        pruned_dictionary = {**dictionary, "entries": after_entries}
        self._write_dictionary(pruned_dictionary)
        return {"ok": True, "pruned": len(before_entries) - len(after_entries), "dictionary": pruned_dictionary, "exhausted": exhausted}

    def _write_dictionary(self, dictionary: dict[str, Any]) -> None:
        self.dictionary_path.parent.mkdir(parents=True, exist_ok=True)
        self.dictionary_path.write_text(json.dumps(dictionary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
