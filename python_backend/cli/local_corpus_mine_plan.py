from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local_options import LocalCorpusMinePlanContractComparator, LocalCorpusMinePlanRequest, LocalCorpusMinePlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a mineLocalCorpusEvidence.js-compatible dry-run option plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local-corpus mine option report to compare.")
    return parser


class LocalCorpusMinePlanCliRunner:
    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = build_parser().parse_args(argv)
        return LocalCorpusMinePlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()


def main(argv: list[str] | None = None) -> int:
    result = LocalCorpusMinePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
