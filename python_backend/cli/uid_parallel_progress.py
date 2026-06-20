from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_parallel import UidParallelProgressPayloadContractComparator as UidParallelProgressContractComparator, UidParallelProgressRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize one UID parallel analyzer worker progress JSON file.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--worker", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID parallel progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    runner_options = {"worker_id": args.worker, "total_workers": args.workers}
    if args.compare_js_report:
        result = UidParallelProgressContractComparator(args.data_dir, args.compare_js_report, **runner_options).compare()
    else:
        result = UidParallelProgressRunner(args.data_dir, **runner_options).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
