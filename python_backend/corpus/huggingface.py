from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from io import StringIO
from typing import Any


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _has_han_text(value: Any) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


@dataclass(frozen=True)
class HuggingFaceSource:
    dataset: str = ""
    file: str = ""
    platform: str = "huggingface"
    provider: str = ""
    limit: int = 500
    offset: int = 0

    @classmethod
    def from_options(cls, options: dict[str, Any]) -> "HuggingFaceSource":
        return cls(
            dataset=_clean_text(options.get("dataset")),
            file=_clean_text(options.get("file")),
            platform=_clean_text(options.get("platform") or "huggingface").lower(),
            provider=_clean_text(options.get("provider")),
            limit=max(1, min(int(options.get("limit") or 500), 5000)),
            offset=max(0, int(options.get("offset") or 0)),
        )


class HuggingFaceCorpusImporter:
    """Parse external HuggingFace/Kaggle rows into the JS corpus JSON contract."""

    def parse_rows(self, raw: str, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        source = HuggingFaceSource.from_options(options or {})
        rows = self._parse_raw_rows(raw, source.file)
        comments: list[dict[str, Any]] = []
        accepted = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            detected_platform = self._row_platform(row, source.platform)
            if source.platform and detected_platform and detected_platform != source.platform:
                continue
            message = _clean_text(self._first_text_field(row, source))
            if not message or not _has_han_text(message):
                continue
            if accepted < source.offset:
                accepted += 1
                continue
            comments.append(
                {
                    "message": message,
                    "platform": detected_platform or source.platform or "huggingface",
                    "source": self._source_for_row(source, row),
                    "sourceUrl": _clean_text(row.get("url") or row.get("sourceUrl") or row.get("source") or row.get("href")),
                    "uid": _clean_text(row.get("creator_id") or row.get("user_id") or row.get("uid") or row.get("author") or row.get("comment_id")),
                    "uname": _clean_text(row.get("creator_name") or row.get("username") or row.get("uname") or row.get("user")),
                    "dataset": source.dataset,
                    "file": source.file,
                }
            )
            accepted += 1
            if len(comments) >= source.limit:
                break
        return comments

    def build_update(
        self,
        existing: dict[str, Any] | None,
        imported_rows: list[dict[str, Any]],
        run: dict[str, Any] | None = None,
        generated_at: str | None = None,
    ) -> dict[str, Any]:
        generated_at = generated_at or ""
        corpus = existing if isinstance(existing, dict) and isinstance(existing.get("comments"), list) else {"version": 1, "updatedAt": None, "runs": [], "comments": []}
        before = self.unique_comments(list(corpus.get("comments") or []))
        comments = self.unique_comments([*before, *imported_rows])
        added_comments = max(0, len(comments) - len(before))
        if added_comments == 0:
            return {"changed": False, "corpus": corpus, "addedComments": 0}
        run_payload = {**(run or {}), "addedComments": added_comments, "importedRows": len(imported_rows)}
        return {
            "changed": True,
            "addedComments": added_comments,
            "corpus": {
                "version": 1,
                "updatedAt": generated_at,
                "runs": [*(corpus.get("runs") or [])[-49:], run_payload],
                "comments": comments,
            },
        }

    def unique_comments(self, comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        seen = set()
        unique: list[dict[str, Any]] = []
        for comment in comments:
            message = _clean_text(comment.get("message") if isinstance(comment, dict) else "")
            if not message:
                continue
            key = f"{comment.get('platform') or ''}\n{comment.get('sourceUrl') or comment.get('source') or ''}\n{message}"
            if key not in seen:
                seen.add(key)
                unique.append(comment)
        return unique

    def _parse_raw_rows(self, raw: str, file: str) -> list[dict[str, Any]]:
        if re.search(r"\.csv$", file, re.IGNORECASE):
            return self._parse_csv(raw)
        if re.search(r"\.jsonl$", file, re.IGNORECASE):
            return self._split_jsonl(raw)
        try:
            parsed = json.loads(str(raw or ""))
            if isinstance(parsed, list):
                return [row for row in parsed if isinstance(row, dict)]
            if isinstance(parsed, dict):
                rows: list[dict[str, Any]] = []
                for value in parsed.values():
                    if isinstance(value, list):
                        rows.extend(row for row in value if isinstance(row, dict))
                    elif isinstance(value, dict):
                        rows.append(value)
                return rows
        except json.JSONDecodeError:
            pass
        return self._split_jsonl(raw)

    def _split_jsonl(self, raw: str) -> list[dict[str, Any]]:
        rows = []
        for line in str(raw or "").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                parsed = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict):
                rows.append(parsed)
        return rows

    def _parse_csv(self, raw: str) -> list[dict[str, Any]]:
        reader = csv.DictReader(StringIO(str(raw or "")))
        return [dict(row) for row in reader]

    def _first_text_field(self, row: dict[str, Any], source: HuggingFaceSource) -> str:
        messages = row.get("messages")
        if isinstance(messages, list):
            for item in messages:
                if isinstance(item, dict) and _clean_text(item.get("content")) and _clean_text(item.get("role")) != "assistant":
                    return str(item.get("content") or "")
        for field in ("comment", "message", "content", "text", "instruction", "input", "output"):
            if row.get(field):
                return str(row.get(field) or "")
        if self._is_tieba_like_row(row, source):
            values = []
            for value in (_clean_text(row.get("title")), _clean_text(row.get("detail"))):
                if value and value not in values:
                    values.append(value)
            return " ".join(values)
        return ""

    def _is_tieba_like_row(self, row: dict[str, Any], source: HuggingFaceSource) -> bool:
        platform = _clean_text(row.get("platform") or row.get("source_platform") or source.platform).lower()
        href = _clean_text(row.get("href") or row.get("url") or row.get("sourceUrl") or row.get("source"))
        return platform == "tieba" or bool(re.search(r"tieba\.baidu\.com", href, re.IGNORECASE))

    def _row_platform(self, row: dict[str, Any], fallback: str) -> str:
        return _clean_text(row.get("platform") or row.get("source_platform") or fallback).lower()

    def _source_for_row(self, source: HuggingFaceSource, row: dict[str, Any]) -> str:
        url = _clean_text(row.get("url") or row.get("sourceUrl") or row.get("source") or row.get("href"))
        provider = source.provider or ("Kaggle dataset" if source.dataset.startswith("kaggle:") else "Hugging Face dataset")
        prefix = f"{provider}: {source.dataset}{('/' + source.file) if source.file else ''}"
        return f"{prefix}: {url}" if url else prefix
