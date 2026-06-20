from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_fast_pipeline import (
    FastPipelineLauncherPayloadContractComparator as FastPipelineLauncherContractComparator,
    FastPipelineLauncherPlanRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run fast UID pipeline launcher plan.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible fast pipeline launcher report to compare.")
    return parser


class FastPipelineLauncherCliRunner:
    """CLI-compatible fast UID pipeline launcher runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return FastPipelineLauncherContractComparator(args.data_dir, args.compare_js_report).compare()
        return FastPipelineLauncherPlanRunner(args.data_dir).run()


def main(argv: list[str] | None = None) -> int:
    result = FastPipelineLauncherCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
