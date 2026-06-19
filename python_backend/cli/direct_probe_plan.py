from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder


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
        return {
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

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build direct Bilibili probe planning JSON from a payload.")
    parser.add_argument("--payload", required=True, help="Path to direct probe plan JSON payload.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = DirectProbePlanRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
