from __future__ import annotations

import argparse
import os
import re
from pathlib import Path
from typing import Any

from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader
from python_backend.corpus.local import LocalCorpusEvidenceFinder, LocalCorpusFlattener
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


DEFAULT_CORPUS_PATHS = [
    "server/data/uid-discovery-comments.json",
    "server/data/bilibiliDirectProbeCorpus.json",
    "server/data/tiebaKeywordCorpus.json",
    "server/data/huggingFaceKeywordCorpus.json",
]
DEFAULT_COVERAGE_ACTION_FILE_PATH = "server/data/coverage-actions.json"
DEFAULT_DICTIONARY_PATH = "server/data/deepseekKeywordDictionary.json"


class LocalCorpusMinePlanSummary:
    """Shape local corpus mining option plans into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("options",)

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


def parse_corpus_paths(value: Any) -> list[str]:
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def _js_number_or_default(value: Any, fallback: int) -> int:
    try:
        number = float(str(value))
    except (TypeError, ValueError):
        return fallback
    return int(number) if number else fallback


def _bounded(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    number = _js_number_or_default(value, fallback)
    return max(minimum, min(number, maximum))


class LocalCorpusMineOptionsPlanner:
    """Build mineLocalCorpusEvidence.js-compatible option contracts."""

    def build_plan(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None) -> dict[str, Any]:
        return {"ok": True, "options": self.build_options(argv=argv, env=env)}

    def build_options(self, argv: list[Any] | None = None, env: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        env = env or {}
        env_corpus_paths = parse_corpus_paths(env.get("LOCAL_BILIBILI_CORPUS_PATH"))
        options: dict[str, Any] = {
            "corpusPaths": env_corpus_paths if env_corpus_paths else list(DEFAULT_CORPUS_PATHS),
            "targetEvidence": _js_number_or_default(env.get("BILIBILI_COVERAGE_TARGET_EVIDENCE") or 3, 3),
            "maxSamplesPerTerm": _js_number_or_default(env.get("LOCAL_CORPUS_MAX_SAMPLES_PER_TERM") or 3, 3),
            "actionFile": env.get("LOCAL_CORPUS_ACTION_FILE") or DEFAULT_COVERAGE_ACTION_FILE_PATH,
            "requireCommentBackedEvidence": env.get("LOCAL_CORPUS_REQUIRE_COMMENT_BACKED") != "0",
            "write": env.get("LOCAL_CORPUS_WRITE") == "1",
        }
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--corpus="):
                options["corpusPaths"] = parse_corpus_paths(arg[len("--corpus=") :])
            elif arg.startswith("--actions="):
                options["actionFile"] = arg[len("--actions=") :].strip()
            elif arg.startswith("--target-evidence="):
                options["targetEvidence"] = _js_number_or_default(arg[len("--target-evidence=") :], 3)
            elif arg.startswith("--max-samples-per-term="):
                options["maxSamplesPerTerm"] = _js_number_or_default(arg[len("--max-samples-per-term=") :], 3)
            elif arg == "--no-comment-backed":
                options["requireCommentBackedEvidence"] = False
            elif arg == "--write":
                options["write"] = True
        options["targetEvidence"] = _bounded(options["targetEvidence"], 3, 1, 20)
        options["maxSamplesPerTerm"] = _bounded(options["maxSamplesPerTerm"], 3, 1, 20)
        return options


class LocalCorpusMinePlanRunner:
    """Read a JS-compatible local corpus mining payload and emit parsed options."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = LocalCorpusMineOptionsPlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return self.planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
        )

    def _read_payload(self) -> dict[str, Any]:
        return JsonContractReader().read_object(self.payload_path)


class LocalCorpusMinePlanContractComparator:
    """Compare Python local-corpus mine plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = LocalCorpusMinePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = LocalCorpusMinePlanRunner(self.payload_path).run()
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


class LocalCorpusMinePlanRequest:
    """Corpus-layer request for local corpus mining option-plan JSON commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return LocalCorpusMinePlanContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return LocalCorpusMinePlanRunner(self.payload_path).run()


