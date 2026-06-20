from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.near_target import NearTargetResolvePlanner, NearTargetResolvePlanSummary
from python_backend.corpus.dictionary import DictionaryLoader


class NearTargetResolvePlanRunner:
    """Build a dry-run plan for resolving near-target dictionary terms from known source videos."""

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        *,
        target_evidence: int = 3,
        max_need: int = 1,
        batch: int = 12,
        videos_per_term: int = 3,
        pages: int = 3,
        override_terms: list[str] | None = None,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.target_evidence = max(1, int(target_evidence))
        self.max_need = max(1, int(max_need))
        self.batch = max(1, int(batch))
        self.videos_per_term = max(1, int(videos_per_term))
        self.pages = max(1, int(pages))
        self.override_terms = [str(term).strip() for term in override_terms or [] if str(term).strip()]

    def run(self) -> dict[str, Any]:
        loaded_dictionary = DictionaryLoader(self.dictionary_path).load()
        dictionary = {**loaded_dictionary.manifest, "entries": loaded_dictionary.entries}
        return NearTargetResolvePlanner(
            target_evidence=self.target_evidence,
            max_need=self.max_need,
            batch=self.batch,
            videos_per_term=self.videos_per_term,
            pages=self.pages,
            override_terms=self.override_terms,
        ).build_plan(dictionary)


class NearTargetResolvePlanContractComparator:
    """Compare Python near-target resolve plans against saved JS-compatible JSON."""

    def __init__(
        self,
        dictionary_path: str | Path,
        state_path: str | Path,
        js_plan_path: str | Path,
        *,
        target_evidence: int = 3,
        max_need: int = 1,
        batch: int = 12,
        videos_per_term: int = 3,
        pages: int = 3,
        override_terms: list[str] | None = None,
    ):
        self.dictionary_path = Path(dictionary_path)
        self.state_path = Path(state_path)
        self.js_plan_path = Path(js_plan_path)
        self.target_evidence = target_evidence
        self.max_need = max_need
        self.batch = batch
        self.videos_per_term = videos_per_term
        self.pages = pages
        self.override_terms = override_terms or []
        self.summary = NearTargetResolvePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = NearTargetResolvePlanRunner(
            self.dictionary_path,
            self.state_path,
            target_evidence=self.target_evidence,
            max_need=self.max_need,
            batch=self.batch,
            videos_per_term=self.videos_per_term,
            pages=self.pages,
            override_terms=self.override_terms,
        ).run()
        js_result = self._read_js_plan()
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

    def _read_js_plan(self) -> dict[str, Any]:
        if not self.js_plan_path.exists():
            return {}
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


def _parse_terms(value: str) -> list[str]:
    return [item.strip() for item in re.split(r"[\r\n,;|]+", str(value or "")) if item.strip()]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run near-target resolver plan from dictionary source videos.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--state", default="server/data/keywordHarvestState.json")
    parser.add_argument("--target-evidence", type=int, default=3)
    parser.add_argument("--max-need", type=int, default=1)
    parser.add_argument("--batch", type=int, default=12)
    parser.add_argument("--videos-per-term", type=int, default=3)
    parser.add_argument("--pages", type=int, default=3)
    parser.add_argument("--override-terms", default="", help="Comma/newline/pipe separated terms to plan even when not near target.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible near-target resolve plan to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    override_terms = _parse_terms(args.override_terms)
    if args.compare_js_plan:
        result = NearTargetResolvePlanContractComparator(
            args.dictionary,
            args.state,
            args.compare_js_plan,
            target_evidence=args.target_evidence,
            max_need=args.max_need,
            batch=args.batch,
            videos_per_term=args.videos_per_term,
            pages=args.pages,
            override_terms=override_terms,
        ).compare()
    else:
        result = NearTargetResolvePlanRunner(
            args.dictionary,
            args.state,
            target_evidence=args.target_evidence,
            max_need=args.max_need,
            batch=args.batch,
            videos_per_term=args.videos_per_term,
            pages=args.pages,
            override_terms=override_terms,
        ).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
