from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.tieba_timing import TiebaScrapeTiming, TiebaTimingContractComparator


class TiebaTimingRunner:
    """Compute Tieba scrape timing budgets from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.timing = TiebaScrapeTiming()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return {
            "ok": True,
            "hardStopMs": self.timing.compute_hard_stop_ms(payload),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compute Tieba scrape timing budgets from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to timing payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible timing report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = TiebaTimingContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = TiebaTimingRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