class LocalCorpusMinePlanCommandRequest:
    """Parse CLI argv for local corpus mine plans while keeping ownership in corpus."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a mineLocalCorpusEvidence.js-compatible dry-run option plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local-corpus mine option report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return LocalCorpusMinePlanRequest(
            args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


class LocalCorpusMineRunner:
    """Mine merge-ready evidence from multiple local corpus contracts."""

    def __init__(
        self,
        *,
        dictionary_path: str | Path = DEFAULT_DICTIONARY_PATH,
        corpus_paths: list[str | Path] | None = None,
        action_file: str | Path = DEFAULT_COVERAGE_ACTION_FILE_PATH,
        target_evidence: int = 3,
        max_samples_per_term: int = 3,
        require_comment_backed_evidence: bool = True,
        write: bool = False,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.corpus_paths = [Path(path) for path in (corpus_paths or DEFAULT_CORPUS_PATHS)]
        self.action_file = Path(action_file)
        self.target_evidence = max(1, min(int(target_evidence or 3), 20))
        self.max_samples_per_term = max(1, min(int(max_samples_per_term or 3), 20))
        self.require_comment_backed_evidence = bool(require_comment_backed_evidence)
        self.write = bool(write)
        self.finder = LocalCorpusEvidenceFinder()
        self.flattener = LocalCorpusFlattener()
        self.reader = JsonContractReader()

    def run(self) -> dict[str, Any]:
        target_terms = self._target_terms()
        comments = self._comments()
        dictionary = self._dictionary()
        raw_entries = self.finder.find_entries(
            dictionary,
            comments,
            {
                "targetEvidence": self.target_evidence,
                "maxSamplesPerTerm": self.max_samples_per_term,
                "targetTerms": target_terms,
                "requireCommentBackedEvidence": self.require_comment_backed_evidence,
            },
        )
        entries = [entry for entry in raw_entries if self._mergeable(entry)]
        result = {
            "ok": not self.write,
            "dictionaryPath": str(self.dictionary_path),
            "corpusFiles": [str(path) for path in self.corpus_paths],
            "corpusComments": len(comments),
            "targetTerms": target_terms,
            "requireCommentBackedEvidence": self.require_comment_backed_evidence,
            "targetEvidence": self.target_evidence,
            "maxSamplesPerTerm": self.max_samples_per_term,
            "write": self.write,
            "entryCount": len(entries),
            "rawEntryCount": len(raw_entries),
            "filteredEntryCount": len(raw_entries) - len(entries),
            "entries": entries,
        }
        if self.write:
            result["error"] = "python_dictionary_merge_write_not_implemented"
        return result

    def _dictionary(self) -> dict[str, Any]:
        loaded = DictionaryLoader(self.dictionary_path).load()
        return {**loaded.manifest, "entries": loaded.entries}

    def _comments(self) -> list[dict[str, Any]]:
        comments: list[dict[str, Any]] = []
        for path in self.corpus_paths:
            payload = self._read_corpus_payload(path)
            comments.extend(self.flattener.flatten(payload))
        return comments

    def _read_corpus_payload(self, path: Path) -> Any:
        if path.suffix.lower() == ".txt":
            try:
                return path.read_text(encoding="utf-8-sig").splitlines()
            except OSError:
                return []
        loaded = CorpusLoader(path).load()
        if loaded.comments or loaded.runs or loaded.manifest.get("storage") == "split":
            return {**loaded.manifest, "comments": loaded.comments, "runs": loaded.runs}
        return self.reader.read_value(path, {})

    def _target_terms(self) -> list[str]:
        payload = self.reader.read_value(self.action_file, [])
        terms = []
        for action in payload if isinstance(payload, list) else []:
            if not isinstance(action, dict):
                continue
            term = str(action.get("term") or "").strip()
            if term and term not in terms:
                terms.append(term)
        return terms

    @staticmethod
    def _mergeable(entry: dict[str, Any]) -> bool:
        if not isinstance(entry, dict):
            return False
        return bool(entry.get("evidenceSources") or entry.get("evidenceSamples"))


class LocalCorpusMineCommandRequest:
    """Parse CLI/env inputs for the real local corpus evidence mining runtime."""

    VALUE_OPTIONS = {
        "--dictionary",
        "--corpus",
        "--actions",
        "--target-evidence",
        "--max-samples-per-term",
    }

    def __init__(self, argv: list[Any] | None = None, *, env: dict[str, Any] | None = None):
        self.argv = [str(item) for item in argv] if argv is not None else None
        self.env = dict(os.environ) if env is None else env

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Mine local Bilibili/Tieba corpus evidence using Python data loaders.")
        parser.add_argument("--dictionary", default=DEFAULT_DICTIONARY_PATH)
        parser.add_argument("--corpus", action="append", default=[])
        parser.add_argument("--actions", default="")
        parser.add_argument("--target-evidence", default="")
        parser.add_argument("--max-samples-per-term", default="")
        parser.add_argument("--no-comment-backed", action="store_true")
        parser.add_argument("--write", action="store_true")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args(self._normalize_argv(self.argv))
        options = LocalCorpusMineOptionsPlanner().build_options(
            argv=self._planner_argv(args),
            env=self.env,
        )
        return LocalCorpusMineRunner(
            dictionary_path=args.dictionary,
            corpus_paths=options["corpusPaths"],
            action_file=options["actionFile"],
            target_evidence=options["targetEvidence"],
            max_samples_per_term=options["maxSamplesPerTerm"],
            require_comment_backed_evidence=options["requireCommentBackedEvidence"],
            write=options["write"],
        ).run()

    def _planner_argv(self, args: argparse.Namespace) -> list[str]:
        argv = []
        if args.corpus:
            argv.append(f"--corpus={','.join(args.corpus)}")
        if args.actions:
            argv.append(f"--actions={args.actions}")
        if args.target_evidence:
            argv.append(f"--target-evidence={args.target_evidence}")
        if args.max_samples_per_term:
            argv.append(f"--max-samples-per-term={args.max_samples_per_term}")
        if args.no_comment_backed:
            argv.append("--no-comment-backed")
        if args.write:
            argv.append("--write")
        return argv

    def _normalize_argv(self, argv: list[str] | None) -> list[str] | None:
        if argv is None:
            return None
        normalized: list[str] = []
        index = 0
        while index < len(argv):
            arg = str(argv[index])
            if arg in self.VALUE_OPTIONS and index + 1 < len(argv):
                normalized.extend([arg, str(argv[index + 1])])
                index += 2
                continue
            normalized.append(arg)
            index += 1
        return normalized
