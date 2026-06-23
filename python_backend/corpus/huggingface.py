from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from typing import Any

from python_backend.corpus.loader import CorpusLoader
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


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
        parsed = JsonContractReader().read_text_value(raw, None)
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
        return self._split_jsonl(raw)

    def _split_jsonl(self, raw: str) -> list[dict[str, Any]]:
        rows = []
        reader = JsonContractReader()
        for line in str(raw or "").splitlines():
            line = line.strip()
            if not line:
                continue
            parsed = reader.read_text_value(line, None)
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


class HuggingFaceCorpusImportPlanRunner:
    """Read a JS-compatible HuggingFace import option payload and emit a fetch plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        planner = HuggingFaceImportPlanner(default_output=str(payload.get("defaultOutput") or "server/data/huggingFaceKeywordCorpus.json"))
        return planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
        )

    def _read_payload(self) -> dict[str, Any]:
        payload = self.reader.read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class HuggingFaceCorpusImportPlanContractComparator:
    """Compare Python HuggingFace import fetch plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = HuggingFaceImportPlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = HuggingFaceCorpusImportPlanRunner(self.payload_path).run()
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


class HuggingFaceCorpusImportRunner:
    """Run a local HuggingFace/Kaggle corpus import against JSON contracts."""

    def __init__(
        self,
        raw_path: str | Path,
        existing_path: str | Path,
        dataset: str,
        file: str,
        platform: str,
        limit: int = 500,
        offset: int = 0,
        generated_at: str | None = None,
    ):
        self.raw_path = Path(raw_path)
        self.existing_path = Path(existing_path)
        self.dataset = dataset
        self.file = file
        self.platform = platform
        self.limit = limit
        self.offset = offset
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.importer = HuggingFaceCorpusImporter()

    def run(self) -> dict[str, Any]:
        raw = self.raw_path.read_text(encoding="utf-8-sig")
        existing = self._read_existing()
        source = {
            "dataset": self.dataset,
            "file": self.file,
            "platform": self.platform,
            "limit": self.limit,
            "offset": self.offset,
        }
        rows = self.importer.parse_rows(raw, source)
        run = {
            "at": self.generated_at,
            "sources": [source],
            "results": [{**source, "ok": True, "rows": len(rows)}],
        }
        update = self.importer.build_update(existing, rows, run, self.generated_at)
        return {
            "ok": True,
            "importedRows": len(rows),
            **update,
        }

    def _read_existing(self) -> dict[str, Any]:
        loaded = CorpusLoader(self.existing_path, fallback={"version": 1, "updatedAt": None, "runs": [], "comments": []}).load()
        return {**loaded.manifest, "comments": loaded.comments, "runs": loaded.runs}


class HuggingFaceCorpusImportContractComparator:
    """Compare Python HuggingFace/Kaggle corpus imports against saved JS-compatible JSON."""

    def __init__(
        self,
        raw_path: str | Path,
        existing_path: str | Path,
        dataset: str,
        file: str,
        platform: str,
        js_report_path: str | Path,
        limit: int = 500,
        offset: int = 0,
        generated_at: str | None = None,
    ):
        self.raw_path = Path(raw_path)
        self.existing_path = Path(existing_path)
        self.dataset = dataset
        self.file = file
        self.platform = platform
        self.js_report_path = Path(js_report_path)
        self.limit = limit
        self.offset = offset
        self.generated_at = generated_at
        self.summary = HuggingFaceImportSummary()

    def compare(self) -> dict[str, Any]:
        python_result = HuggingFaceCorpusImportRunner(
            raw_path=self.raw_path,
            existing_path=self.existing_path,
            dataset=self.dataset,
            file=self.file,
            platform=self.platform,
            limit=self.limit,
            offset=self.offset,
            generated_at=self.generated_at,
        ).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {"summary": self.summary.summarize(python_result)},
            "js": {"summary": self.summary.summarize(js_result)},
        }

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class HuggingFaceCorpusImportRequest:
    """Corpus-layer request for HuggingFace/Kaggle import plan and local import JSON contracts."""

    def __init__(
        self,
        *,
        plan_payload_path: str | Path | None = None,
        raw_path: str | Path | None = None,
        existing_path: str | Path = "server/data/huggingFaceKeywordCorpus.json",
        dataset: str = "",
        file: str = "",
        platform: str = "huggingface",
        limit: int = 500,
        offset: int = 0,
        generated_at: str | None = None,
        compare_js_report_path: str | Path | None = None,
    ):
        self.plan_payload_path = Path(plan_payload_path) if plan_payload_path else None
        self.raw_path = Path(raw_path) if raw_path else None
        self.existing_path = Path(existing_path)
        self.dataset = dataset
        self.file = file
        self.platform = platform
        self.limit = limit
        self.offset = offset
        self.generated_at = generated_at
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.plan_payload_path and self.compare_js_report_path:
            return HuggingFaceCorpusImportPlanContractComparator(self.plan_payload_path, self.compare_js_report_path).compare()
        if self.plan_payload_path:
            return HuggingFaceCorpusImportPlanRunner(self.plan_payload_path).run()
        if not self.raw_path or not self.dataset or not self.file:
            raise ValueError("raw_path, dataset, and file are required unless plan_payload_path is provided")
        options = {
            "raw_path": self.raw_path,
            "existing_path": self.existing_path,
            "dataset": self.dataset,
            "file": self.file,
            "platform": self.platform,
            "limit": self.limit,
            "offset": self.offset,
            "generated_at": self.generated_at,
        }
        if self.compare_js_report_path:
            return HuggingFaceCorpusImportContractComparator(
                **options,
                js_report_path=self.compare_js_report_path,
            ).compare()
        return HuggingFaceCorpusImportRunner(**options).run()


class HuggingFaceCorpusImportCommandRequest:
    """Argv-backed corpus-layer request for HuggingFace/Kaggle corpus imports."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Parse a local HuggingFace/Kaggle corpus file into the JS-compatible corpus contract.")
        parser.add_argument("--plan-payload", default="", help="Path to a JS-compatible import option payload for dry-run fetch planning.")
        parser.add_argument("--raw", default="", help="Path to downloaded JSON/JSONL/CSV source rows.")
        parser.add_argument("--existing", default="server/data/huggingFaceKeywordCorpus.json", help="Existing corpus JSON manifest.")
        parser.add_argument("--dataset", default="")
        parser.add_argument("--file", default="")
        parser.add_argument("--platform", default="huggingface")
        parser.add_argument("--limit", type=int, default=500)
        parser.add_argument("--offset", type=int, default=0)
        parser.add_argument("--generated-at", default="")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible HuggingFace/Kaggle import report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        parser = self.parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if not args.raw or not args.dataset or not args.file:
            if not args.plan_payload:
                parser.error("--raw, --dataset, and --file are required unless --plan-payload is provided.")
        return HuggingFaceCorpusImportRequest(
            plan_payload_path=args.plan_payload or None,
            raw_path=args.raw,
            existing_path=args.existing,
            dataset=args.dataset,
            file=args.file,
            platform=args.platform,
            limit=args.limit,
            offset=args.offset,
            generated_at=args.generated_at or None,
            compare_js_report_path=args.compare_js_report or None,
        ).run()
