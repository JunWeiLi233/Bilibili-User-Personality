from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.bilibili_probe import BilibiliProbePlanner


class BilibiliProbePlanRunner:
    """Build Bilibili direct-probe URL/header plans from JSON payloads."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = BilibiliProbePlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "urls").strip().lower()
        if mode == "filter-videos":
            return {
                "ok": True,
                "mode": "filter-videos",
                "videos": self.planner.filter_unscanned_probe_videos(
                    payload.get("videos") if isinstance(payload.get("videos"), list) else [],
                    payload.get("scannedKeys") if isinstance(payload.get("scannedKeys"), list) else [],
                ),
            }
        if mode == "headers":
            return {
                "ok": True,
                "mode": "headers",
                "headers": self.planner.build_web_headers(str(payload.get("referer") or ""), payload.get("options") if isinstance(payload.get("options"), dict) else {}),
            }

        video = payload.get("video") if isinstance(payload.get("video"), dict) else {}
        search = payload.get("search") if isinstance(payload.get("search"), dict) else {}
        return {
            "ok": True,
            "mode": "urls",
            "viewUrl": self.planner.build_view_url(video),
            "replyUrl": self.planner.build_reply_url(video),
            "replyPageUrl": self.planner.build_reply_page_url(video),
            "replyThreadUrl": self.planner.build_reply_thread_url(video),
            "searchUrls": self.planner.build_search_urls(payload.get("query") or "", search),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build Bilibili direct probe plans from JSON payloads.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = BilibiliProbePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
