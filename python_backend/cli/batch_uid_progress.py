from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_uid_scrape import (
    BatchUidProgressPayloadContractComparator as BatchUidProgressContractComparator,
    BatchUidProgressRequest,
    BatchUidProgressRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize batch UID scrape progress JSON.")
    parser.add_argument("--progress", default="server/data/batch-uid-progress.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible batch UID progress report to compare.")
    return parser


class BatchUidProgressCliRunner:
    """CLI-compatible batch UID progress runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BatchUidProgressRequest(args.progress, compare_js_report_path=args.compare_js_report).run()


def main(argv: list[str] | None = None) -> int:
    result = BatchUidProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
