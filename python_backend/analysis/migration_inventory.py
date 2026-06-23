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
    "dictionary:mine-local": "python:local-mine",
    "dictionary:probe-bilibili": "python:direct-probe-plan",
    "dictionary:history-tags": "python:history-tags",
    "deepseek:analyze": "python:deepseek-cli-plan",
    "aicu:scrape": "python:aicu-plan",
    "aicu:batch": "python:aicu-batch-plan",
    "stats:update": "python:readme-stats",
}

DEFAULT_PACKAGE_VALIDATION_EQUIVALENTS = {
    "deepseek:analyze": "python:deepseek-mock-runtime-compare",
    "dictionary:huggingface": "python:huggingface-compare",
}

DEFAULT_PACKAGE_VALIDATION_SCOPES = {
    "python:deepseek-cli-compare": "dry_run_plan",
    "python:deepseek-validation-compare": "analysis_validation",
    "python:deepseek-normalization-compare": "analysis_normalization",
    "python:deepseek-analyze-fixture-compare": "full_command_fixture",
    "python:deepseek-mock-runtime-compare": "mocked_runtime",
    "python:huggingface-compare": "full_command",
}

DEFAULT_PACKAGE_REPLACEMENT_SCOPES = {
    "dictionary:prune": "summary_only",
    "dictionary:prune-exhausted": "dry_run_plan",
    "dictionary:resolve-near": "dry_run_plan",
    "dictionary:auto": "dry_run_plan",
    "dictionary:tieba": "dry_run_plan",
    "dictionary:mine-local": "no_write_runtime",
    "dictionary:probe-bilibili": "dry_run_plan",
    "deepseek:analyze": "mocked_runtime",
    "aicu:scrape": "dry_run_plan",
    "aicu:batch": "dry_run_plan",
}

DEFAULT_RETAINED_NODE_COMMANDS = {
    "server": "app_api_orchestration",
    "dev:full": "app_api_orchestration",
    "aicu:test": "external_api_smoke_test",
}

DEFAULT_BRIDGE_NODE_COMMANDS = {
    "python:deepseek-cli-compare": "js_python_contract_bridge",
    "python:deepseek-cli-plan-js": "js_python_contract_bridge",
    "python:deepseek-validation-compare": "js_python_contract_bridge",
    "python:deepseek-normalization-compare": "js_python_contract_bridge",
    "python:deepseek-analyze-fixture-compare": "js_python_contract_bridge",
    "python:deepseek-mock-runtime-compare": "js_python_contract_bridge",
}

RETAINED_JS_FILE_PREFIXES = {
    "server/routes/": "app_api_orchestration",
}

RETAINED_JS_FILES = {
    "server/index.js": "app_api_orchestration",
    "server/utils/paths.js": "shared_runtime_support",
    "server/utils/fileLock.js": "shared_runtime_support",
    "server/scripts/compareDeepSeekAnalyzePlan.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalysisValidation.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalysisNormalization.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalyzeFixture.js": "js_python_contract_bridge",
    "server/scripts/compareDeepSeekAnalyzeMockRuntime.js": "js_python_contract_bridge",
}

MIGRATION_PRIORITY_RULES = (
    ("corpus_analysis_pipeline", 10, ("Corpus", "Dictionary", "Coverage", "DeepSeek", "Semantic", "Evidence", "Stats", "HuggingFace", "Tieba", "HistoryTags", "Readme")),
    ("scraper_pipeline", 20, ("Scrape", "Scraper", "Crawler", "Probe", "Uid", "Video", "Aicu", "Bilibili")),
    ("runtime_support", 30, ("Options", "Progress", "Report", "Monitor", "Lock")),
)


