from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.semantic_matcher import SemanticEmbeddingCache, SemanticEvidenceBuilder, SemanticMatcherHelper


class SemanticMatcherRunner:
    """Run deterministic semantic matcher primitives from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.matcher = SemanticMatcherHelper()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        mode = str(payload.get("mode") or "match").strip().lower()
        if mode == "cache":
            cache = SemanticEmbeddingCache(now=lambda: str(payload.get("now") or ""))
            return {
                "ok": True,
                "mode": "cache",
                "embeddingTexts": cache.embedding_texts(payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {}),
                "cache": cache.build_cache_payload(
                    payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {},
                    payload.get("embeddings") if isinstance(payload.get("embeddings"), dict) else {},
                ),
            }
        if mode == "evidence":
            builder = SemanticEvidenceBuilder(now=lambda: str(payload.get("now") or ""))
            entries = builder.build_evidence_entries(
                payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {},
                payload.get("matches") if isinstance(payload.get("matches"), list) else [],
                target_evidence=int(payload.get("targetEvidence") or 3),
                source=str(payload.get("source") or "Bilibili public comment semantic match"),
                uid=str(payload.get("uid") or ""),
            )
            return {"ok": True, "mode": "evidence", "count": len(entries), "entries": entries}
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
            "mode": "match",
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


class SemanticMatcherContractComparator:
    """Compare Python semantic matcher output against saved JS-compatible JSON."""

    RESULT_KEYS = ("mode", "chunks", "cosine", "matches", "embeddingTexts", "cache", "count", "entries")

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)

    def compare(self) -> dict[str, Any]:
        python_result = SemanticMatcherRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run semantic matcher helper functions from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to semantic matcher payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible semantic matcher report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = SemanticMatcherContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = SemanticMatcherRunner(args.payload).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
