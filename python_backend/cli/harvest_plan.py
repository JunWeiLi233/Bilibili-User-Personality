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


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible keyword harvest query plan from JSON.")
    parser.add_argument("--payload", required=True, help="Path to harvest-plan JSON payload.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = KeywordHarvestPlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
