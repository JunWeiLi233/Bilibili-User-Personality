from __future__ import annotations

from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonResultBytesContract


class CoverageAuditJsonResultContract(JsonResultBytesContract):
    """Serialize coverage-audit JSON output exactly as the CLI expects."""


class CoverageAuditArtifactsJsonResultContract(CoverageAuditJsonResultContract):
    """Serialize coverage-audit artifact JSON output exactly as the CLI expects."""


class CoverageAuditOutputWriter:
    """Persist coverage-audit JSON output using the shared CLI result contract."""

    def __init__(self, output_path: str | Path):
        self.output_path = Path(output_path)

    def write(self, audit: dict[str, Any]) -> dict[str, Any]:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_bytes(CoverageAuditJsonResultContract(audit).to_bytes())
        return audit


class CoverageAuditReportArtifactsWriter:
    """Persist a coverage-audit report plus JS-compatible query/action sidecars."""

    def __init__(self, report_path: str | Path | None = None, query_file_path: str | Path | None = None, action_file_path: str | Path | None = None):
        self.report_path = Path(report_path) if report_path is not None and str(report_path).strip() else None
        self.query_file_path = Path(query_file_path) if query_file_path is not None and str(query_file_path).strip() else None
        self.action_file_path = Path(action_file_path) if action_file_path is not None and str(action_file_path).strip() else None

    def write(self, audit: dict[str, Any]) -> dict[str, Any]:
        if self.report_path is not None:
            CoverageAuditOutputWriter(self.report_path).write(audit)
        if self.query_file_path is not None and self.action_file_path is not None:
            from python_backend.analysis.audit import CoverageAuditArtifactWriter
            CoverageAuditArtifactWriter().write(audit, self.query_file_path, self.action_file_path)
        return audit
