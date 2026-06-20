from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Callable

from python_backend.scrapers.uid_pipeline import UidPipelineLauncherContractComparator as UidPipelineLauncherPayloadComparator, UidPipelineLauncherPlanner, UidPipelineLauncherSummary


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
        self.now = now

    def run(self) -> dict[str, Any]:
        result = UidPipelineLauncherPlanner(now=self.now).build_plan(total_start=self.total_start, total_end=self.total_end, workers=self.workers)
        if self.write_state:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            (self.data_dir / "uid-pipeline-launcher.json").write_text(json.dumps(result["state"], ensure_ascii=False, indent=2), encoding="utf-8")

        return {**result, "statePath": str(self.data_dir / "uid-pipeline-launcher.json"), "writeState": self.write_state}


class UidPipelineLauncherContractComparator:
    """Compare the Python dry-run launcher state against JS launcher state JSON."""

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
        self.summary = UidPipelineLauncherSummary()
        self.comparator = UidPipelineLauncherPayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_state = UidPipelineLauncherPlanRunner(
            self.data_dir,
            total_start=self.total_start,
            total_end=self.total_end,
            workers=self.workers,
            now=lambda: "",
        ).run()["state"]
        js_state = self._read_js_report()
        return self.comparator.compare(python_state, js_state)

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
