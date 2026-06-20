from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.direct_probe import DirectProbePlanPayloadContractComparator as DirectProbePlanContractComparator, DirectProbePlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build direct Bilibili probe planning JSON from a payload.")
    parser.add_argument("--payload", required=True, help="Path to direct probe plan JSON payload.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible direct probe plan JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_plan:
        result = DirectProbePlanContractComparator(args.payload, args.compare_js_plan).compare()
    else:
        result = DirectProbePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
