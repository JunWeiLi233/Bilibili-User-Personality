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
        if mode == "scanned-keys":
            return {
                "ok": True,
                "mode": "scanned-keys",
                "scannedKeys": self.planner.collect_scanned_probe_video_keys(payload.get("corpus") if isinstance(payload.get("corpus"), dict) else {}),
            }
        if mode in {"source-videos", "evidence-source-videos"}:
            return {
                "ok": True,
                "mode": mode,
                "videosByTerm": self.planner.build_evidence_source_videos_for_actions(
                    payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {},
                    payload.get("actions") if isinstance(payload.get("actions"), list) else [],
                    payload.get("options") if isinstance(payload.get("options"), dict) else {},
                ),
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


class BilibiliProbePlanContractComparator:
    """Compare Python Bilibili probe plans against saved JS-compatible JSON."""

    RESULT_KEYS = (
        "mode",
        "videos",
        "headers",
        "scannedKeys",
        "videosByTerm",
        "viewUrl",
        "replyUrl",
        "replyPageUrl",
        "replyThreadUrl",
        "searchUrls",
    )

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = BilibiliProbePlanRunner(self.payload_path).run()
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
    parser = argparse.ArgumentParser(description="Build Bilibili direct probe plans from JSON payloads.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Bilibili probe plan report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = BilibiliProbePlanContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = BilibiliProbePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
