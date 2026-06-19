from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.harvest_plan import KeywordHarvestPlanBuilder


class KeywordHarvestPlanRunner:
    """Build keyword-harvest query plans from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = KeywordHarvestPlanBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        options = payload.get("options") if isinstance(payload.get("options"), dict) else {}
        plan = self.builder.build_query_plan(dictionary, options)
        return {"ok": True, "plan": plan, "queries": [item["query"] for item in plan]}

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class KeywordHarvestPlanContractComparator:
    """Compare Python keyword-harvest plans against saved JS-compatible plan JSON."""

    PLAN_KEYS = ("query", "source", "term", "family")

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)

    def compare(self) -> dict[str, Any]:
        python_result = KeywordHarvestPlanRunner(self.payload_path).run()
        js_result = self._read_js_plan()
        python_summary = self._summary(python_result)
        js_summary = self._summary(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in ("queries", "plan")
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }

    def _read_js_plan(self) -> dict[str, Any]:
        if not self.js_plan_path.exists():
            return {}
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        plan = result.get("plan") if isinstance(result.get("plan"), list) else []
        return {
            "queries": result.get("queries") if isinstance(result.get("queries"), list) else [item.get("query") for item in plan if isinstance(item, dict)],
            "plan": [
                {key: item.get(key) for key in self.PLAN_KEYS}
                for item in plan
                if isinstance(item, dict)
            ],
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible keyword harvest query plan from JSON.")
    parser.add_argument("--payload", required=True, help="Path to harvest-plan JSON payload.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible keyword harvest plan JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_plan:
        result = KeywordHarvestPlanContractComparator(args.payload, args.compare_js_plan).compare()
    else:
        result = KeywordHarvestPlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
