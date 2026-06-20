from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _clean_needle(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"[^\w\u3400-\u9fff]+", "", text, flags=re.UNICODE).lower()


def _is_contract_scalar(value: Any) -> bool:
    return isinstance(value, (str, int, float, bool))


def _has_chinese(value: Any) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


def _is_scrape_diagnostic(value: Any) -> bool:
    message = _clean_text(value)
    return bool(
        re.search(r"(?:^|[:\s])(?:discover|explicit Tieba thread URLs):\s+.*HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://", message, re.IGNORECASE)
        or re.search(r"HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://(?:tieba|c\.tieba|www\.bilibili|api\.bilibili)\.", message, re.IGNORECASE)
    )


def _is_emoji_or_emoticon_only(value: Any) -> bool:
    message = _clean_text(value)
    if not message:
        return False
    allowed_ascii = set("()<>[]=^_^;-:,.!?/\\|~*'\"` ")
    for char in message:
        if char in allowed_ascii:
            continue
        category = unicodedata.category(char)
        if category[0] in {"P", "S"}:
            continue
        return False
    return True


def _strip_mention_scaffolding(value: Any) -> str:
    message = _clean_text(value)
    message = re.sub(r"(?:回复|回復|reply)\s*@[^:：\s]+[\s:：]*", "", message, flags=re.IGNORECASE)
    message = re.sub(r"@[^:：\s]+", "", message)
    return message.strip()


class CommentCoverageClassifier:
    """Classify comment coverage against dictionary lexical evidence contracts."""

    def classify(self, dictionary: dict[str, Any] | None, comment: Any, options: dict[str, Any] | None = None) -> dict[str, Any]:
        message = self._comment_message(comment)
        if not message:
            return {"covered": False, "mode": "uncovered", "reason": "empty comment", "hits": [], "comment": message}
        if _is_scrape_diagnostic(message):
            return {
                "covered": True,
                "mode": "neutral",
                "reason": "scrape diagnostic line, not user speech",
                "hits": [],
                "comment": message,
            }

        hits = self._lexical_hits(dictionary or {}, _strip_mention_scaffolding(message))
        if hits:
            return {
                "covered": True,
                "mode": "keyword",
                "reason": "dictionary term matched",
                "hits": hits,
                "comment": message,
            }
        if _has_chinese(message):
            return {
                "covered": True,
                "mode": "neutral",
                "reason": "no dictionary risk term matched; comment remains analyzable as neutral/no-keyword speech",
                "hits": [],
                "comment": message,
            }
        if _is_emoji_or_emoticon_only(message):
            return {
                "covered": True,
                "mode": "neutral",
                "reason": "emoji/emoticon-only comment; analyzable as neutral tone without lexical risk term",
                "hits": [],
                "comment": message,
            }
        return {
            "covered": False,
            "mode": "uncovered",
            "reason": "non-Chinese or unsupported empty lexical content",
            "hits": [],
            "comment": message,
        }

    def sample(self, dictionary: dict[str, Any] | None, comments: list[Any] | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        options = options or {}
        comments = comments if isinstance(comments, list) else []
        sample_size = int(options.get("sampleSize") or len(comments))
        picked = comments[: max(0, sample_size)]
        samples = [self.classify(dictionary or {}, comment, options) for comment in picked]
        by_mode = {"keyword": 0, "neutral": 0, "uncovered": 0}
        for sample in samples:
            by_mode[sample["mode"]] = by_mode.get(sample["mode"], 0) + 1
        covered = len([sample for sample in samples if sample["covered"]])
        return {
            "total": len(samples),
            "covered": covered,
            "uncovered": len(samples) - covered,
            "coverageRatio": covered / len(samples) if samples else 1,
            "byMode": by_mode,
            "samples": samples,
        }

    def sample_result(self, dictionary: dict[str, Any] | None, comments: list[Any] | None = None, options: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"ok": True, "summary": self.sample(dictionary, comments, options)}

    def _comment_message(self, comment: Any) -> str:
        if isinstance(comment, dict):
            return _clean_text(
                comment.get("message")
                or comment.get("text")
                or comment.get("commentText")
                or comment.get("combinedText")
                or comment.get("content")
            )
        return _clean_text(comment)

    def _lexical_hits(self, dictionary: dict[str, Any], message: str) -> list[dict[str, Any]]:
        clean_message = _clean_needle(message)
        hits = []
        for entry in dictionary.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            aliases = entry.get("aliases") if isinstance(entry.get("aliases"), list) else []
            examples = entry.get("examples") if isinstance(entry.get("examples"), list) else []
            needles = [entry.get("term"), *aliases, *examples]
            normalized = []
            for needle in needles:
                if not _is_contract_scalar(needle):
                    continue
                clean_needle = _clean_needle(needle)
                if len(clean_needle) >= 2:
                    normalized.append(clean_needle)
            if any(needle in clean_message for needle in normalized):
                hits.append(
                    {
                        "term": _clean_text(entry.get("term")),
                        "family": _clean_text(entry.get("family") or "attack"),
                        "meaning": entry.get("meaning"),
                    }
                )
        return hits


class CommentCoverageSummary:
    """Shape comment coverage reports into the JS/Python comparator summary contract."""

    SUMMARY_KEYS = ("total", "covered", "uncovered", "coverageRatio")
    MODE_KEYS = ("keyword", "neutral", "uncovered")

    def summarize(self, summary: dict[str, Any] | None = None) -> dict[str, Any]:
        summary = summary if isinstance(summary, dict) else {}
        by_mode = summary.get("byMode") if isinstance(summary.get("byMode"), dict) else {}
        result = {key: summary.get(key) for key in self.SUMMARY_KEYS}
        result["byMode"] = {key: by_mode.get(key) for key in self.MODE_KEYS}
        return result


class CommentCoverageContractComparator:
    """Compare comment coverage summaries using the JS/Python JSON contract."""

    def __init__(self, summary: CommentCoverageSummary | None = None):
        self.summary = summary or CommentCoverageSummary()

    def compare(self, python_report: dict[str, Any] | None, js_report: dict[str, Any] | None) -> dict[str, Any]:
        python_report = python_report if isinstance(python_report, dict) else {}
        js_report = js_report if isinstance(js_report, dict) else {}
        python_summary = python_report.get("summary") if isinstance(python_report.get("summary"), dict) else {}
        js_summary = js_report.get("summary") if isinstance(js_report.get("summary"), dict) else js_report
        js_summary = js_summary if isinstance(js_summary, dict) else {}
        mismatches = self._summary_mismatches(python_summary, js_summary)
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {"summary": self.summary.summarize(python_summary)},
            "js": {"summary": self.summary.summarize(js_summary)},
        }

    def _summary_mismatches(self, python_summary: dict[str, Any], js_summary: dict[str, Any]) -> list[dict[str, Any]]:
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        python_modes = python_summary.get("byMode") if isinstance(python_summary.get("byMode"), dict) else {}
        js_modes = js_summary.get("byMode") if isinstance(js_summary.get("byMode"), dict) else {}
        mismatches.extend(
            {"key": f"byMode.{key}", "python": python_modes.get(key), "js": js_modes.get(key)}
            for key in self.summary.MODE_KEYS
            if key in js_modes and python_modes.get(key) != js_modes.get(key)
        )
        return mismatches


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
        return self.classifier.sample_result(dictionary, comments, options)

    def _read_dictionary(self) -> dict[str, Any]:
        loaded = DictionaryLoader(self.dictionary_path).load()
        return {**loaded.manifest, "entries": loaded.entries}

    def _read_comments(self) -> list[Any]:
        return CorpusLoader(self.comments_path).load().comments


