from __future__ import annotations

import re
import unicodedata
from typing import Any


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _clean_needle(value: Any) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    return re.sub(r"[^\w\u3400-\u9fff]+", "", text, flags=re.UNICODE).lower()


def _has_chinese(value: Any) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", str(value or "")))


def _is_scrape_diagnostic(value: Any) -> bool:
    message = _clean_text(value)
    return bool(
        re.search(r"(?:^|[:\s])(?:discover|explicit Tieba thread URLs):\s+.*HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://", message, re.IGNORECASE)
        or re.search(r"HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://(?:tieba|c\.tieba|www\.bilibili|api\.bilibili)\.", message, re.IGNORECASE)
    )


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

        hits = self._lexical_hits(dictionary or {}, message)
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
            return _clean_text(comment.get("message"))
        return _clean_text(comment)

    def _lexical_hits(self, dictionary: dict[str, Any], message: str) -> list[dict[str, Any]]:
        clean_message = _clean_needle(message)
        hits = []
        for entry in dictionary.get("entries") or []:
            if not isinstance(entry, dict):
                continue
            needles = [entry.get("term"), *(entry.get("aliases") or []), *(entry.get("examples") or [])]
            normalized = [_clean_needle(needle) for needle in needles if len(_clean_needle(needle)) >= 2]
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
