from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.dictionary import DictionaryLoader


class MergeAgentDictionariesPlanRunner:
    """Build a dry-run plan for merging resolver-agent dictionary evidence."""

    def __init__(
        self,
        main_dictionary_path: str | Path,
        agent_paths: list[str | Path],
        *,
        agent_dictionary_relative_path: str = "server/data/deepseekKeywordDictionary.json",
    ):
        self.main_dictionary_path = Path(main_dictionary_path)
        self.agent_paths = [Path(path) for path in agent_paths]
        self.agent_dictionary_relative_path = agent_dictionary_relative_path

    def run(self) -> dict[str, Any]:
        main_entries = DictionaryLoader(self.main_dictionary_path).load().entries
        current_counts = {
            str(entry.get("term") or "").strip(): max(0, int(float(entry.get("evidenceCount") or 0)))
            for entry in main_entries
            if str(entry.get("term") or "").strip()
        }
        agents = []
        total_gain = 0
        for index, agent_path in enumerate(self.agent_paths, start=1):
            agent_result = self._plan_agent(index, agent_path, current_counts)
            agents.append(agent_result)
            total_gain += int(agent_result.get("evidenceGain") or 0)
        skipped_agents = sum(1 for item in agents if item.get("skipped"))
        return {
            "ok": True,
            "mainDictionaryPath": str(self.main_dictionary_path),
            "agentCount": len(self.agent_paths),
            "mainEntries": len(main_entries),
            "totalEvidenceGain": total_gain,
            "agents": agents,
            "summary": {
                "agentCount": len(self.agent_paths),
                "mainEntries": len(main_entries),
                "totalEvidenceGain": total_gain,
                "skippedAgents": skipped_agents,
            },
        }

    def _plan_agent(self, index: int, agent_path: Path, current_counts: dict[str, int]) -> dict[str, Any]:
        dictionary_path = agent_path / self.agent_dictionary_relative_path
        try:
            agent_entries = DictionaryLoader(dictionary_path).load().entries
        except Exception as exc:
            return {
                "agent": index,
                "path": str(agent_path),
                "entries": 0,
                "mergeableEntries": 0,
                "evidenceGain": 0,
                "skipped": True,
                "reason": f"cannot_read_dictionary: {exc}",
            }
        if not agent_entries:
            return {
                "agent": index,
                "path": str(agent_path),
                "entries": 0,
                "mergeableEntries": 0,
                "evidenceGain": 0,
                "skipped": True,
                "reason": "no_entries",
            }
        mergeable = []
        for entry in agent_entries:
            term = str(entry.get("term") or "").strip()
            if term in current_counts:
                mergeable.append(entry)
        gain = 0
        for entry in mergeable:
            term = str(entry.get("term") or "").strip()
            incoming_count = max(0, int(float(entry.get("evidenceCount") or 0)))
            before_count = current_counts.get(term, 0)
            after_count = max(before_count, incoming_count)
            if after_count > before_count:
                gain += after_count - before_count
                current_counts[term] = after_count
        return {
            "agent": index,
            "path": str(agent_path),
            "entries": len(agent_entries),
            "mergeableEntries": len(mergeable),
            "evidenceGain": gain,
            "skipped": False,
        }


class MergeAgentDictionariesPlanContractComparator:
    """Compare Python merge-agent dry-run plans against saved JS-compatible JSON."""

    RESULT_KEYS = ("agentCount", "mainEntries", "totalEvidenceGain", "agents", "summary")

    def __init__(
        self,
        main_dictionary_path: str | Path,
        agent_paths: list[str | Path],
        js_report_path: str | Path,
        *,
        agent_dictionary_relative_path: str = "server/data/deepseekKeywordDictionary.json",
    ):
        self.main_dictionary_path = Path(main_dictionary_path)
        self.agent_paths = agent_paths
        self.js_report_path = Path(js_report_path)
        self.agent_dictionary_relative_path = agent_dictionary_relative_path

    def compare(self) -> dict[str, Any]:
        python_result = MergeAgentDictionariesPlanRunner(
            self.main_dictionary_path,
            self.agent_paths,
            agent_dictionary_relative_path=self.agent_dictionary_relative_path,
        ).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run plan for merging agent dictionaries into the main dictionary.")
    parser.add_argument("agent_paths", nargs="*", help="Agent worktree paths containing server/data/deepseekKeywordDictionary.json.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--agent-dictionary-relative-path", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible merge-agent report to compare.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.compare_js_report:
        result = MergeAgentDictionariesPlanContractComparator(
            args.dictionary,
            args.agent_paths,
            args.compare_js_report,
            agent_dictionary_relative_path=args.agent_dictionary_relative_path,
        ).compare()
    else:
        result = MergeAgentDictionariesPlanRunner(
            args.dictionary,
            args.agent_paths,
            agent_dictionary_relative_path=args.agent_dictionary_relative_path,
        ).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
