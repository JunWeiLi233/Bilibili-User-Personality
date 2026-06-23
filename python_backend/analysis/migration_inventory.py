from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BACKEND_CATEGORY_PREFIXES = {
    "scripts": "server/scripts/",
    "services": "server/services/",
    "routes": "server/routes/",
    "utils": "server/utils/",
}


@dataclass(frozen=True)
class BackendMigrationInventoryScanner:
    """Count remaining JS backend files that still need Python migration coverage."""

    root: str | Path = "."

    def scan(self) -> dict[str, Any]:
        root = Path(self.root)
        backend_files: dict[str, list[str]] = {key: [] for key in (*BACKEND_CATEGORY_PREFIXES.keys(), "root")}
        backend_tests: list[str] = []

        for path in sorted((root / "server").rglob("*.js")) if (root / "server").exists() else []:
            relative = path.relative_to(root).as_posix()
            if relative.endswith(".test.js"):
                backend_tests.append(relative)
                continue
            category = self._category(relative)
            if category:
                backend_files[category].append(relative)

        categories = {key: len(value) for key, value in backend_files.items()}
        return {
            "ok": True,
            "root": str(root),
            "remainingJsBackendFiles": sum(categories.values()),
            "backendJsTests": len(backend_tests),
            "categories": categories,
            "files": backend_files,
            "testFiles": backend_tests,
        }

    @staticmethod
    def _category(relative_path: str) -> str:
        if relative_path == "server/index.js":
            return "root"
        for category, prefix in BACKEND_CATEGORY_PREFIXES.items():
            if relative_path.startswith(prefix):
                return category
        return ""


@dataclass(frozen=True)
class BackendMigrationInventoryRequest:
    """Run a backend migration inventory request from normalized inputs."""

    root: str | Path = "."

    def run(self) -> dict[str, Any]:
        return BackendMigrationInventoryScanner(self.root).scan()


class BackendMigrationInventoryCommandRequest:
    """Own argv parsing for backend migration inventory JSON contracts."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return BackendMigrationInventoryRequest(root=args.root).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Report remaining JS backend files for Python migration planning.")
        parser.add_argument("--root", default=".")
        return parser


class BackendMigrationInventoryRunner(BackendMigrationInventoryCommandRequest):
    """Analysis-layer runner for backend migration inventory requests."""
