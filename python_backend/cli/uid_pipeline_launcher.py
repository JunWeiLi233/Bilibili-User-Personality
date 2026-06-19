from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


class UidPipelineLauncherPlanRunner:
    """Build a dry-run launch plan compatible with launchUidPipeline.js state JSON."""

    def __init__(
        self,
        data_dir: str | Path,
        *,
        total_start: int = 1,
        total_end: int = 100000,
        workers: int = 5,
        write_state: bool = False,
        now: Callable[[], str] | None = None,
    ):
        self.data_dir = Path(data_dir)
        self.total_start = int(total_start)
        self.total_end = int(total_end)
        self.workers = max(1, int(workers))
        self.write_state = write_state
        self.now = now or (lambda: datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"))

    def run(self) -> dict[str, Any]:
        total_expected = max(0, self.total_end - self.total_start + 1)
        chunk_size = math.ceil(total_expected / self.workers) if total_expected else 0
        started_at = self.now()
        workers = []
        state_workers = []

        for worker_index in range(self.workers):
            start = self.total_start + worker_index * chunk_size
            end = min(start + chunk_size - 1, self.total_end)
            if start > self.total_end:
                break
            progress_file = f"uid-pipeline-{start}-{end}.json"
            log_file = f"scraper-logs/uid-pipeline-{start}-{end}.log"
            state_workers.append({"start": start, "end": end, "progressFile": progress_file})
            workers.append(
                {
                    "start": start,
                    "end": end,
                    "progressFile": progress_file,
                    "logFile": log_file,
                    "args": [f"--start={start}", f"--end={end}"],
                }
            )

        state = {"startedAt": started_at, "workers": state_workers}
        if self.write_state:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            (self.data_dir / "uid-pipeline-launcher.json").write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

        return {
            "ok": True,
            "startedAt": started_at,
            "range": {"start": self.total_start, "end": self.total_end, "workers": self.workers, "chunkSize": chunk_size},
            "workers": workers,
            "state": state,
            "statePath": str(self.data_dir / "uid-pipeline-launcher.json"),
            "writeState": self.write_state,
        }


class UidPipelineLauncherContractComparator:
    """Compare the Python dry-run launcher state against JS launcher state JSON."""

    RESULT_KEYS = ("workers",)

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
        python_state = UidPipelineLauncherPlanRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            now=lambda: "",
        ).run()["state"]
        js_state = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_state.get(key), "js": js_state.get(key)}
            for key in self.RESULT_KEYS
            if key in js_state and python_state.get(key) != js_state.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {key: python_state.get(key) for key in ("startedAt", "workers")},
            "js": {key: js_state.get(key) for key in ("startedAt", "workers") if key in js_state},
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


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
