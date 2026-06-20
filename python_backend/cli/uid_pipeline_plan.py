from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_pipeline import UidPipelinePlanPayloadContractComparator as UidPipelinePlanContractComparator, UidPipelinePlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a uidPipelineWorker.js-compatible dry-run plan.")
    parser.add_argument("--payload", required=True)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID pipeline plan report to compare.")
    return parser


class UidPipelinePlanCliRunner:
    """CLI-compatible UID pipeline worker plan runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return UidPipelinePlanContractComparator(args.payload, args.compare_js_report).compare()
        return UidPipelinePlanRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = UidPipelinePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