class CommentCoverageJsonPayloadRunner:
    """Run comment coverage from one JS/Python payload JSON file."""

    def __init__(self, payload_path: str | Path) -> None:
        self.payload_path = Path(payload_path)
        self.classifier = CommentCoverageClassifier()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        loaded_dictionary = DictionaryLoader.load_from_payload(self._dictionary_payload(payload))
        dictionary = {**loaded_dictionary.manifest, "entries": loaded_dictionary.entries}
        comments = CorpusLoader.load_from_payload(self._corpus_payload(payload)).comments
        options = {}
        if payload.get("sampleSize") is not None:
            options["sampleSize"] = payload.get("sampleSize")
        return self.classifier.sample_result(dictionary, comments, options)

    def _read_payload(self) -> dict[str, Any]:
        payload = _read_json(self.payload_path)
        return payload if isinstance(payload, dict) else {}

    def _dictionary_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if "dictionary" in payload or payload.get("dictionaryPath"):
            return payload
        return {"dictionary": {"entries": []}}

    def _corpus_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        if "corpus" in payload or payload.get("corpusPath") or payload.get("path"):
            return payload
        return {"corpus": {"comments": payload.get("comments") if isinstance(payload.get("comments"), list) else []}}


class CommentCoveragePayloadContractComparator:
    """Compare file-backed Python comment coverage against a persisted JS-compatible report."""

    def __init__(
        self,
        dictionary_path: str | Path,
        comments_path: str | Path,
        js_report_path: str | Path,
        sample_size: int | None = None,
    ) -> None:
        self.dictionary_path = Path(dictionary_path)
        self.comments_path = Path(comments_path)
        self.js_report_path = Path(js_report_path)
        self.sample_size = sample_size
        self.summary = CommentCoverageSummary()
        self.comparator = CommentCoverageContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_report = CommentCoverageRunner(self.dictionary_path, self.comments_path, self.sample_size).run()
        js_report = self._read_js_report()
        return self.comparator.compare(python_report, js_report)

    def _read_js_report(self) -> dict[str, Any]:
        payload = _read_json(self.js_report_path)
        return payload if isinstance(payload, dict) else {}


class CommentCoverageJsonPayloadContractComparator:
    """Compare one-file comment coverage payload output against a JS-compatible report."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path) -> None:
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CommentCoverageSummary()
        self.comparator = CommentCoverageContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_report = CommentCoverageJsonPayloadRunner(self.payload_path).run()
        js_report = self._read_js_report()
        return self.comparator.compare(python_report, js_report)

    def _read_js_report(self) -> dict[str, Any]:
        payload = _read_json(self.js_report_path)
        return payload if isinstance(payload, dict) else {}


def _read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)
