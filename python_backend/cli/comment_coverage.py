from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.comment_coverage import CommentCoverageClassifier


class CommentCoverageRunner:
    """Run comment coverage classification from JSON dictionary/comment contracts."""

    def __init__(
        self,
        dictionary_path: str | Path,
        comments_path: str | Path,
        sample_size: int | None = None,
    ) -> None:
        self.dictionary_path = Path(dictionary_path)
        self.comments_path = Path(comments_path)
        self.sample_size = sample_size
        self.classifier = CommentCoverageClassifier()

    def run(self) -> dict[str, Any]:
        dictionary = self._read_dictionary()
        comments = self._read_comments()
        options = {"sampleSize": self.sample_size} if self.sample_size is not None else {}
        return {
            "ok": True,
            "summary": self.classifier.sample(dictionary, comments, options),
        }

    def _read_dictionary(self) -> dict[str, Any]:
        payload = _read_json(self.dictionary_path)
        return payload if isinstance(payload, dict) else {"entries": []}

    def _read_comments(self) -> list[Any]:
        payload = _read_json(self.comments_path)
        if isinstance(payload, dict) and isinstance(payload.get("comments"), list):
            return payload["comments"]
        return payload if isinstance(payload, list) else []


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Classify comment coverage using the Python backend.")
    parser.add_argument(
        "--dictionary",
        default="server/data/keywordDictionary.json",
        help="Path to keyword dictionary JSON.",
    )
    parser.add_argument("--comments", required=True, help="Path to comment JSON array or object with comments array.")
    parser.add_argument("--sample-size", type=int, default=None, help="Maximum number of comments to classify.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = CommentCoverageRunner(args.dictionary, args.comments, args.sample_size).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
