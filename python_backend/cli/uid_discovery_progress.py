from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_discovery import (
    UidDiscoveryProgressPayloadContractComparator as UidDiscoveryProgressContractComparator,
    UidDiscoveryProgressRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize UID discovery scrape progress JSON.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID discovery progress report to compare.")
    return parser


class UidDiscoveryProgressCliRunner:
    """CLI-compatible UID discovery progress runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.compare_js_report:
            return UidDiscoveryProgressContractComparator(args.data_dir, args.compare_js_report).compare()
        return UidDiscoveryProgressRunner(args.data_dir).run()


def main(argv: list[str] | None = None) -> int:
    result = UidDiscoveryProgressCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
