from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

from python_backend.runtime.file_lock import FileLockStateInspector


class FileLockStateRunner:
    """Emit a JS-compatible file-lock owner state report."""

    def __init__(
        self,
        lock_path: str | Path,
        *,
        stale_ms: int = 60000,
        now_ms: Callable[[], int] | None = None,
        process_alive: Callable[[int], bool] | None = None,
    ):
        self.lock_path = Path(lock_path)
        self.stale_ms = int(stale_ms)
        self.now_ms = now_ms
        self.process_alive = process_alive

    def run(self) -> dict[str, Any]:
        return FileLockStateInspector(
            self.lock_path,
            stale_ms=self.stale_ms,
            now_ms=self.now_ms,
            process_alive=self.process_alive,
        ).inspect()


class FileLockStateContractComparator:
    """Compare Python file-lock reports against saved JS-compatible JSON."""

    RESULT_KEYS = ("owner", "state")

    def __init__(
        self,
        lock_path: str | Path,
        js_report_path: str | Path,
        *,
        stale_ms: int = 60000,
        now_ms: Callable[[], int] | None = None,
        process_alive: Callable[[int], bool] | None = None,
    ):
        self.lock_path = Path(lock_path)
        self.js_report_path = Path(js_report_path)
        self.stale_ms = int(stale_ms)
        self.now_ms = now_ms
        self.process_alive = process_alive

    def compare(self) -> dict[str, Any]:
        python_result = FileLockStateRunner(
            self.lock_path,
            stale_ms=self.stale_ms,
            now_ms=self.now_ms,
            process_alive=self.process_alive,
        ).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Inspect a JS-compatible file-lock owner.json state.")
    parser.add_argument("--lock", default="server/data/.keyword-harvest.lock")
    parser.add_argument("--stale-ms", type=int, default=60000)
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible lock state report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = FileLockStateContractComparator(args.lock, args.compare_js_report, stale_ms=args.stale_ms).compare()
    else:
        result = FileLockStateRunner(args.lock, stale_ms=args.stale_ms).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
