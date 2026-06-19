from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.semantic_matcher import SemanticMatcherHelper


class SemanticMatcherRunner:
    """Run deterministic semantic matcher primitives from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.matcher = SemanticMatcherHelper()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        chunks = payload.get("chunks")
        if not isinstance(chunks, list):
            chunks = self.matcher.chunk_comment_text(payload.get("text", ""))
        vectors = payload.get("vectors") if isinstance(payload.get("vectors"), dict) else {}
        left = vectors.get("left", [])
        right = vectors.get("right", [])
        term_embeddings = payload.get("termEmbeddings")
        if not isinstance(term_embeddings, dict):
            term_embeddings = {}
        chunk_embeddings = payload.get("chunkEmbeddings")
        if not isinstance(chunk_embeddings, list):
            chunk_embeddings = []
        threshold = self._float_value(payload.get("threshold"), 0.72)

        return {
            "ok": True,
            "chunks": chunks,
            "cosine": round(self.matcher.cosine_similarity(left, right), 4),
            "matches": self.matcher.match_comment_to_terms(chunks, chunk_embeddings, term_embeddings, threshold),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _float_value(self, value: Any, fallback: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run semantic matcher helper functions from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to semantic matcher payload JSON.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    result = SemanticMatcherRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