@dataclass(frozen=True)
class BackendMigrationInventoryScanner:
    """Count remaining JS backend files that still need Python migration coverage."""

    root: str | Path = "."

    def scan(self) -> dict[str, Any]:
        root = Path(self.root)
        package_inventory = PackageCommandMigrationInventory.from_root(root)
        package_scripts_raw = package_inventory.package.get("scripts") if isinstance(package_inventory.package.get("scripts"), dict) else {}
        backend_files: dict[str, list[str]] = {key: [] for key in (*BACKEND_CATEGORY_PREFIXES.keys(), "root")}
        migration_candidate_files: dict[str, list[str]] = {key: [] for key in (*BACKEND_CATEGORY_PREFIXES.keys(), "root")}
        retained_files: list[dict[str, str]] = []
        backend_tests: list[str] = []

        for path in sorted((root / "server").rglob("*.js")) if (root / "server").exists() else []:
            relative = path.relative_to(root).as_posix()
            if relative.endswith(".test.js"):
                backend_tests.append(relative)
                continue
            category = self._category(relative)
            if category:
                backend_files[category].append(relative)
                retained_reason = self._retained_reason(relative, package_scripts_raw)
                if retained_reason:
                    retained_files.append({"path": relative, "reason": retained_reason})
                else:
                    migration_candidate_files[category].append(relative)

        categories = {key: len(value) for key, value in backend_files.items()}
        migration_candidate_categories = {key: len(value) for key, value in migration_candidate_files.items()}
        migration_priority_files = self._priority_files(migration_candidate_files)
        package_scripts = package_inventory.scan()
        next_migration_action = self._next_migration_action(migration_priority_files, package_scripts)
        return {
            "ok": True,
            "root": str(root),
            "remainingJsBackendFiles": sum(categories.values()),
            "migrationCandidateJsBackendFiles": sum(migration_candidate_categories.values()),
            "backendJsTests": len(backend_tests),
            "categories": categories,
            "files": backend_files,
            "migrationCandidateCategories": migration_candidate_categories,
            "migrationCandidateFiles": migration_candidate_files,
            "migrationPriorityFiles": migration_priority_files,
            "nextMigrationAction": next_migration_action,
            "retainedJsBackendFiles": retained_files,
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

    @staticmethod
    def _retained_reason(relative_path: str, package_scripts: dict[str, Any] | None = None) -> str:
        package_scripts = package_scripts if isinstance(package_scripts, dict) else {}
        if (
            relative_path == "server/scripts/importHuggingFaceCorpus.js"
            and package_scripts.get("dictionary:huggingface") == "python -m python_backend.cli.huggingface_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/updateReadmeStatsGraph.js"
            and package_scripts.get("stats:update") == "python -m python_backend.cli.readme_stats"
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/runDictionaryCoverageAudit.js"
            and str(package_scripts.get("dictionary:coverage") or "").startswith("python -m python_backend.cli.coverage_audit --standalone")
        ):
            return "legacy_compatibility_after_python_replacement"
        if (
            relative_path == "server/scripts/scrapeBilibiliHistoryTags.js"
            and package_scripts.get("dictionary:history-tags") == "python -m python_backend.cli.history_tag_corpus"
        ):
            return "legacy_compatibility_after_python_replacement"
        if relative_path in RETAINED_JS_FILES:
            return RETAINED_JS_FILES[relative_path]
        for prefix, reason in RETAINED_JS_FILE_PREFIXES.items():
            if relative_path.startswith(prefix):
                return reason
        return ""

    @classmethod
    def _priority_files(cls, migration_candidate_files: dict[str, list[str]]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for category, paths in migration_candidate_files.items():
            for path in paths:
                group, priority = cls._priority_for(path)
                items.append({"path": path, "category": category, "priority": priority, "group": group})
        return sorted(items, key=lambda item: (item["priority"], item["category"], item["path"]))

    @staticmethod
    def _priority_for(relative_path: str) -> tuple[str, int]:
        stem = Path(relative_path).stem
        compact = stem[:1].upper() + stem[1:]
        for group, priority, needles in MIGRATION_PRIORITY_RULES:
            if any(needle in compact for needle in needles):
                return group, priority
        return "uncategorized_pipeline", 40

    @staticmethod
    def _next_migration_action(priority_files: list[dict[str, Any]], package_scripts: dict[str, Any]) -> dict[str, Any]:
        if not priority_files:
            return {}
        first = dict(priority_files[0])
        for mapping in package_scripts.get("pythonBackedNodeScripts", []):
            if not isinstance(mapping, dict):
                continue
            command = str(mapping.get("command") or "")
            if first["path"] in command:
                validation_script = str(mapping.get("validationScript") or "")
                validation_command = str(mapping.get("validationCommand") or "")
                validation_scope = str(mapping.get("validationScope") or "")
                ready_to_replace = bool(validation_script and validation_command and validation_scope == "full_command")
                return {
                    **first,
                    "nodeScript": str(mapping.get("script") or ""),
                    "nodeCommand": command,
                    "pythonScript": str(mapping.get("pythonScript") or ""),
                    "pythonCommand": str(mapping.get("pythonCommand") or ""),
                    "validationScript": validation_script,
                    "validationCommand": validation_command,
                    "validationScope": validation_scope,
                    "readyToReplace": ready_to_replace,
                    "recommendation": "compare_python_contract_before_replacing_js" if ready_to_replace else "expand_python_runtime_contract_before_replacing_js",
                }
        return {
            **first,
            "nodeScript": "",
            "nodeCommand": "",
            "pythonScript": "",
            "pythonCommand": "",
            "validationScript": "",
            "validationCommand": "",
            "validationScope": "",
            "readyToReplace": False,
            "recommendation": "create_python_contract_then_compare_js",
        }


class PackageCommandMigrationInventory:
    """Map node-backed package commands to available Python compatibility commands."""

    def __init__(
        self,
        package: dict[str, Any] | None = None,
        equivalents: dict[str, str] | None = None,
        validation_equivalents: dict[str, str] | None = None,
        validation_scopes: dict[str, str] | None = None,
        replacement_scopes: dict[str, str] | None = None,
        retained_commands: dict[str, str] | None = None,
        bridge_commands: dict[str, str] | None = None,
    ):
        self.package = package if isinstance(package, dict) else {}
        self.equivalents = equivalents or DEFAULT_PACKAGE_COMMAND_EQUIVALENTS
        self.validation_equivalents = validation_equivalents or DEFAULT_PACKAGE_VALIDATION_EQUIVALENTS
        self.validation_scopes = validation_scopes or DEFAULT_PACKAGE_VALIDATION_SCOPES
        self.replacement_scopes = replacement_scopes or DEFAULT_PACKAGE_REPLACEMENT_SCOPES
        self.retained_commands = retained_commands or DEFAULT_RETAINED_NODE_COMMANDS
        self.bridge_commands = bridge_commands or DEFAULT_BRIDGE_NODE_COMMANDS

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
        bridge: list[dict[str, str]] = []
        replacement_needed: list[dict[str, str]] = []
        linked_bridge_scripts = self._linked_bridge_scripts(node_scripts, python_scripts)

        for name, command in node_scripts.items():
            python_name = self.equivalents.get(name)
            python_command = python_scripts.get(python_name or "")
            if python_name and python_command:
                mapping = {
                    "script": name,
                    "command": command,
                    "pythonScript": python_name,
                    "pythonCommand": python_command,
                }
                replacement_scope = self.replacement_scopes.get(name)
                if replacement_scope:
                    mapping["replacementScope"] = replacement_scope
                    mapping["readyToReplace"] = False
                validation_name = self.validation_equivalents.get(name)
                validation_command = node_scripts.get(validation_name or "")
                if validation_name and validation_command:
                    mapping["validationScript"] = validation_name
                    mapping["validationCommand"] = validation_command
                    mapping["validationScope"] = self.validation_scopes.get(validation_name, "full_command")
                python_backed.append(mapping)
            elif name in linked_bridge_scripts:
                continue
            elif name in self.retained_commands:
                retained.append({"script": name, "command": command, "reason": self.retained_commands[name]})
            elif name in self.bridge_commands:
                bridge.append({"script": name, "command": command, "reason": self.bridge_commands[name]})
            else:
                replacement_needed.append({"script": name, "command": command})

        return {
            "nodeServerScripts": len(node_scripts),
            "pythonBackendScripts": len(python_scripts),
            "pythonBackedNodeScripts": python_backed,
            "retainedNodeScripts": retained,
            "bridgeNodeScripts": bridge,
            "replacementNeeded": replacement_needed,
        }

    def _linked_bridge_scripts(self, node_scripts: dict[str, str], python_scripts: dict[str, str]) -> set[str]:
        linked: set[str] = set()
        for name in node_scripts:
            python_name = self.equivalents.get(name)
            validation_name = self.validation_equivalents.get(name)
            if python_name and python_scripts.get(python_name) and validation_name and node_scripts.get(validation_name):
                linked.add(validation_name)
        return linked

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
