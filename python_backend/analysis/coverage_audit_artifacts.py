from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


def _object_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str)]


def _artifact_result_or_none(result: dict[str, Any], key: str) -> Any:
    if key not in result:
        return None
    value = result.get(key)
    if key in ("recommendedQueries",):
        return [str(item) for item in value if isinstance(item, str)] if isinstance(value, list) else []
    if key in ("priorityActionItems",):
        return _object_list(value)
    return value if isinstance(value, str) else ""


class CoverageAuditArtifactPayloadContract:
    """Normalize coverage-audit artifact payloads from JS-compatible JSON."""

    def __init__(self, payload: dict[str, Any] | None = None):
        self.payload = payload if isinstance(payload, dict) else {}

    def audit(self) -> dict[str, Any]:
        audit = self.payload.get("audit")
        return audit if isinstance(audit, dict) else {}

    def query_file_path(self) -> str:
        return self._path_field("queryFilePath")

    def action_file_path(self) -> str:
        return self._path_field("actionFilePath")

    def _path_field(self, key: str) -> str:
        value = self.payload.get(key)
        return value.strip() if isinstance(value, str) else ""


class CoverageAuditArtifactContract:
    """Build coverage-audit artifact JSON from a normalized audit report."""

    def __init__(self, audit: dict[str, Any] | None = None):
        self.audit = audit if isinstance(audit, dict) else {}

    def build(self) -> dict[str, Any]:
        recommended_queries = self.recommended_queries()
        priority_items = self.priority_action_items()
        return {
            "ok": True,
            "recommendedQueries": recommended_queries,
            "recommendedQueryText": "".join(f"{query}\n" for query in recommended_queries),
            "priorityActionItems": priority_items,
            "priorityActionJson": self.ascii_json(priority_items) if priority_items else "",
        }

    def recommended_queries(self) -> list[str]:
        return [query.strip() for query in _string_list(self.audit.get("recommendedQueries")) if query.strip()]

    def priority_action_items(self) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        actions = self.audit.get("nextActions") if isinstance(self.audit, dict) else []
        for item in actions if isinstance(actions, list) else []:
            if not isinstance(item, dict):
                continue
            queries = [item.get("nextQuery")] if isinstance(item.get("nextQuery"), str) else []
            suggested = item.get("suggestedQueries")
            if isinstance(suggested, list):
                queries.extend(query for query in suggested if isinstance(query, str))
            for raw_query in queries:
                query = str(raw_query or "").strip()
                if not query:
                    continue
                normalized = dict(item)
                if isinstance(normalized.get("suggestedQueries"), list):
                    normalized["suggestedQueries"] = [suggestion for suggestion in normalized["suggestedQueries"] if isinstance(suggestion, str) and suggestion.strip()]
                normalized["query"] = query
                normalized["nextQuery"] = query
                result.append(normalized)
        return result

    def ascii_json(self, payload: Any) -> str:
        return f"{json.dumps(payload, ensure_ascii=True, indent=2)}\n"


class CoverageAuditArtifactWriter:
    """Serialize coverage-audit query and priority-action artifacts like the JS audit script."""

    def build_from_payload(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        contract = CoverageAuditArtifactPayloadContract(payload)
        audit = contract.audit()
        query_path = contract.query_file_path()
        action_path = contract.action_file_path()
        if query_path and action_path:
            return self.write(audit, query_path, action_path)
        return self.build_artifacts(audit)

    def build_artifacts(self, audit: dict[str, Any]) -> dict[str, Any]:
        return CoverageAuditArtifactContract(audit).build()

    def write(self, audit: dict[str, Any], query_file_path: str | Path, action_file_path: str | Path) -> dict[str, Any]:
        artifacts = self.build_artifacts(audit)
        query_path = Path(query_file_path)
        action_path = Path(action_file_path)
        if artifacts["recommendedQueries"]:
            query_path.parent.mkdir(parents=True, exist_ok=True)
            query_path.write_text(artifacts["recommendedQueryText"], encoding="utf-8")
        if artifacts["priorityActionItems"]:
            action_path.parent.mkdir(parents=True, exist_ok=True)
            action_path.write_text(artifacts["priorityActionJson"], encoding="utf-8")
        return {
            **artifacts,
            "queryFilePath": str(query_path),
            "actionFilePath": str(action_path),
        }

    def priority_action_items_from_audit(self, audit: dict[str, Any]) -> list[dict[str, Any]]:
        return CoverageAuditArtifactContract(audit).priority_action_items()

    def ascii_json(self, payload: Any) -> str:
        return CoverageAuditArtifactContract({}).ascii_json(payload)


class CoverageAuditArtifactsSummary:
    """Shape coverage-audit artifact results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("recommendedQueries", "recommendedQueryText", "priorityActionItems", "priorityActionJson")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: _artifact_result_or_none(result, key) for key in self.RESULT_KEYS if key in result}


class CoverageAuditArtifactsContractComparator:
    """Compare coverage-audit artifact payloads using the JS/Python summary contract."""

    def __init__(self, summary: CoverageAuditArtifactsSummary | None = None):
        self.summary = summary or CoverageAuditArtifactsSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }


class CoverageAuditArtifactsRunner:
    """Build or write coverage-audit query/action artifacts from a JSON compatibility payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return CoverageAuditArtifactWriter().build_from_payload(payload)

    def _read_payload(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


class CoverageAuditArtifactsPayloadContractComparator:
    """Compare Python coverage-audit artifacts against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = CoverageAuditArtifactsSummary()
        self.comparator = CoverageAuditArtifactsContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = CoverageAuditArtifactsRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class CoverageAuditArtifactsRequest:
    """Analysis-layer request for coverage-audit artifact JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return CoverageAuditArtifactsPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return CoverageAuditArtifactsRunner(self.payload_path).run()


class CoverageAuditArtifactsCommandRequest:
    """Analysis-layer command request for coverage-audit artifact JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return CoverageAuditArtifactsRequest(
            args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build coverage-audit query/action artifacts from a JSON payload.")
        parser.add_argument("--payload", required=True, help="Path to coverage-audit artifact payload JSON.")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible artifact report to compare.")
        return parser
