from __future__ import annotations

import math
import re
from typing import Any

MIN_CHUNK_LENGTH = 8


class SemanticMatcherHelper:
    """Deterministic semantic matcher primitives shared through JSON contracts."""

    def chunk_comment_text(self, text: Any = "") -> list[str]:
        raw = str(text or "").strip()
        if not raw:
            return []
        chunks = [
            chunk.strip()
            for chunk in re.split(r"[\u3002\uff01\uff1f\n!?;\uff1b]+", raw)
            if len(chunk.strip()) >= MIN_CHUNK_LENGTH
        ]
        if not chunks and len(raw) >= MIN_CHUNK_LENGTH:
            return [raw]
        return chunks

    def cosine_similarity(self, left: Any, right: Any) -> float:
        a = self._numeric_vector(left)
        b = self._numeric_vector(right)
        length = min(len(a), len(b))
        dot = 0.0
        norm_a = 0.0
        norm_b = 0.0
        for index in range(length):
            dot += a[index] * b[index]
            norm_a += a[index] * a[index]
            norm_b += b[index] * b[index]
        denominator = math.sqrt(norm_a) * math.sqrt(norm_b)
        return dot / denominator if denominator > 0 else 0.0

    def match_comment_to_terms(
        self,
        chunks: list[Any],
        chunk_embeddings: list[Any],
        term_embeddings: dict[str, Any],
        threshold: float = 0.72,
    ) -> list[dict[str, Any]]:
        clean_chunks = [str(chunk or "").strip() for chunk in chunks if len(str(chunk or "").strip()) >= MIN_CHUNK_LENGTH]
        if not clean_chunks or not term_embeddings:
            return []

        matches: list[dict[str, Any]] = []
        for chunk_index, chunk in enumerate(clean_chunks):
            if chunk_index >= len(chunk_embeddings):
                break
            chunk_vector = chunk_embeddings[chunk_index]
            for term, term_vector in term_embeddings.items():
                score = self.cosine_similarity(chunk_vector, term_vector)
                if score >= threshold:
                    matches.append({"term": str(term), "chunk": chunk, "score": round(score, 4)})

        seen: set[tuple[str, str]] = set()
        deduped: list[dict[str, Any]] = []
        for match in sorted(matches, key=lambda item: item["score"], reverse=True):
            key = (match["term"], match["chunk"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(match)
        return deduped

    def _numeric_vector(self, value: Any) -> list[float]:
        if not isinstance(value, list):
            return []
        vector: list[float] = []
        for item in value:
            try:
                vector.append(float(item))
            except (TypeError, ValueError):
                vector.append(0.0)
        return vector
