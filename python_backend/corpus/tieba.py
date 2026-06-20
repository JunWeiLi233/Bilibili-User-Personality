from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
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


class TiebaCorpusUpdateRunner:
    """Run a Tieba corpus update from existing corpus and scrape-run JSON files."""

    def __init__(self, existing_path: str | Path, run_path: str | Path, generated_at: str | None = None):
        self.existing_path = Path(existing_path)
        self.run_path = Path(run_path)
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.updater = TiebaCorpusUpdater()

    def run(self) -> dict[str, Any]:
        existing = self._read_json(self.existing_path, {"version": 1, "updatedAt": None, "runs": [], "comments": []})
        run = self._read_json(self.run_path, {})
        return self.updater.build_update_result(existing, run, self.generated_at)

    def _read_json(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class TiebaCorpusPayloadRunner:
    """Run a Tieba corpus update from one JS/Python payload JSON file."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.updater = TiebaCorpusUpdater()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        existing = payload.get("existing") if isinstance(payload.get("existing"), dict) else {"version": 1, "updatedAt": None, "runs": [], "comments": []}
        run = payload.get("run") if isinstance(payload.get("run"), dict) else {}
        generated_at = payload.get("generatedAt") if isinstance(payload.get("generatedAt"), str) else None
        return self.updater.build_update_result(existing, run, generated_at)

    def _read_payload(self) -> dict[str, Any]:
        if not self.payload_path.exists():
            return {}
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class TiebaCorpusUpdateContractComparator:
    """Compare Python Tieba corpus updates against saved JS-compatible JSON."""

    def __init__(
        self,
        existing_path: str | Path,
        run_path: str | Path,
        js_report_path: str | Path,
        generated_at: str | None = None,
    ):
        self.existing_path = Path(existing_path)
        self.run_path = Path(run_path)
        self.js_report_path = Path(js_report_path)
        self.generated_at = generated_at
        self.summary = TiebaCorpusUpdateSummary()

    def compare(self) -> dict[str, Any]:
        python_result = TiebaCorpusUpdateRunner(self.existing_path, self.run_path, generated_at=self.generated_at).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
