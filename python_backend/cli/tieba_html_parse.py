from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.scrapers.tieba_html import TiebaHtmlParser


class TiebaHtmlParseRunner:
    """Parse stored Tieba HTML payloads into JSON contracts."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.parser = TiebaHtmlParser()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "threads").strip().lower()
        html_text = payload.get("html") or ""
        keyword = str(payload.get("keyword") or "")

        if mode == "comments":
            comments = self.parser.parse_thread_comments(html_text, payload.get("thread") if isinstance(payload.get("thread"), dict) else {})
            return {"ok": True, "mode": "comments", "comments": comments}
        if mode == "discovery-comments":
            threads = payload.get("threads")
            if not isinstance(threads, list):
                threads = self.parser.parse_threads(html_text, keyword)
            comments = self.parser.threads_to_discovery_comments(threads, keyword)
            return {"ok": True, "mode": "discovery-comments", "threads": threads, "comments": comments}

        threads = self.parser.parse_threads(html_text, keyword)
        return {"ok": True, "mode": "threads", "threads": threads}

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse Tieba HTML into Python backend JSON contracts.")
    parser.add_argument("--payload", required=True, help="Path to JSON payload with mode/html/thread fields.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = TiebaHtmlParseRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
