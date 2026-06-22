from __future__ import annotations

import argparse
import json
import sys

from python_backend.runtime.file_lock import FileLockStateRequest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect a JS-compatible file-lock owner.json state.")
    parser.add_argument("--lock", default="server/data/.keyword-harvest.lock")
    parser.add_argument("--stale-ms", type=int, default=60000)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible lock state report to compare.")
    return parser


class FileLockStateCliRunner:
    """CLI-compatible file-lock state runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return FileLockStateRequest(
            args.lock,
            compare_js_report_path=args.compare_js_report or None,
            stale_ms=args.stale_ms,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = FileLockStateCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
