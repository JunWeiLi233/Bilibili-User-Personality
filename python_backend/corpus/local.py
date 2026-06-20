from __future__ import annotations

import json
from pathlib import Path
import re
import unicodedata
from typing import Any


def clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_scrape_diagnostic_message(value: Any) -> bool:
    message = clean_text(value)
    return bool(
        re.search(r"(?:^|[:\s])(?:discover|explicit Tieba thread URLs):\s+.*HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://", message, re.IGNORECASE)
        or re.search(r"HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?://(?:tieba|c\.tieba|www\.bilibili|api\.bilibili)\.", message, re.IGNORECASE)
    )


def clean_comment_message(value: Any) -> str:
    message = clean_text(value)
    return message if message and not is_scrape_diagnostic_message(message) else ""


class LocalCorpusFlattener:
    """Flatten local Bilibili/Tieba corpus shapes into the JS comment contract."""

    def flatten_to_result(self, raw: Any) -> dict[str, Any]:
        comments = self.flatten(raw)
        return {
            "ok": True,
            "count": len(comments),
            "comments": comments,
        }

    def flatten(self, raw: Any) -> list[dict[str, str]]:
        if isinstance(raw, list) and all(isinstance(item, str) for item in raw):
            return [
                {"message": message, "platform": "bilibili", "source": "Bilibili local text corpus", "uid": "", "uname": ""}
                for message in (clean_comment_message(item) for item in raw)
                if message
            ]

        if isinstance(raw, dict) and isinstance(raw.get("_uidComments"), dict):
            return self._flatten_uid_comment_map(raw.get("_uidComments") or {})

        if isinstance(raw, dict) and isinstance(raw.get("comments"), list):
            return self._flatten_top_level_comments(raw.get("comments") or [])

        if isinstance(raw, dict) and isinstance(raw.get("runs"), list):
            return self._flatten_run_comments(raw.get("runs") or [])

        if isinstance(raw, dict) and isinstance(raw.get("users"), dict):
            return self._flatten_users(raw.get("users") or {})

        values = raw if isinstance(raw, list) else self._object_values(raw)
        return self._flatten_uid_comment_map({"": values})

    def _flatten_top_level_comments(self, comments: list[Any]) -> list[dict[str, str]]:
        flattened = []
        for item in comments:
            if not isinstance(item, dict):
                continue
            message = clean_comment_message(item.get("message"))
            if not message:
                continue
            platform = clean_text(item.get("platform")) or "bilibili"
            flattened.append(
                {
                    "message": message,
                    "platform": platform,
                    "source": clean_text(item.get("source")) or (self._source_for_tieba_comment(item) if platform == "tieba" else "Bilibili local corpus"),
                    "uid": clean_text(item.get("uid") or item.get("mid")),
                    "uname": clean_text(item.get("uname")),
                }
            )
        return flattened

    def _flatten_run_comments(self, runs: list[Any]) -> list[dict[str, str]]:
        flattened = []
        for run in runs:
            if not isinstance(run, dict):
                continue
            for result in run.get("results") or []:
                if not isinstance(result, dict):
                    continue
                for item in result.get("comments") or []:
                    if not isinstance(item, dict):
                        continue
                    message = clean_comment_message(item.get("message"))
                    if not message:
                        continue
                    platform = clean_text(item.get("platform")) or "tieba"
                    flattened.append(
                        {
                            "message": message,
                            "platform": platform,
                            "source": self._source_for_tieba_comment(item) if platform == "tieba" else clean_text(item.get("source")) or "Bilibili local corpus",
                            "uid": clean_text(item.get("uid") or item.get("mid")),
                            "uname": clean_text(item.get("uname")),
                        }
                    )
        return flattened

    def _flatten_uid_comment_map(self, raw_map: dict[str, Any]) -> list[dict[str, str]]:
        flattened = []
        for uid, items in raw_map.items():
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                message = clean_comment_message(item.get("message"))
                if not message:
                    continue
                bvid = clean_text(item.get("bvid"))
                flattened.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_bilibili_comment(item),
                        "uid": bvid or clean_text(item.get("uid") or uid),
                        "uname": clean_text(item.get("uname")),
                    }
                )
        return flattened

    def _flatten_users(self, users: dict[str, Any]) -> list[dict[str, str]]:
        comments = []
        for uid, user in users.items():
            if not isinstance(user, dict):
                continue
            bvids = user.get("bvids") if isinstance(user.get("bvids"), list) else []
            comment_lines = self._split_comment_text(user.get("commentText"))
            scraped_lines = comment_lines or self._split_comment_text(user.get("combinedText"))
            for index, message in enumerate(scraped_lines):
                comments.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_scraped_user_comment(bvids[index] if index < len(bvids) else ""),
                        "uid": clean_text(user.get("uid") or uid),
                        "uname": clean_text(user.get("uname") or user.get("name")),
                    }
                )
            for item in user.get("comments") if isinstance(user.get("comments"), list) else []:
                message = clean_comment_message(item.get("message") if isinstance(item, dict) else "")
                if not message:
                    continue
                comments.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_aicu_object("Bilibili local AICU corpus", item.get("oid")),
                        "uid": clean_text(uid),
                        "uname": clean_text(item.get("uname") or user.get("name")),
                    }
                )
            for item in user.get("danmaku") if isinstance(user.get("danmaku"), list) else []:
                message = clean_comment_message((item.get("content") or item.get("message")) if isinstance(item, dict) else "")
                if not message:
                    continue
                comments.append(
                    {
                        "message": message,
                        "platform": "bilibili",
                        "source": self._source_for_aicu_object("Bilibili local AICU danmaku corpus", item.get("oid")),
                        "uid": clean_text(uid),
                        "uname": clean_text(item.get("uname") or user.get("name")),
                    }
                )
        return comments

    def _split_comment_text(self, value: Any) -> list[str]:
        return [message for message in (clean_comment_message(item) for item in str(value or "").splitlines()) if message]

    def _source_for_bilibili_comment(self, item: dict[str, Any]) -> str:
        bvid = clean_text(item.get("bvid"))
        return f"Bilibili local UID discovery corpus: https://www.bilibili.com/video/{bvid}/" if bvid else "Bilibili local UID discovery corpus"

    def _source_for_scraped_user_comment(self, bvid: Any) -> str:
        bvid = clean_text(bvid)
        return f"Bilibili local scraped user corpus: https://www.bilibili.com/video/{bvid}/" if bvid else "Bilibili local scraped user corpus"

    def _source_for_aicu_object(self, prefix: str, oid: Any) -> str:
        oid = clean_text(oid)
        return f"{prefix}: https://www.bilibili.com/video/av{oid}/" if oid else prefix

    def _source_for_tieba_comment(self, item: dict[str, Any]) -> str:
        source_url = clean_text(item.get("sourceUrl") or item.get("source"))
        return f"Tieba public thread scan: {source_url}" if source_url else "Tieba public thread scan"

    def _object_values(self, raw: Any) -> list[Any]:
        if not isinstance(raw, dict):
            return []
        values = []
        for value in raw.values():
            if isinstance(value, list):
                values.extend(value)
            else:
                values.append(value)
        return values


