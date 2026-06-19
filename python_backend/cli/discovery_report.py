from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.discovery_report import VideoKeywordDiscoveryReporter


class VideoKeywordDiscoveryReportRunner:
    """Build a video keyword discovery report from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        reporter = VideoKeywordDiscoveryReporter(now=(lambda: str(payload["generatedAt"])) if payload.get("generatedAt") else None)
        result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
        report = reporter.serialize_report(result, str(payload.get("statePath") or ""), str(payload.get("reportPath") or ""))
        return {
            "ok": True,
            "report": report,
            "priorityActionItems": reporter.priority_action_items_from_harvest_result(result),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a video keyword discovery report from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to report payload JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = VideoKeywordDiscoveryReportRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
