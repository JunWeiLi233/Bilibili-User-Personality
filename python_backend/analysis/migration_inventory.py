from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BACKEND_CATEGORY_PREFIXES = {
    "scripts": "server/scripts/",
    "services": "server/services/",
    "routes": "server/routes/",
    "utils": "server/utils/",
}

DEFAULT_PACKAGE_COMMAND_EQUIVALENTS = {
    "video:keywords": "python:harvest-plan",
    "dictionary:harvest": "python:harvest-plan",
    "dictionary:coverage": "python:coverage-standalone",
    "dictionary:prune": "python:dictionary-prune-summary",
    "dictionary:prune-exhausted": "python:exhausted-prune-plan",
    "dictionary:resolve-near": "python:near-target-plan",
    "dictionary:auto": "python:coverage-loop-plan",
    "dictionary:tieba": "python:tieba-keyword-plan",
    "dictionary:huggingface": "python:huggingface-import",
    "dictionary:mine-local": "python:local-mine-plan",
    "dictionary:probe-bilibili": "python:direct-probe-plan",
    "dictionary:history-tags": "python:history-tags",
    "deepseek:analyze": "python:deepseek-cli-plan",
    "aicu:scrape": "python:aicu-plan",
    "aicu:batch": "python:aicu-batch-plan",
    "stats:update": "python:readme-stats",
}

DEFAULT_RETAINED_NODE_COMMANDS = {
    "server": "app_api_orchestration",
    "dev:full": "app_api_orchestration",
    "aicu:test": "external_api_smoke_test",
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
        package_scripts = PackageCommandMigrationInventory.from_root(root).scan()
        return {
            "ok": True,
            "root": str(root),
            "remainingJsBackendFiles": sum(categories.values()),
            "backendJsTests": len(backend_tests),
            "categories": categories,
            "files": backend_files,
            "testFiles": backend_tests,
            "packageScripts": package_scripts,
        }

    @staticmethod
    def _category(relative_path: str) -> str:
        if relative_path == "server/index.js":
            return "root"
        for category, prefix in BACKEND_CATEGORY_PREFIXES.items():
            if relative_path.startswith(prefix):
                return category
        return ""


class PackageCommandMigrationInventory:
    """Map node-backed package commands to available Python compatibility commands."""

    def __init__(
        self,
        package: dict[str, Any] | None = None,
        equivalents: dict[str, str] | None = None,
        retained_commands: dict[str, str] | None = None,
    ):
        self.package = package if isinstance(package, dict) else {}
        self.equivalents = equivalents or DEFAULT_PACKAGE_COMMAND_EQUIVALENTS
        self.retained_commands = retained_commands or DEFAULT_RETAINED_NODE_COMMANDS

    @classmethod
    def from_root(cls, root: str | Path = ".") -> "PackageCommandMigrationInventory":
        package_path = Path(root) / "package.json"
        if not package_path.exists():
            return cls({})
        try:
            payload = json.loads(package_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            payload = {}
        return cls(payload)

    def scan(self) -> dict[str, Any]:
        scripts = self.package.get("scripts")
        scripts = scripts if isinstance(scripts, dict) else {}
        node_scripts = self._node_server_scripts(scripts)
        python_scripts = self._python_backend_scripts(scripts)
        python_backed: list[dict[str, str]] = []
        retained: list[dict[str, str]] = []
        replacement_needed: list[dict[str, str]] = []

        for name, command in node_scripts.items():
            python_name = self.equivalents.get(name)
            python_command = python_scripts.get(python_name or "")
            if python_name and python_command:
                python_backed.append(
                    {
                        "script": name,
                        "command": command,
                        "pythonScript": python_name,
                        "pythonCommand": python_command,
                    }
                )
            elif name in self.retained_commands:
                retained.append({"script": name, "command": command, "reason": self.retained_commands[name]})
            else:
                replacement_needed.append({"script": name, "command": command})

        return {
            "nodeServerScripts": len(node_scripts),
            "pythonBackendScripts": len(python_scripts),
            "pythonBackedNodeScripts": python_backed,
            "retainedNodeScripts": retained,
            "replacementNeeded": replacement_needed,
        }

    @staticmethod
    def _node_server_scripts(scripts: dict[str, Any]) -> dict[str, str]:
        return {
            str(name): str(command)
            for name, command in scripts.items()
            if isinstance(command, str) and "node server/" in command
        }

    @staticmethod
    def _python_backend_scripts(scripts: dict[str, Any]) -> dict[str, str]:
        return {
            str(name): str(command)
            for name, command in scripts.items()
            if isinstance(command, str) and "python -m python_backend.cli." in command
        }


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
