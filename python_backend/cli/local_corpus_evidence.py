from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.local import LocalCorpusEvidenceFinder, LocalCorpusFlattener


class LocalCorpusEvidenceRunner:
    """Find dictionary evidence from local corpus JSON contracts."""

    def __init__(
        self,
        dictionary_path: str | Path,
        comments_path: str | Path,
        target_evidence: int = 3,
        max_samples_per_term: int = 3,
        require_comment_backed_evidence: bool = False,
        target_terms: list[str] | None = None,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.comments_path = Path(comments_path)
        self.target_evidence = target_evidence
        self.max_samples_per_term = max_samples_per_term
        self.require_comment_backed_evidence = require_comment_backed_evidence
        self.target_terms = target_terms or []
        self.finder = LocalCorpusEvidenceFinder()
        self.flattener = LocalCorpusFlattener()

    def run(self) -> dict[str, Any]:
        dictionary = self._read_json_object(self.dictionary_path, {"entries": []})
        comments_payload = self._read_json(self.comments_path, [])
        comments = comments_payload.get("comments") if isinstance(comments_payload, dict) else comments_payload
        if not isinstance(comments, list) or any(not isinstance(comment, dict) or "message" not in comment for comment in comments):
            comments = self.flattener.flatten(comments_payload)
        entries = self.finder.find_entries(
            dictionary,
            comments if isinstance(comments, list) else [],
            {
                "targetEvidence": self.target_evidence,
                "maxSamplesPerTerm": self.max_samples_per_term,
                "requireCommentBackedEvidence": self.require_comment_backed_evidence,
                "targetTerms": self.target_terms,
            },
        )
        return {"ok": True, "count": len(entries), "entries": entries}

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        payload = self._read_json(path, fallback)
        return payload if isinstance(payload, dict) else fallback


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Find merge-ready dictionary evidence from a local corpus JSON contract.")
    parser.add_argument("--dictionary", default="server/data/keywordDictionary.json")
    parser.add_argument("--comments", required=True, help="Flattened comments JSON or a raw local corpus shape.")
    parser.add_argument("--target-evidence", type=int, default=3)
    parser.add_argument("--max-samples-per-term", type=int, default=3)
    parser.add_argument("--require-comment-backed-evidence", action="store_true")
    parser.add_argument("--target-term", action="append", default=[])
    args = parser.parse_args()
    result = LocalCorpusEvidenceRunner(
        args.dictionary,
        args.comments,
        target_evidence=args.target_evidence,
        max_samples_per_term=args.max_samples_per_term,
        require_comment_backed_evidence=args.require_comment_backed_evidence,
        target_terms=args.target_term,
    ).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
