from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_parallel import UidParallelProgressPayloadContractComparator as UidParallelProgressContractComparator, UidParallelProgressRequest, UidParallelProgressRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize one UID parallel analyzer worker progress JSON file.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--worker", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID parallel progress report to compare.")
    return parser


class UidParallelProgressCliRunner:
    """CLI-compatible UID parallel progress runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        runner_options = {"worker_id": args.worker, "total_workers": args.workers}
        return UidParallelProgressRequest(args.data_dir, compare_js_report_path=args.compare_js_report, **runner_options).run()


def main(argv: list[str] | None = None) -> int:
    result = UidParallelProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
