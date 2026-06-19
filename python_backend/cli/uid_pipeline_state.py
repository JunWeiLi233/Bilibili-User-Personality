from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


STAT_KEYS = ("success", "noComments", "noVideos", "noUser", "trainError", "blocked", "errors")


class UidPipelineStateRunner:
    """Summarize live launchUidPipeline.js state and referenced worker progress files."""

    def __init__(self, data_dir: str | Path, *, state_file: str = "uid-pipeline-launcher.json"):
        self.data_dir = Path(data_dir)
        self.state_path = self.data_dir / state_file

    def run(self) -> dict[str, Any]:
        state = self._read_json(self.state_path, {})
        raw_workers = state.get("workers") if isinstance(state.get("workers"), list) else []
        stats = {key: 0 for key in STAT_KEYS}
        workers = []
        total_processed = 0
        total_expected = 0
        completed_workers = 0

        for raw_worker in raw_workers:
            if not isinstance(raw_worker, dict):
                continue
            start = int(raw_worker.get("start") or 0)
            end = int(raw_worker.get("end") or 0)
            total = max(0, end - start + 1)
            progress_file = str(raw_worker.get("progressFile") or f"uid-pipeline-{start}-{end}.json")
            progress = self._read_json(self.data_dir / progress_file, {})
            processed = progress.get("processed") if isinstance(progress.get("processed"), dict) else {}
            progress_stats = progress.get("stats") if isinstance(progress.get("stats"), dict) else {}
            processed_count = len(processed)
            complete = bool(total and processed_count >= total)
            total_processed += processed_count
            total_expected += total
            completed_workers += 1 if complete else 0
            for key in STAT_KEYS:
                stats[key] += int(progress_stats.get(key) or 0)
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "processed": processed_count,
                    "total": total,
                    "complete": complete,
                }
            )

        return {
            "ok": True,
            "startedAt": state.get("startedAt") or None,
            "workers": workers,
            "stats": stats,
            "summary": {
                "workers": len(workers),
                "completedWorkers": completed_workers,
                "totalProcessed": total_processed,
                "totalExpected": total_expected,
                "completionRatio": round(total_processed / total_expected, 4) if total_expected else 0,
            },
        }

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class UidPipelineStateContractComparator:
    """Compare Python live UID pipeline state summaries against saved JS-compatible JSON."""

    RESULT_KEYS = ("startedAt", "workers", "summary", "stats")

    def __init__(self, data_dir: str | Path, js_report_path: str | Path):
        self.data_dir = Path(data_dir)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = UidPipelineStateRunner(self.data_dir).run()
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
    parser = argparse.ArgumentParser(description="Summarize live UID pipeline launcher state and worker progress.")
    parser.add_argument("--data-dir", default="server/data")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible UID pipeline state report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = UidPipelineStateContractComparator(args.data_dir, args.compare_js_report).compare()
    else:
        result = UidPipelineStateRunner(args.data_dir).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
