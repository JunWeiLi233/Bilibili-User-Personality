from __future__ import annotations

import math
import re
from typing import Any

MIN_CHUNK_LENGTH = 8


class SemanticMatcherSummary:
    """Shape semantic matcher results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "chunks", "cosine", "matches", "embeddingTexts", "cache", "count", "entries")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class SemanticMatcherHelper:
    """Deterministic semantic matcher primitives shared through JSON contracts."""

    def run_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
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
            chunks = self.chunk_comment_text(payload.get("text", ""))
        vectors = payload.get("vectors") if isinstance(payload.get("vectors"), dict) else {}
        term_embeddings = payload.get("termEmbeddings")
        if not isinstance(term_embeddings, dict):
            term_embeddings = {}
        chunk_embeddings = payload.get("chunkEmbeddings")
        if not isinstance(chunk_embeddings, list):
            chunk_embeddings = []
        return {
            "ok": True,
            "mode": "match",
            "chunks": chunks,
            "cosine": round(self.cosine_similarity(vectors.get("left", []), vectors.get("right", [])), 4),
            "matches": self.match_comment_to_terms(chunks, chunk_embeddings, term_embeddings, self._float_value(payload.get("threshold"), 0.72)),
        }

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

    def _float_value(self, value: Any, fallback: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return fallback


class SemanticEmbeddingCache:
    """Build the JS-compatible semantic term embedding cache shape from precomputed vectors."""

    def __init__(self, now=None):
        self.now = now or (lambda: "")

    def embedding_texts(self, dictionary: dict[str, Any]) -> list[str]:
        texts: list[str] = []
        for entry in dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []:
            if not isinstance(entry, dict):
                continue
            term = str(entry.get("term") or "").strip()
            if not term:
                continue
            meaning = str(entry.get("meaning") or "").strip()
            variants = entry.get("variants")
            variant_text = ", ".join(str(item).strip() for item in variants if str(item or "").strip()) if isinstance(variants, list) else ""
            texts.append(f"{term}: {meaning} | 鍙樹綋: {variant_text}" if variant_text else f"{term}: {meaning}")
        return texts

    def build_cache_payload(self, dictionary: dict[str, Any], embeddings: dict[str, Any]) -> dict[str, Any]:
        terms = [
            str(entry.get("term") or "").strip()
            for entry in dictionary.get("entries") if isinstance(dictionary.get("entries"), list)
            if isinstance(entry, dict) and str(entry.get("term") or "").strip()
        ]
        normalized_embeddings: dict[str, list[float]] = {}
        for term in terms:
            if term not in embeddings:
                continue
            normalized_embeddings[term] = self._numeric_vector(embeddings.get(term))
        return {
            "dictionaryVersion": dictionary.get("version"),
            "termCount": len(dictionary.get("entries") if isinstance(dictionary.get("entries"), list) else []),
            "builtAt": self.now(),
            "embeddings": normalized_embeddings,
        }

    def _numeric_vector(self, value: Any) -> list[float]:
        if not isinstance(value, list):
            return []
        result: list[float] = []
        for item in value:
            try:
                result.append(float(item))
            except (TypeError, ValueError):
                result.append(0.0)
        return result


class SemanticEvidenceBuilder:
    """Convert precomputed semantic matches into JS-compatible dictionary evidence entries."""

    def __init__(self, now=None):
        self.now = now or (lambda: "")

    def build_evidence_entries(
        self,
        dictionary: dict[str, Any],
        matches: list[dict[str, Any]],
        target_evidence: int = 3,
        source: str = "Bilibili public comment semantic match",
        uid: str = "",
    ) -> list[dict[str, Any]]:
        weak_entries = {
            str(entry.get("term") or "").strip(): entry
            for entry in dictionary.get("entries") if isinstance(dictionary.get("entries"), list)
            if isinstance(entry, dict)
            and str(entry.get("term") or "").strip()
            and int(entry.get("evidenceCount") or 0) < int(target_evidence)
        }
        by_term: dict[str, dict[str, Any]] = {}
        seen_samples: dict[str, set[str]] = {}
        for match in matches:
            if not isinstance(match, dict):
                continue
            term = str(match.get("term") or "").strip()
            chunk = str(match.get("chunk") or "").strip()
            if term not in weak_entries or not chunk:
                continue
            entry = by_term.setdefault(
                term,
                {
                    "term": term,
                    "evidenceSamples": [],
                    "evidenceSources": [],
                    "updatedAt": self.now(),
                },
            )
            seen = seen_samples.setdefault(term, set())
            if chunk not in seen:
                seen.add(chunk)
                if len(entry["evidenceSamples"]) < 5:
                    entry["evidenceSamples"].append(chunk)
            if len(entry["evidenceSources"]) < 8:
                entry["evidenceSources"].append(
                    {
                        "source": f"[Semantic match, score={round(float(match.get('score') or 0), 4)}] {source}",
                        "uid": uid,
                        "sample": chunk,
                    }
                )
        for entry in by_term.values():
            entry["evidenceCount"] = len(entry["evidenceSamples"])
        return list(by_term.values())
