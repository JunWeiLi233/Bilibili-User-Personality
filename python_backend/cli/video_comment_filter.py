from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.video_filter import VideoCommentFilter


class VideoCommentFilterRunner:
    """Run comment pre-filtering from JSON contracts."""

    def __init__(self, comments_path: str | Path, needles_path: str | Path, extra_needles: list[str] | None = None):
        self.comments_path = Path(comments_path)
        self.needles_path = Path(needles_path)
        self.extra_needles = [self._decode_cli_value(item) for item in extra_needles or []]
        self.comment_filter = VideoCommentFilter()

    def run(self) -> dict[str, Any]:
        comments_payload = self._read_json(self.comments_path, [])
        comments = comments_payload.get("comments") if isinstance(comments_payload, dict) else comments_payload
        needles_payload = self._read_json(self.needles_path, [])
        needles = needles_payload.get("needles") if isinstance(needles_payload, dict) else needles_payload
        result = self.comment_filter.filter_comments(
            comments if isinstance(comments, list) else [],
            needles if isinstance(needles, list) else [],
            self.extra_needles,
        )
        return {"ok": True, **result}

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    def _decode_cli_value(self, value: str) -> str:
        try:
            return json.loads(f'"{value}"')
        except json.JSONDecodeError:
            return value


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Filter Bilibili comments by dictionary needle JSON.")
    parser.add_argument("--comments", required=True, help="JSON list or object with a comments array.")
    parser.add_argument("--needles", required=True, help="JSON list or object with a needles array.")
    parser.add_argument("--extra-needle", action="append", default=[])
    args = parser.parse_args()
    result = VideoCommentFilterRunner(args.comments, args.needles, args.extra_needle).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
