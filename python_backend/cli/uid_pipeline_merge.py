from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


STAT_KEYS = ("success", "noComments", "noUser", "trainError", "blocked", "errors")


class UidPipelineMergeRunner:
    """Build a Python dry-run merge report for UID pipeline worker progress files."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        summary_only: bool = False,
        now: Callable[[], str] | None = None,
    ):
        self.data_dir = Path(data_dir)
        self.total_start = int(total_start)
        self.total_end = int(total_end)
        self.workers = max(1, int(workers))
        self.summary_only = summary_only
        self.now = now or (lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    def run(self) -> dict[str, Any]:
        total_expected = max(0, self.total_end - self.total_start + 1)
        chunk_size = math.ceil(total_expected / self.workers) if total_expected else 0
        merged_processed: dict[str, Any] = {}
        merged_stats = {key: 0 for key in STAT_KEYS}
        chunks = []
        for worker_index in range(self.workers):
            start = self.total_start + worker_index * chunk_size
            end = min(start + chunk_size - 1, self.total_end)
            if start > self.total_end:
                break
            progress_path = self.data_dir / f"uid-pipeline-{start}-{end}.json"
            progress = self._read_json(progress_path, {"processed": {}, "stats": {}})
            processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
            stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
            if not processed:
                chunks.append({"start": start, "end": end, "path": str(progress_path), "processed": 0, "skipped": True})
                continue
            merged_processed.update(processed)
            for key in STAT_KEYS:
                merged_stats[key] += int(stats.get(key) or 0)
            chunks.append({"start": start, "end": end, "path": str(progress_path), "processed": len(processed), "skipped": False})
        user_db = self._read_json(self.data_dir / "scraped-users-db.json", {"users": {}})
        users = user_db.get("users") if isinstance(user_db.get("users"), dict) else {}
        result = {
            "ok": True,
            "range": {"start": self.total_start, "end": self.total_end, "workers": self.workers, "chunkSize": chunk_size},
            "stats": merged_stats,
            "lastUpdated": self.now(),
            "chunks": chunks,
            "totalProcessed": len(merged_processed),
            "totalExpected": total_expected,
            "usersInDb": len(users),
            "summary": {
                "totalProcessed": len(merged_processed),
                "totalExpected": total_expected,
                "usersInDb": len(users),
                "stats": merged_stats,
            },
        }
        if not self.summary_only:
            result["processed"] = merged_processed
        return result

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidPipelineMergeContractComparator:
    """Compare Python UID merge reports against saved JS-compatible JSON."""

    RESULT_KEYS = ("totalProcessed", "totalExpected", "usersInDb", "stats", "processed", "chunks", "summary")

    def __init__(
        self,
        data_dir: str | Path,
        js_report_path: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
    ):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)
        self.total_start = total_start
        self.total_end = total_end
        self.workers = workers

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineMergeRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            now=lambda: "",
        ).run()
        python_result.pop("lastUpdated", None)
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
    parser = argparse.ArgumentParser(description="Build a dry-run UID pipeline merge report.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--total-start", type=int, default=1)
    parser.add_argument("--total-end", type=int, default=100000)
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--summary-only", action="store_true", help="Omit the large processed UID map from output.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID merge report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidPipelineMergeContractComparator(
            args.data_dir,
            args.compare_js_report,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
        ).compare()
    else:
        result = UidPipelineMergeRunner(
            args.data_dir,
            total_start=args.total_start,
            total_end=args.total_end,
            workers=args.workers,
            summary_only=args.summary_only,
        ).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
