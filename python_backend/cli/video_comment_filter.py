from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.video_filter import VideoCommentFilter, VideoCommentFilterContractComparator as VideoCommentFilterPayloadComparator, VideoCommentFilterSummary


class VideoCommentFilterRunner:
    """Run comment pre-filtering from JSON contracts."""

    def __init__(
        self,
        comments_path: str | Path,
        needles_path: str | Path,
        extra_needles: list[str] | None = None,
        dictionary_mode: bool = False,
        existing_terms_only: bool = False,
    ):
        self.comments_path = Path(comments_path)
        self.needles_path = Path(needles_path)
        self.extra_needles = [self._decode_cli_value(item) for item in extra_needles or []]
        self.dictionary_mode = dictionary_mode
        self.existing_terms_only = existing_terms_only
        self.comment_filter = VideoCommentFilter()

    def run(self) -> dict[str, Any]:
        comments_payload = self._read_json(self.comments_path, [])
        needles_payload = self._read_json(self.needles_path, [])
        return self.comment_filter.run_from_payload(
            comments_payload,
            needles_payload,
            extra_needles=self.extra_needles,
            dictionary_mode=self.dictionary_mode,
            existing_terms_only=self.existing_terms_only,
        )

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


class VideoCommentFilterContractComparator:
    """Compare Python comment filtering output against saved JS-compatible JSON."""

    def __init__(
        self,
        comments_path: str | Path,
        needles_path: str | Path,
        js_report_path: str | Path,
        extra_needles: list[str] | None = None,
        dictionary_mode: bool = False,
        existing_terms_only: bool = False,
    ):
        self.comments_path = Path(comments_path)
        self.needles_path = Path(needles_path)
        self.js_report_path = Path(js_report_path)
        self.extra_needles = extra_needles or []
        self.dictionary_mode = dictionary_mode
        self.existing_terms_only = existing_terms_only
        self.summary = VideoCommentFilterSummary()
        self.comparator = VideoCommentFilterPayloadComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = VideoCommentFilterRunner(
            self.comments_path,
            self.needles_path,
            self.extra_needles,
            self.dictionary_mode,
            self.existing_terms_only,
        ).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Filter Bilibili comments by dictionary needle JSON.")
    parser.add_argument("--comments", required=True, help="JSON list or object with a comments array.")
    parser.add_argument("--needles", required=True, help="JSON list or object with a needles array.")
    parser.add_argument("--extra-needle", action="append", default=[])
    parser.add_argument("--dictionary-mode", action="store_true", help="Treat --needles as a dictionary JSON payload.")
    parser.add_argument("--existing-terms-only", action="store_true", help="Apply filtering only for existing-term dictionary refreshes.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible comment filter report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = VideoCommentFilterContractComparator(
            args.comments,
            args.needles,
            args.compare_js_report,
            args.extra_needle,
            args.dictionary_mode,
            args.existing_terms_only,
        ).compare()
    else:
        result = VideoCommentFilterRunner(args.comments, args.needles, args.extra_needle, args.dictionary_mode, args.existing_terms_only).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
