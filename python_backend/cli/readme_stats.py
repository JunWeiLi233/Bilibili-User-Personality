from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.readme_stats import ReadmeStatsBuilder


class ReadmeStatsRunner:
    """Build README stats and timeline JSON from a compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        generated_at = str(payload["generatedAt"]) if payload.get("generatedAt") else None
        builder = ReadmeStatsBuilder(now=(lambda: generated_at) if generated_at else None)
        sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        coverage = payload.get("coverage") if isinstance(payload.get("coverage"), dict) else {}
        stats = builder.build_stats(sources, dictionary, coverage, generated_at=generated_at)
        return {
            "ok": True,
            "stats": stats,
            "summary": {
                "comments": stats["comments"],
                "danmaku": stats["danmaku"],
                "keywordTerms": stats["keywordTerms"],
                "timelinePoints": len(stats["timeline"]["points"]),
            },
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build README stats and timeline JSON from a payload.")
    parser.add_argument("--payload", required=True, help="Path to README stats payload JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = ReadmeStatsRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
