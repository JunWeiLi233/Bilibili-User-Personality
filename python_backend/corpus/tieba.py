from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


class TiebaCorpusUpdateSummary:
    """Shape Tieba corpus update results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("changed", "newComments", "corpus")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class TiebaCorpusUpdater:
    """Build JS-compatible Tieba corpus updates from a scrape run."""

    def build_update_result(self, corpus: dict[str, Any] | None, run: dict[str, Any] | None, generated_at: str | None = None) -> dict[str, Any]:
        return {"ok": True, **self.build_update(corpus, run, generated_at)}

    def build_update(self, corpus: dict[str, Any] | None, run: dict[str, Any] | None, generated_at: str | None = None) -> dict[str, Any]:
        generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        existing = corpus if isinstance(corpus, dict) and isinstance(corpus.get("runs"), list) else {"version": 1, "updatedAt": None, "runs": [], "comments": []}
        new_comments = self._new_comments(run or {})
        if not new_comments:
            return {"changed": False, "corpus": existing, "newComments": []}

        comments = self.unique_comments([*(existing.get("comments") or []), *new_comments])
        return {
            "changed": True,
            "newComments": new_comments,
            "corpus": {
                "version": 1,
                "updatedAt": generated_at,
                "runs": [*(existing.get("runs") or [])[-49:], run or {}],
                "comments": comments,
            },
        }

    def unique_comments(self, comments: list[Any]) -> list[dict[str, Any]]:
        seen = set()
        unique = []
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            message = str(comment.get("message") or "").strip()
            if not message:
                continue
            key = f"{comment.get('sourceUrl') or ''}\n{comment.get('rpid') or ''}\n{comment.get('message')}"
            if key not in seen:
                seen.add(key)
                unique.append(comment)
        return unique

    def _new_comments(self, run: dict[str, Any]) -> list[Any]:
        comments = []
        for result in run.get("results") or []:
            if isinstance(result, dict):
                result_comments = result.get("comments") or []
                if isinstance(result_comments, list):
                    comments.extend(result_comments)
        return comments
