from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder, DirectProbePlanSummary


class DirectProbePlanRunner:
    """Build deterministic direct Bilibili probe planning outputs from JSON."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = DirectProbeCorpusBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        action = payload.get("action") if isinstance(payload.get("action"), dict) else {}
        videos = payload.get("videos") if isinstance(payload.get("videos"), list) else []
        source = payload.get("source") or ""
        source_refs = self.builder.extract_bilibili_video_refs(source)
        primary_ref = source_refs[0] if source_refs else {}
        cursor_payload = payload.get("cursorPayload") if isinstance(payload.get("cursorPayload"), dict) else {}
        query = action.get("query") or action.get("term") or ""
        dictionary = payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}
        actions = payload.get("actions") if isinstance(payload.get("actions"), list) else ([action] if action else [])
        source_video_options = {
            "maxPerAction": payload.get("maxPerAction", 0),
            "corpus": payload.get("corpus") if isinstance(payload.get("corpus"), dict) else {},
        }
        result = {
            "ok": True,
            "needles": self.builder.probe_search_needles(action),
            "rankedVideos": self.builder.rank_probe_videos_for_action(videos, action),
            "sourceRefs": source_refs,
            "evidenceSourceVideos": self.builder.build_evidence_source_videos_for_actions(dictionary, actions, source_video_options),
            "nextReplyCursor": self.builder.next_reply_cursor(cursor_payload, payload.get("cursorFallback", 0)),
            "viewUrl": self.builder.build_bilibili_view_url(primary_ref),
            "replyUrl": self.builder.build_bilibili_reply_url(primary_ref, payload.get("replyPage", 0), payload.get("pageSize", 20)),
            "replyPageUrl": self.builder.build_bilibili_reply_page_url(primary_ref, payload.get("replyPageNumber", 1), payload.get("pageSize", 20)),
            "replyThreadUrl": self.builder.build_bilibili_reply_thread_url(
                primary_ref,
                primary_ref.get("rootRpid"),
                payload.get("replyThreadPage", 1),
                payload.get("pageSize", 20),
            ),
            "searchUrls": self.builder.build_bilibili_search_urls(query, payload.get("searchOptions") if isinstance(payload.get("searchOptions"), dict) else {}),
        }
        if payload.get("referer"):
            result["headers"] = self.builder.build_bilibili_web_headers(
                payload.get("referer"),
                {
                    "cookie": payload.get("cookie"),
                    "userAgent": payload.get("userAgent"),
                },
            )
        synthetic_cookie = payload.get("syntheticCookie") if isinstance(payload.get("syntheticCookie"), dict) else None
        if synthetic_cookie is not None:
            random_value = synthetic_cookie.get("randomValue", 0.5)
            result["syntheticCookie"] = self.builder.make_synthetic_bilibili_cookie(
                random_fn=lambda: random_value,
                now_ms=synthetic_cookie.get("nowMs"),
            )
        return result

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class DirectProbePlanContractComparator:
    """Compare Python direct-probe plans against saved JS-compatible plan JSON."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.summary = DirectProbePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_plan = DirectProbePlanRunner(self.payload_path).run()
        js_plan = self._read_js_plan()
        mismatches = [
            {"key": key, "python": python_plan.get(key), "js": js_plan.get(key)}
            for key in self.summary.PLAN_KEYS
            if key in js_plan and python_plan.get(key) != js_plan.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_plan),
            "js": self.summary.summarize(js_plan),
        }

    def _read_js_plan(self) -> dict[str, Any]:
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build direct Bilibili probe planning JSON from a payload.")
    parser.add_argument("--payload", required=True, help="Path to direct probe plan JSON payload.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible direct probe plan JSON to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_plan:
        result = DirectProbePlanContractComparator(args.payload, args.compare_js_plan).compare()
    else:
        result = DirectProbePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
