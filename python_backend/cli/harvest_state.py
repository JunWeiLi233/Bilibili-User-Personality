from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.harvest_state import HarvestStateFinalizer, HarvestTermAttemptSummarizer, HarvestTermAttemptUpdater


class HarvestStateRunner:
    """Update keyword-harvest state from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        updater = HarvestTermAttemptUpdater(strategy_version=payload.get("strategyVersion") or options.get("harvestStrategyVersion") or 0)
        term_attempts = payload.get("termAttempts") if isinstance(payload.get("termAttempts"), dict) else {}
        if isinstance(payload.get("state"), dict) and isinstance(payload["state"].get("termAttempts"), dict):
            term_attempts = payload["state"]["termAttempts"]
        if str(payload.get("mode") or "").strip().lower() == "summary":
            summarizer = HarvestTermAttemptSummarizer(strategy_version=payload.get("strategyVersion") or options.get("harvestStrategyVersion") or 7)
            state = payload.get("state") if isinstance(payload.get("state"), dict) else {"termAttempts": term_attempts}
            dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
            return {"ok": True, "termAttemptSummary": summarizer.summarize(state, dictionary, options=options)}
        if str(payload.get("mode") or "").strip().lower() == "finalize":
            finalizer = HarvestStateFinalizer(strategy_version=payload.get("strategyVersion") or options.get("harvestStrategyVersion") or 7)
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
        if str(payload.get("mode") or "").strip().lower() == "backfill":
            dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
            searched_queries = payload.get("searchedQueries") if isinstance(payload.get("searchedQueries"), list) else []
            result = updater.backfill_searched_queries(term_attempts, dictionary, searched_queries, options=options)
            return {"ok": True, **result}
        if str(payload.get("mode") or "").strip().lower() == "related":
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

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class HarvestStateContractComparator:
    """Compare Python harvest state against a persisted JS-compatible state report."""

    def __init__(self, payload_path: str | Path, js_state_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_state_path = Path(js_state_path)

    def compare(self) -> dict[str, Any]:
        python_result = HarvestStateRunner(self.payload_path).run()
        js_result = self._read_js_state()
        python_summary = self._summary(python_result)
        js_summary = self._summary(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in ("termAttempts", "backfilled")
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {"ok": not mismatches, "mismatches": mismatches, "python": python_summary, "js": js_summary}

    def _read_js_state(self) -> dict[str, Any]:
        if not self.js_state_path.exists():
            return {}
        with self.js_state_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        attempts = result.get("termAttempts") if isinstance(result.get("termAttempts"), dict) else {}
        summary: dict[str, Any] = {"termAttempts": attempts}
        if "backfilled" in result:
            summary["backfilled"] = result.get("backfilled")
        return summary


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Update JS-compatible keyword harvest term-attempt state from JSON.")
    parser.add_argument("--payload", required=True, help="Path to harvest-state JSON payload.")
    parser.add_argument("--compare-js-state", default="", help="Optional JS-compatible harvest state JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_state:
        result = HarvestStateContractComparator(args.payload, args.compare_js_state).compare()
    else:
        result = HarvestStateRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
