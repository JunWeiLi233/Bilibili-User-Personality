from __future__ import annotations

from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonResultBytesContract


class RandomVerificationJsonResultContract(JsonResultBytesContract):
    """Serialize random-verification JSON output exactly as the CLI expects."""


def json_result_bytes(result: dict[str, Any]) -> bytes:
    return RandomVerificationJsonResultContract(result).to_bytes()


class RandomVerificationOutputWriter:
    """Persist random-verification JSON output using the shared CLI result contract."""

    def __init__(self, output_path: str | Path):
        self.output_path = Path(output_path)

    def write(self, report: dict[str, Any]) -> dict[str, Any]:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_bytes(RandomVerificationJsonResultContract(report).to_bytes())
        return report
