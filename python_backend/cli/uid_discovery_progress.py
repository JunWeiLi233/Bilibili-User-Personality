from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.uid_discovery import UidDiscoveryProgressReporter, UidDiscoveryProgressSummary


class UidDiscoveryProgressRunner:
    """Summarize uidDiscoveryScrape.js JSON artifacts without mutating scraper state."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        progress_file: str = "uid-discovery-progress.json",
        comments_file: str = "uid-discovery-comments.json",
        user_db_file: str = "scraped-users-db.json",
    ):
        self.data_dir = Path(data_dir)
        self.progress_path = self.data_dir / progress_file
        self.comments_path = self.data_dir / comments_file
        self.user_db_path = self.data_dir / user_db_file

    def run(self) -> dict[str, Any]:
        progress = self._read_json(self.progress_path, {})
        uid_comments = self._read_json(self.comments_path, {})
        user_db = self._read_json(self.user_db_path, {})
        users = user_db.get("users") if isinstance(user_db, dict) and isinstance(user_db.get("users"), dict) else {}
        return UidDiscoveryProgressReporter().build_report(progress, uid_comments, users)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidDiscoveryProgressContractComparator:
    """Compare Python UID discovery summaries against saved JS-compatible JSON."""

    RESULT_KEYS = ("phase", "discovery", "analysis", "comments", "stats", "userDb")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.summary = UidDiscoveryProgressSummary()

    def compare(self) -> dict[str, Any]:
        python_result = UidDiscoveryProgressRunner(self.data_dir).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Summarize UID discovery scrape progress JSON.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID discovery progress report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidDiscoveryProgressContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = UidDiscoveryProgressRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