class LocalCorpusFlattenSummary:
    """Shape local corpus flatten results into the JS/Python comparator contract."""

    RESULT_KEYS = ("count", "comments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class LocalCorpusFlattenContractComparator:
    """Compare local corpus flatten results using the JS/Python JSON contract."""

    def __init__(self, summary: LocalCorpusFlattenSummary | None = None):
        self.summary = summary or LocalCorpusFlattenSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
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


class LocalCorpusFlattenRunner:
    """Flatten local corpus JSON into the shared comment contract."""

    def __init__(self, input_path: str | Path):
        self.input_path = Path(input_path)
        self.flattener = LocalCorpusFlattener()

    def run(self) -> dict[str, Any]:
        with self.input_path.open("r", encoding="utf-8-sig") as handle:
            raw = json.load(handle)
        return self.flattener.flatten_to_result(raw)


class LocalCorpusFlattenPayloadContractComparator:
    """Compare local-corpus flatten payload output against saved JS-compatible JSON."""

    def __init__(self, input_path: str | Path, js_report_path: str | Path):
        self.input_path = Path(input_path)
        self.js_report_path = Path(js_report_path)
        self.summary = LocalCorpusFlattenSummary()
        self.comparator = LocalCorpusFlattenContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = LocalCorpusFlattenRunner(self.input_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def _evidence_count(entry: dict[str, Any]) -> int:
    count = entry.get("evidenceCount")
    if count is None:
        count = len(entry.get("evidence") or entry.get("evidenceSamples") or [])
    try:
        return max(0, int(count))
    except (TypeError, ValueError):
        return 0


def _is_video_context_evidence_source(source: dict[str, Any]) -> bool:
    sample = clean_text(source.get("sample"))
    source_text = clean_text(source.get("source"))
    return (
        sample.startswith("Bilibili video context:")
        or sample.startswith("Bilibili public video title:")
        or "search-discovered video context" in source_text
    )


def _is_comment_backed_sample(sample: Any) -> bool:
    sample_text = clean_text(sample)
    return bool(
        sample_text
        and not sample_text.startswith("Bilibili video context:")
        and not sample_text.startswith("Bilibili public video title:")
    )


def _has_bilibili_comment_scan_source(entry: dict[str, Any]) -> bool:
    for source in entry.get("evidenceSources") or []:
        source_text = clean_text(source.get("source") if isinstance(source, dict) else "")
        if source_text.startswith("Bilibili public ") and "comment scan" in source_text:
            return True
    return False


def _comment_backed_evidence_count(entry: dict[str, Any]) -> int:
    raw_count = _evidence_count(entry)
    if raw_count == 0:
        return 0
    samples = set()
    for source in entry.get("evidenceSources") or []:
        if not isinstance(source, dict):
            continue
        sample = clean_text(source.get("sample"))
        if sample and not _is_video_context_evidence_source(source) and _is_comment_backed_sample(sample):
            samples.add(sample)
    if _has_bilibili_comment_scan_source(entry):
        for sample in entry.get("evidenceSamples") or []:
            sample_text = clean_text(sample)
            if _is_comment_backed_sample(sample_text):
                samples.add(sample_text)
    return min(raw_count, len(samples))


def _coverage_evidence_count(entry: dict[str, Any], options: dict[str, Any]) -> int:
    if options.get("requireCommentBackedEvidence") is True:
        return _comment_backed_evidence_count(entry)
    count = entry.get("coverageEvidenceCount")
    if count is None:
        return _evidence_count(entry)
    try:
        return max(0, int(count))
    except (TypeError, ValueError):
        return 0


def _normalize_needle(value: Any) -> str:
    return unicodedata.normalize("NFKC", clean_text(value)).lower()


def _unique(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result


def _generated_colloquial_aliases(term: str) -> list[str]:
    aliases = []
    if len(term) >= 4:
        for suffix in ["\u554a", "\u5427", "\u5462", "\u561b", "\u5457"]:
            aliases.append(term[:-1] if term.endswith(suffix) else f"{term}{suffix}")
        aliases.append(term[:-1] if term.endswith("\u4e86") and len(term) > 4 else f"{term}\u4e86")
    if term == "\u5403\u76f8\u592a\u96be\u770b":
        aliases.extend(["\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86", "\u5403\u76f8\u96be\u770b"])
    return aliases


def _entry_needles(entry: dict[str, Any]) -> list[str]:
    term = clean_text(entry.get("term"))
    values = [
        term,
        *_generated_colloquial_aliases(term),
        *[clean_text(alias) for alias in entry.get("aliases") or []],
        *[clean_text(example) for example in entry.get("examples") or []],
    ]
    return [value for value in _unique([_normalize_needle(item) for item in values]) if len(value) >= 2]


def _existing_samples(entry: dict[str, Any]) -> set[str]:
    samples = []
    samples.extend(entry.get("evidence") or [])
    samples.extend(entry.get("evidenceSamples") or [])
    samples.extend(source.get("sample") for source in entry.get("evidenceSources") or [] if isinstance(source, dict))
    return {clean_text(sample) for sample in samples if clean_text(sample)}


def _source_backed_samples(entry: dict[str, Any]) -> set[str]:
    return {
        clean_text(source.get("sample"))
        for source in entry.get("evidenceSources") or []
        if isinstance(source, dict) and clean_text(source.get("sample"))
    }


def _source_has_recoverable_video_url(source: Any) -> bool:
    return bool(re.search(r"(?:https?://)?(?:www\.)?bilibili\.com/video/(?:BV[0-9A-Za-z]+|av\d+)", clean_text(source)))


def _has_recoverable_video_source(entry: dict[str, Any], sample: Any) -> bool:
    target_sample = clean_text(sample)
    if not target_sample:
        return False
    for source in entry.get("evidenceSources") or []:
        if not isinstance(source, dict):
            continue
        if clean_text(source.get("sample")) == target_sample and _source_has_recoverable_video_url(source.get("source")):
            return True
    return False


def _local_evidence_sample_score(match: dict[str, Any], entry: dict[str, Any]) -> int:
    sample = clean_text(match.get("sample"))
    term = clean_text(entry.get("term"))
    if not sample:
        return 0
    score = 0
    if term and term in sample:
        score += 3
    if 8 <= len(sample) <= 160:
        score += 2
    if re.search(r"[\u201c\u2018\u300a\u3010\u300c\u300e\uff08(]\s*[^\u201d\u2019\u300b\u3011\u300d\u300f\uff09)]{0,12}\s*[\u201d\u2019\u300b\u3011\u300d\u300f\uff09)]", sample):
        score += 1
    if re.search(r"\[[^\]]{1,40}\]|[\U0001f300-\U0001f64f\U0001f680-\U0001f6ff\u2600-\u27bf]", sample):
        score += 1
    if re.search(r"\u5f39\u5e55|\u8bc4\u8bba\u533a|\u8bc4\u8bba|\u56de\u590d|\u9510\u8bc4|\u6307\u70b9|\u61c2\u54e5|\u5012\u6253\u4e00\u8019|\u9006\u5929|\u7b11\u6b7b|\u7ef7|\u795e\u4eba|\u4ec0\u4e48", sample):
        score += 3
    if re.search(r"\u4e0d\u662f.*\u610f\u601d|\u4ec0\u4e48\u610f\u601d|\u600e\u4e48\u8bf4|\u8c01\u61c2|\u6709\u6ca1\u6709\u61c2", sample):
        score += 1
    if re.search(r"^\s*[\W\dA-Za-z\s]{0,8}\s*$", sample, re.UNICODE):
        score -= 3
    return score


class LocalCorpusEvidenceFinder:
    """Find merge-ready dictionary evidence from already-flattened local corpora."""

    def find_entries_result(
        self,
        dictionary: dict[str, Any] | None,
        comments: list[Any] | None,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        entries = self.find_entries(dictionary, comments, options)
        return {"ok": True, "count": len(entries), "entries": entries}

    def build_weak_term_set(self, dictionary: dict[str, Any] | None, options: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
        options = options or {}
        target_evidence = max(1, int(options.get("targetEvidence") or 3))
        target_terms = {clean_text(term) for term in options.get("targetTerms") or [] if clean_text(term)}
        weak: dict[str, dict[str, Any]] = {}
        for entry in (dictionary or {}).get("entries") or []:
            if not isinstance(entry, dict):
                continue
            term = clean_text(entry.get("term"))
            if not term:
                continue
            if term in target_terms or _coverage_evidence_count(entry, options) < target_evidence:
                weak[term] = entry
        return weak

    def find_entries(self, dictionary: dict[str, Any] | None, comments: list[Any] | None, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        options = options or {}
        weak_terms = self.build_weak_term_set(dictionary or {}, options)
        max_samples = max(1, int(options.get("maxSamplesPerTerm") or 3))
        entries = []

        for term, entry in weak_terms.items():
            seen_samples = _existing_samples(entry)
            sourced_samples = _source_backed_samples(entry)
            backfill_unsourced = options.get("requireCommentBackedEvidence") is True
            matched_samples = set()
            candidate_matches = []
            needles = _entry_needles(entry)
            for comment in comments if isinstance(comments, list) else []:
                if not isinstance(comment, dict):
                    continue
                message = clean_text(comment.get("message"))
                normalized_message = _normalize_needle(message)
                if not message or message in matched_samples or not any(needle in normalized_message for needle in needles):
                    continue
                if seen_samples and message in seen_samples:
                    has_recoverable_candidate = _source_has_recoverable_video_url(comment.get("source"))
                    already_backed = message in sourced_samples and _has_recoverable_video_source(entry, message)
                    if not backfill_unsourced or not has_recoverable_candidate or already_backed:
                        continue
                seen_samples.add(message)
                matched_samples.add(message)
                candidate_matches.append(
                    {
                        "source": clean_text(comment.get("source")) or "Bilibili local corpus",
                        "uid": clean_text(comment.get("uid")),
                        "sample": message,
                    }
                )
            matches = sorted(candidate_matches, key=lambda match: (-_local_evidence_sample_score(match, entry), len(clean_text(match.get("sample")))))[:max_samples]
            if not matches:
                continue
            entries.append(
                {
                    "term": term,
                    "family": entry.get("family") or "attack",
                    "meaning": entry.get("meaning") or "",
                    "evidence": [match["sample"] for match in matches],
                    "evidenceSamples": [match["sample"] for match in matches],
                    "evidenceSources": matches,
                }
            )
        return entries


class LocalCorpusEvidenceSummary:
    """Shape local corpus evidence results into the JS/Python comparator contract."""

    SUMMARY_KEYS = ("count", "terms", "evidence")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        entries = result.get("entries") if isinstance(result.get("entries"), list) else []
        terms = [entry.get("term") for entry in entries if isinstance(entry, dict)]
        return {
            "count": result.get("count", len(entries)),
            "terms": terms,
            "evidence": {
                entry.get("term"): self.entry_evidence(entry)
                for entry in entries
                if isinstance(entry, dict) and entry.get("term") is not None
            },
        }

    def entry_evidence(self, entry: dict[str, Any]) -> list[Any]:
        evidence = entry.get("evidence")
        if isinstance(evidence, list):
            return evidence
        samples = entry.get("evidenceSamples")
        if isinstance(samples, list):
            return samples
        return []


class LocalCorpusEvidenceContractComparator:
    """Compare local-corpus evidence reports using the JS/Python summary contract."""

    def __init__(self, summary: LocalCorpusEvidenceSummary | None = None):
        self.summary = summary or LocalCorpusEvidenceSummary()

    def compare(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> dict[str, Any]:
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }
