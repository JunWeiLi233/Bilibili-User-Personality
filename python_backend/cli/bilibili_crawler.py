from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.bilibili_crawler import BilibiliCrawlerHelper


class BilibiliCrawlerRunner:
    """Run deterministic Bilibili crawler helper functions from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.helper = BilibiliCrawlerHelper()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        text = payload.get("text") or payload.get("input") or ""
        block_payload = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
        result = {
            "ok": True,
            "bvids": self.helper.parse_bvid_pool(text),
            "bvid": self.helper.extract_bvid(text),
            "blocked": self.helper.is_block_response(block_payload),
        }
        if "cookie" in payload:
            result["cookie"] = self.helper.normalize_bilibili_cookie(payload.get("cookie"))
        if isinstance(payload.get("objects"), list):
            result["objects"] = self.helper.dedupe_public_objects(payload.get("objects"))
        if isinstance(payload.get("reply"), dict):
            result["targetReplies"] = self.helper.collect_reply_for_uid(
                payload.get("reply"),
                payload.get("targetUid"),
                payload.get("object") if isinstance(payload.get("object"), dict) else {},
                [],
            )
        if "danmakuXml" in payload:
            result["danmaku"] = self.helper.parse_danmaku_xml(
                payload.get("danmakuXml"),
                payload.get("video") if isinstance(payload.get("video"), dict) else {},
            )
        return result

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run Bilibili crawler helper functions from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to crawler helper payload JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = BilibiliCrawlerRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
