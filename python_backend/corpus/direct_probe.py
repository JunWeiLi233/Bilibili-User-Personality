from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from typing import Any


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _has_han(value: Any) -> bool:
    return bool(re.search(r"[\u3400-\u9fff]", _clean_text(value)))


def _evidence_count(entry: dict[str, Any]) -> int:
    count = entry.get("evidenceCount")
    if count is None:
        count = len(entry.get("evidence") or entry.get("evidenceSamples") or [])
    try:
        return max(0, int(count))
    except (TypeError, ValueError):
        return 0


def _is_video_context_source(source: dict[str, Any]) -> bool:
    sample = _clean_text(source.get("sample"))
    source_text = _clean_text(source.get("source"))
    return (
        sample.startswith("Bilibili video context:")
        or sample.startswith("Bilibili public video title:")
        or "search-discovered video context" in source_text
    )


def _is_comment_backed_sample(sample: Any) -> bool:
    sample_text = _clean_text(sample)
    return bool(
        sample_text
        and not sample_text.startswith("Bilibili video context:")
        and not sample_text.startswith("Bilibili public video title:")
    )


def _has_comment_scan_source(entry: dict[str, Any]) -> bool:
    for source in entry.get("evidenceSources") or []:
        source_text = _clean_text(source.get("source") if isinstance(source, dict) else "")
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
        sample = _clean_text(source.get("sample"))
        if sample and not _is_video_context_source(source) and _is_comment_backed_sample(sample):
            samples.add(sample)
    if _has_comment_scan_source(entry):
        for sample in entry.get("evidenceSamples") or []:
            sample_text = _clean_text(sample)
            if _is_comment_backed_sample(sample_text):
                samples.add(sample_text)
    return min(raw_count, len(samples))


def _coverage_evidence_count(entry: dict[str, Any], require_comment_backed_evidence: bool = False) -> int:
    if require_comment_backed_evidence:
        return _comment_backed_evidence_count(entry)
    count = entry.get("coverageEvidenceCount")
    if count is None:
        return _evidence_count(entry)
    try:
        return max(0, int(count))
    except (TypeError, ValueError):
        return 0


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


def _evidence_needles(entry: dict[str, Any]) -> list[str]:
    values = [
        _clean_text(entry.get("term")),
        *[_clean_text(alias) for alias in entry.get("aliases") or []],
        *[_clean_text(example) for example in entry.get("examples") or []],
    ]
    values.extend(_generated_colloquial_aliases(values[0]) if values and values[0] else [])
    return [value for value in _unique(values) if len(value) >= 2]


def _existing_samples(entry: dict[str, Any]) -> set[str]:
    samples = []
    samples.extend(entry.get("evidence") or [])
    samples.extend(entry.get("evidenceSamples") or [])
    samples.extend(source.get("sample") for source in entry.get("evidenceSources") or [] if isinstance(source, dict))
    return {_clean_text(sample) for sample in samples if _clean_text(sample)}


class DirectProbeCorpusBuilder:
    """Pure Python contract helpers for Bilibili direct evidence probe data."""

    def collect_reply_messages(self, replies: list[Any] | None, video: dict[str, Any] | None = None, bucket: list[dict[str, str]] | None = None) -> list[dict[str, str]]:
        video = video or {}
        bucket = bucket if bucket is not None else []
        for reply in replies if isinstance(replies, list) else []:
            if not isinstance(reply, dict):
                continue
            message = _clean_text((reply.get("content") or {}).get("message") if isinstance(reply.get("content"), dict) else "")
            if message:
                bucket.append(
                    {
                        "message": message,
                        "uid": _clean_text(reply.get("mid") or (reply.get("member") or {}).get("mid")),
                        "source": self._source_for_video(video, "comment"),
                    }
                )
            self.collect_reply_messages(reply.get("replies"), video, bucket)
        return bucket

    def collect_danmaku_messages(self, xml: str, video: dict[str, Any] | None = None) -> list[dict[str, str]]:
        video = video or {}
        comments = []
        uid = _clean_text(video.get("bvid") or video.get("cid") or video.get("aid"))
        for match in re.finditer(r"<d\b[^>]*>([\s\S]*?)</d>", str(xml or ""), re.IGNORECASE):
            message = _clean_text(html.unescape(match.group(1)))
            if not message:
                continue
            comments.append({"message": message, "uid": uid, "source": self._source_for_video(video, "danmaku")})
        return comments

    def build_fresh_evidence_entries(self, dictionary: dict[str, Any] | None, comments: list[Any] | None, options: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        options = options or {}
        target_evidence = max(1, int(options.get("targetEvidence") or 3))
        max_samples = max(1, int(options.get("maxSamplesPerTerm") or 3))
        target_terms = {_clean_text(term) for term in options.get("targetTerms") or [] if _clean_text(term)}
        require_comment_backed = options.get("requireCommentBackedEvidence") is True
        entries = []

        for entry in (dictionary or {}).get("entries") or []:
            if not isinstance(entry, dict):
                continue
            term = _clean_text(entry.get("term"))
            if not term:
                continue
            if term not in target_terms and _coverage_evidence_count(entry, require_comment_backed) >= target_evidence:
                continue
            needles = _evidence_needles(entry)
            seen = _existing_samples(entry)
            matches = []
            for comment in comments if isinstance(comments, list) else []:
                if not isinstance(comment, dict):
                    continue
                message = _clean_text(comment.get("message"))
                if not message or message in seen or not any(needle in message for needle in needles):
                    continue
                seen.add(message)
                matches.append(
                    {
                        "source": _clean_text(comment.get("source")) or "Bilibili public direct comment probe",
                        "uid": _clean_text(comment.get("uid")),
                        "sample": message,
                    }
                )
                if len(matches) >= max_samples:
                    break
            if matches:
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

    def build_probe_corpus(self, existing: dict[str, Any] | None, comments: list[Any] | None, run: dict[str, Any] | None = None) -> dict[str, Any]:
        existing = existing if isinstance(existing, dict) else {}
        run = run if isinstance(run, dict) else {}
        previous_comments = [
            comment for comment in existing.get("comments") or [] if isinstance(comment, dict) and self.is_analyzable_message(comment.get("message"))
        ]
        seen = {_clean_text(comment.get("message")) for comment in previous_comments if _clean_text(comment.get("message"))}
        next_comments = list(previous_comments)
        comments_added = 0

        for comment in comments if isinstance(comments, list) else []:
            if not isinstance(comment, dict):
                continue
            message = _clean_text(comment.get("message"))
            if not message or not self.is_analyzable_message(message) or message in seen:
                continue
            seen.add(message)
            comments_added += 1
            next_comments.append({"message": message, "source": _clean_text(comment.get("source")), "uid": _clean_text(comment.get("uid"))})

        at = _clean_text(run.get("at")) or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        return {
            "version": int(existing.get("version") or 1),
            "comments": next_comments,
            "runs": [
                *(existing.get("runs") if isinstance(existing.get("runs"), list) else []),
                {**run, "at": at, "commentsCollected": len(comments or []), "commentsAdded": comments_added},
            ],
            "updatedAt": at,
        }

    def is_analyzable_message(self, value: Any) -> bool:
        return _has_han(value)

    def _source_for_video(self, video: dict[str, Any], kind: str) -> str:
        prefix = f"Bilibili public direct {kind} probe"
        bvid = _clean_text(video.get("bvid"))
        aid = _clean_text(video.get("aid"))
        if bvid:
            return f"{prefix}: https://www.bilibili.com/video/{bvid}/"
        if aid:
            return f"{prefix}: https://www.bilibili.com/video/av{aid}/"
        return prefix
