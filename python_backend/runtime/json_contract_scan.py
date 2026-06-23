from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any, Iterable


DEFAULT_ALLOWED_PATHS = frozenset(
    {
        "python_backend/runtime/json_contracts.py",
        "python_backend/runtime/json_contract_scan.py",
    }
)
DEFAULT_EXCLUDED_PARTS = frozenset({"tests", "__pycache__"})
FORBIDDEN_PATTERNS = ("json.load(", "json.loads(")


class JsonContractScanSummary:
    """Summary builder for scattered JSON contract parser checks."""

    @staticmethod
    def build(file_count: int, violation_count: int) -> dict[str, Any]:
        return {
            "files": file_count,
            "violations": violation_count,
        }


class JsonContractScanner:
    """Detect direct production JSON parsing outside the shared contract reader."""

    def __init__(
        self,
        root: str | Path = ".",
        allowed_paths: Iterable[str] | None = None,
        excluded_parts: Iterable[str] | None = None,
    ) -> None:
        self.root = Path(root)
        self.allowed_paths = set(allowed_paths or DEFAULT_ALLOWED_PATHS)
        self.excluded_parts = set(excluded_parts or DEFAULT_EXCLUDED_PARTS)

    def scan(self, paths: Iterable[str | Path] | None = None) -> dict[str, Any]:
        files = list(self._iter_python_files(paths))
        violations = []
        for file_path in files:
            violations.extend(self._scan_file(file_path))
        return {
            "ok": not violations,
            "violations": violations,
            "summary": JsonContractScanSummary.build(len(files), len(violations)),
        }

    def _iter_python_files(self, paths: Iterable[str | Path] | None) -> Iterable[Path]:
        if paths is None:
            candidates = [self.root / "python_backend"]
        else:
            candidates = [self.root / path for path in paths]

        for candidate in candidates:
            if candidate.is_file() and candidate.suffix == ".py":
                if self._should_scan(candidate):
                    yield candidate
                continue
            if candidate.is_dir():
                for file_path in candidate.rglob("*.py"):
                    if self._should_scan(file_path):
                        yield file_path

    def _should_scan(self, path: Path) -> bool:
        relative_path = self._relative_name(path)
        if relative_path in self.allowed_paths:
            return False
        relative = Path(relative_path)
        return not any(part in self.excluded_parts for part in relative.parts)

    def _scan_file(self, path: Path) -> list[dict[str, Any]]:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

        violations = []
        for index, line in enumerate(lines, start=1):
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            for pattern in FORBIDDEN_PATTERNS:
                if pattern in line:
                    violations.append(
                        {
                            "path": self._relative_name(path),
                            "line": index,
                            "pattern": pattern,
                            "text": stripped[:200],
                        }
                    )
        return violations

    def _relative_name(self, path: Path) -> str:
        try:
            relative = path.resolve().relative_to(self.root.resolve())
        except ValueError:
            relative = path
        return relative.as_posix()


class JsonContractScanCommandRequest:
    """Parse CLI arguments and run the JSON contract scanner."""

    def __init__(self, argv: list[str] | None = None) -> None:
        self.args = self.parser().parse_args(argv)

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(
            description="Scan production Python backend files for scattered JSON contract parsing."
        )
        parser.add_argument("--root", default=".", help="Repository root to scan.")
        parser.add_argument(
            "--path",
            action="append",
            default=None,
            help="Relative file or directory to scan. Defaults to python_backend.",
        )
        return parser

    def run(self) -> dict[str, Any]:
        return JsonContractScanner(self.args.root).scan(self.args.path)


class JsonContractScanRunner(JsonContractScanCommandRequest):
    """Named runner for compatibility with the rest of the Python backend."""
