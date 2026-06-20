from __future__ import annotations

import csv
import json
import re
from dataclasses import dataclass
from io import StringIO
from pathlib import Path
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


class HuggingFaceImportSummary:
    """Shape local corpus import results into the JS comparator summary contract."""

    RESULT_KEYS = ("importedRows", "changed", "addedComments", "corpus")
    SUMMARY_KEYS = ("importedRows", "changed", "addedComments")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.SUMMARY_KEYS if key in result}


class HuggingFaceImportPlanSummary:
    """Shape HuggingFace/Kaggle fetch plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("outputPath", "requestTimeoutMs", "write", "sources", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class HuggingFaceImportPlanner:
    """Build a dry-run fetch plan compatible with importHuggingFaceCorpus.js."""

    DEFAULT_SOURCES = (
        {"dataset": "Orphanage/Baidu_Tieba_SunXiaochuan", "file": "train.jsonl", "platform": "tieba", "maxBytes": 750000, "limit": 250},
        {"dataset": "Orphanage/Baidu_Tieba_KangYaBeiGuo", "file": "data/tieba_post_detail_page_1~106/tieba_post_detail_page_1.json", "platform": "tieba", "maxBytes": 750000, "limit": 250},
        {"dataset": "Midsummra/bilibilicomment", "file": "bilibili.csv", "platform": "bilibili", "maxBytes": 5000000, "limit": 1000},
        {"dataset": "honeray/ai-music-comments-1.5M", "file": "final_data.csv", "platform": "bilibili", "maxBytes": 1000000, "limit": 250},
        {"dataset": "wencan2024/bilibili-masterpieces", "file": "bilibili-masterpieces-v0.jsonl", "platform": "bilibili", "maxBytes": 750000, "limit": 100},
        {"dataset": "JunyuLu/ToxiCN", "file": "ToxiCN_1.0.csv", "platform": "tieba", "maxBytes": 1000000, "limit": 250},
    )

    def __init__(self, *, default_output: str = "server/data/huggingFaceKeywordCorpus.json"):
        self.default_output = default_output

    def build_plan(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        env = env or {}
        output_path = _clean_text(env.get("HUGGINGFACE_CORPUS_PATH") or self.default_output)
        max_sources = self._number(env.get("HUGGINGFACE_MAX_SOURCES"), len(self.DEFAULT_SOURCES))
        request_timeout_ms = self._number(env.get("HUGGINGFACE_REQUEST_TIMEOUT_MS"), 30000)
        write = str(env.get("HUGGINGFACE_CORPUS_WRITE") or "") == "1"
        sources: list[dict[str, Any]] = []
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--output="):
                output_path = arg.split("=", 1)[1].strip()
            elif arg.startswith("--source="):
                sources.append(self._parse_source(arg.split("=", 1)[1]))
            elif arg.startswith("--max-sources="):
                max_sources = self._number(arg.split("=", 1)[1], max_sources)
            elif arg.startswith("--request-timeout-ms="):
                request_timeout_ms = self._number(arg.split("=", 1)[1], request_timeout_ms)
            elif arg == "--write":
                write = True
        selected = [source for source in (sources or list(self.DEFAULT_SOURCES)) if source.get("dataset") and source.get("file")]
        bounded_max_sources = max(1, min(max_sources or len(self.DEFAULT_SOURCES), 20))
        request_timeout_ms = max(1000, min(request_timeout_ms or 30000, 120000))
        planned_sources = [self._source_plan(source) for source in selected[:bounded_max_sources]]
        return {
            "ok": True,
            "outputPath": output_path,
            "write": write,
            "requestTimeoutMs": request_timeout_ms,
            "sources": planned_sources,
            "summary": {"sources": len(planned_sources), "maxSources": bounded_max_sources, "fetchAttempts": 3},
        }

    def _parse_source(self, value: Any) -> dict[str, Any]:
        parts = str(value or "").split("::")
        dataset = _clean_text(parts[0] if len(parts) > 0 else "")
        file = _clean_text(parts[1] if len(parts) > 1 else "")
        platform = _clean_text(parts[2] if len(parts) > 2 else "huggingface") or "huggingface"
        max_bytes = self._number(parts[3] if len(parts) > 3 else 750000, 750000)
        limit = self._number(parts[4] if len(parts) > 4 else 250, 250)
        offset = self._number(parts[5] if len(parts) > 5 else 0, 0)
        return {"dataset": dataset, "file": file, "platform": platform, "maxBytes": max_bytes, "limit": limit, "offset": offset}

    def _source_plan(self, source: dict[str, Any]) -> dict[str, Any]:
        max_bytes = max(1000, min(self._number(source.get("maxBytes"), 750000), 5000000))
        offset = self._number(source.get("offset"), 0)
        return {
            "dataset": _clean_text(source.get("dataset")),
            "file": _clean_text(source.get("file")),
            "platform": _clean_text(source.get("platform") or "huggingface"),
            "maxBytes": max_bytes,
            "limit": self._number(source.get("limit"), 250),
            "offset": max(0, offset),
            "resolveUrl": self._resolve_url(source),
            "rangeHeader": f"bytes=0-{max_bytes - 1}",
        }

    def _resolve_url(self, source: dict[str, Any]) -> str:
        encoded_file = "/".join(self._encode_segment(segment) for segment in str(source.get("file") or "").split("/"))
        return f"https://huggingface.co/datasets/{source.get('dataset')}/resolve/main/{encoded_file}"

    def _encode_segment(self, value: Any) -> str:
        from urllib.parse import quote

        return quote(str(value or ""), safe="")

    def _number(self, value: Any, fallback: int) -> int:
        try:
            return int(float(str(value)))
        except (TypeError, ValueError):
            return fallback


class HuggingFaceCorpusImportPlanContractComparator:
    """Compare Python HuggingFace import fetch plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = HuggingFaceImportPlanSummary()

    def compare(self) -> dict[str, Any]:
        payload = self._read_payload()
        planner = HuggingFaceImportPlanner(default_output=str(payload.get("defaultOutput") or "server/data/huggingFaceKeywordCorpus.json"))
        python_result = planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
        )
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

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("HuggingFace import plan payload must be a JSON object.")
        return payload

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
