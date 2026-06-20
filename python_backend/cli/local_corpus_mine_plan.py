from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local_options import LocalCorpusMinePlanContractComparator, LocalCorpusMinePlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a mineLocalCorpusEvidence.js-compatible dry-run option plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local-corpus mine option report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = LocalCorpusMinePlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = LocalCorpusMinePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
