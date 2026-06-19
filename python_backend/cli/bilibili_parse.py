from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.bilibili import BilibiliPublicParser


class BilibiliParseRunner:
    """Parse stored Bilibili payloads into JSON contracts."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.parser = BilibiliPublicParser()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "danmaku").strip().lower()
        if mode == "bvid-pool":
            return {"ok": True, "mode": "bvid-pool", "bvids": self.parser.parse_bvid_pool(payload.get("raw"))}
        if mode == "extract-bvid":
            return {"ok": True, "mode": "extract-bvid", "bvid": self.parser.extract_bvid(payload.get("input"))}
        if mode == "video-objects":
            return {
                "ok": True,
                "mode": "video-objects",
                "view": self.parser.video_object_from_view(payload.get("bvid"), payload.get("view") if isinstance(payload.get("view"), dict) else {}),
                "searchVideos": [
                    self.parser.video_object_from_search_item(item)
                    for item in (payload.get("searchItems") if isinstance(payload.get("searchItems"), list) else [])
                    if isinstance(item, dict)
                ],
                "popularVideos": [
                    self.parser.video_object_from_popular_item(item)
                    for item in (payload.get("popularItems") if isinstance(payload.get("popularItems"), list) else [])
                    if isinstance(item, dict)
                ],
                "spaceVideos": [
                    self.parser.video_object_from_space_item(item, payload.get("uid"))
                    for item in (payload.get("spaceItems") if isinstance(payload.get("spaceItems"), list) else [])
                    if isinstance(item, dict)
                ],
            }

        video = payload.get("video") if isinstance(payload.get("video"), dict) else {}
        return {"ok": True, "mode": "danmaku", "comments": self.parser.parse_danmaku_xml(payload.get("xml") or "", video)}

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse Bilibili public payloads into Python backend JSON contracts.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode-specific fields.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = BilibiliParseRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
