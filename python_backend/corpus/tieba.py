from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.corpus.loader import CorpusLoader
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


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
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        loaded = CorpusLoader(self.existing_path, fallback={"version": 1, "updatedAt": None, "runs": [], "comments": []}).load()
        existing = {**loaded.manifest, "comments": loaded.comments, "runs": loaded.runs}
        run = self._read_json(self.run_path, {})
        return self.updater.build_update_result(existing, run, self.generated_at)

    def _read_json(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        payload = self.reader.read_value(path, fallback)
        return payload if isinstance(payload, dict) else fallback


class TiebaCorpusPayloadRunner:
    """Run a Tieba corpus update from one JS/Python payload JSON file."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.updater = TiebaCorpusUpdater()
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        loaded = CorpusLoader.load_from_payload(self._existing_corpus_payload(payload))
        existing = {**loaded.manifest, "comments": loaded.comments, "runs": loaded.runs}
        run = payload.get("run") if isinstance(payload.get("run"), dict) else {}
        generated_at = payload.get("generatedAt") if isinstance(payload.get("generatedAt"), str) else None
        return self.updater.build_update_result(existing, run, generated_at)

    def _existing_corpus_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        fallback = {"version": 1, "updatedAt": None, "runs": [], "comments": []}
        if isinstance(payload.get("existing"), dict):
            return {"corpus": payload["existing"]}
        if isinstance(payload.get("corpus"), dict) or payload.get("corpusPath") or payload.get("path"):
            return {**payload, "fallback": fallback}
        return {"corpus": fallback}

    def _read_payload(self) -> dict[str, Any]:
        payload = self.reader.read_value(self.payload_path, {})
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
        return safe_read_json_object(self.js_report_path)


class TiebaCorpusJsonPayloadContractComparator:
    """Compare one-file Tieba corpus payload output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = TiebaCorpusUpdateSummary()

    def compare(self) -> dict[str, Any]:
        python_result = TiebaCorpusPayloadRunner(self.payload_path).run()
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
        return safe_read_json_object(self.js_report_path)


class TiebaCorpusRequest:
    """Corpus-layer request object for Tieba corpus update JSON contract modes."""

    def __init__(
        self,
        existing_path: str | Path | None = None,
        run_path: str | Path | None = None,
        *,
        payload_path: str | Path | None = None,
        compare_js_report_path: str | Path | None = None,
        generated_at: str | None = None,
    ):
        self.existing_path = Path(existing_path) if existing_path else None
        self.run_path = Path(run_path) if run_path else None
        self.payload_path = Path(payload_path) if payload_path else None
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None
        self.generated_at = generated_at

    def run(self) -> dict[str, Any]:
        if self.payload_path:
            if self.compare_js_report_path:
                return TiebaCorpusJsonPayloadContractComparator(
                    self.payload_path,
                    self.compare_js_report_path,
                ).compare()
            return TiebaCorpusPayloadRunner(self.payload_path).run()
        if self.existing_path is None or self.run_path is None:
            raise ValueError("existing_path and run_path are required when payload_path is not provided")
        if self.compare_js_report_path:
            return TiebaCorpusUpdateContractComparator(
                self.existing_path,
                self.run_path,
                self.compare_js_report_path,
                generated_at=self.generated_at,
            ).compare()
        return TiebaCorpusUpdateRunner(self.existing_path, self.run_path, generated_at=self.generated_at).run()


class TiebaCorpusCommandRequest:
    """Argv-backed corpus-layer request for Tieba corpus update commands."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a JS-compatible Tieba corpus update from JSON contracts.")
        parser.add_argument("--payload", default="", help="Single JSON payload containing existing, run, and optional generatedAt.")
        parser.add_argument("--existing", default="server/data/tiebaKeywordCorpus.json")
        parser.add_argument("--run", default="", help="Path to a Tieba scrape run JSON object.")
        parser.add_argument("--generated-at", default="")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba corpus update report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        parser = self.parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if not args.payload and not args.run:
            parser.error("--run is required unless --payload is provided")
        return TiebaCorpusRequest(
            existing_path=args.existing,
            run_path=args.run or None,
            payload_path=args.payload or None,
            compare_js_report_path=args.compare_js_report or None,
            generated_at=args.generated_at or None,
        ).run()
