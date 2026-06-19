from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.harvest_options import CoverageRuntimeOptionsBuilder, VideoKeywordDiscoveryOptionsBuilder


class HarvestOptionsRunner:
    """Build harvest-related option objects from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "video-keyword").strip().lower()
        if mode == "coverage-runtime":
            options = CoverageRuntimeOptionsBuilder().build(
                argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
                env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
                max_actions_fallback=int(payload.get("maxActionsFallback") or 20),
            )
            return {"ok": True, "mode": mode, "options": options}
        builder = VideoKeywordDiscoveryOptionsBuilder(cwd=payload.get("cwd") if payload.get("cwd") else None)
        if mode == "priority-query-content":
            return {
                "ok": True,
                "mode": mode,
                "priorityQueries": builder.parse_priority_query_content(payload.get("content")),
            }
        options = builder.build(
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            priority_queries=payload.get("priorityQueries") if isinstance(payload.get("priorityQueries"), list) else [],
            seed_queries=payload.get("seedQueries") if isinstance(payload.get("seedQueries"), list) else [],
            controversy_queries=payload.get("controversyQueries") if isinstance(payload.get("controversyQueries"), list) else [],
            extra_query_templates=payload.get("extraQueryTemplates") if isinstance(payload.get("extraQueryTemplates"), list) else [],
            exhausted_suggestion_templates=payload.get("exhaustedSuggestionTemplates") if isinstance(payload.get("exhaustedSuggestionTemplates"), list) else [],
        )
        return {"ok": True, "mode": "video-keyword", "options": options}

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build harvest option objects from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to harvest options payload JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = HarvestOptionsRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
