from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_pipeline import UidPipelineLauncherPayloadContractComparator as UidPipelineLauncherContractComparator, UidPipelineLauncherPlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run UID pipeline launcher plan.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--total-start", type=int, default=1)
    parser.add_argument("--total-end", type=int, default=100000)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--write-state", action="store_true", help="Write uid-pipeline-launcher.json without launching workers.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS uid-pipeline-launcher.json to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidPipelineLauncherContractComparator(
            args.data_dir,
            args.compare_js_report,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
        ).compare()
    else:
        result = UidPipelineLauncherPlanRunner(
            args.data_dir,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
            write_state=args.write_state,
        ).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
