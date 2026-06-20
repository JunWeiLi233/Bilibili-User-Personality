from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_pipeline import UidPipelineProgressPayloadContractComparator as UidPipelineProgressContractComparator, UidPipelineProgressRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize one UID pipeline worker progress JSON file.")
    parser.add_argument("--progress", default="server/data/uid-pipeline-1-100000.json")
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    parser.add_argument("--user-db", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID pipeline progress report to compare.")
    return parser


class UidPipelineProgressCliRunner:
    """CLI-compatible UID pipeline progress runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        runner_options = {"start": args.start, "end": args.end}
        if args.user_db:
            runner_options["user_db_path"] = args.user_db
        if args.compare_js_report:
            return UidPipelineProgressContractComparator(args.progress, args.compare_js_report, **runner_options).compare()
        return UidPipelineProgressRunner(args.progress, **runner_options).run()


def main(argv: list[str] | None = None) -> int:
    result = UidPipelineProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
