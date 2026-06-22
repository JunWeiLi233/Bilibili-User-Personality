from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.corpus.dictionary import DictionaryLoader


class AgentDictionaryMergePlanner:
    """Estimate existing-term evidence gain from resolver-agent dictionaries."""

    def build_plan(self, main_entries: list[dict[str, Any]] | None = None, agents: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        main_entries = main_entries if isinstance(main_entries, list) else []
        agents = agents if isinstance(agents, list) else []
        current_counts = {
            str(entry.get("term") or "").strip(): self._evidence_count(entry)
            for entry in main_entries
            if isinstance(entry, dict) and str(entry.get("term") or "").strip()
        }
        agent_results = []
        total_gain = 0
        for index, agent in enumerate(agents, start=1):
            result = self._plan_agent(index, agent, current_counts)
            agent_results.append(result)
            total_gain += int(result.get("evidenceGain") or 0)
        skipped_agents = sum(1 for item in agent_results if item.get("skipped"))
        return {
            "ok": True,
            "agentCount": len(agents),
            "mainEntries": len(main_entries),
            "totalEvidenceGain": total_gain,
            "agents": agent_results,
            "summary": {
                "agentCount": len(agents),
                "mainEntries": len(main_entries),
                "totalEvidenceGain": total_gain,
                "skippedAgents": skipped_agents,
            },
        }

    def _plan_agent(self, index: int, agent: dict[str, Any], current_counts: dict[str, int]) -> dict[str, Any]:
        path = str(agent.get("path") or "")
        entries = agent.get("entries") if isinstance(agent.get("entries"), list) else []
        if not entries:
            return {
                "agent": index,
                "path": path,
                "entries": 0,
                "mergeableEntries": 0,
                "evidenceGain": 0,
                "skipped": True,
                "reason": str(agent.get("reason") or "no_entries"),
            }
        mergeable = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            term = str(entry.get("term") or "").strip()
            if term in current_counts:
                mergeable.append(entry)
        gain = 0
        for entry in mergeable:
            term = str(entry.get("term") or "").strip()
            incoming_count = self._evidence_count(entry)
            before_count = current_counts.get(term, 0)
            after_count = max(before_count, incoming_count)
            if after_count > before_count:
                gain += after_count - before_count
                current_counts[term] = after_count
        return {
            "agent": index,
            "path": path,
            "entries": len(entries),
            "mergeableEntries": len(mergeable),
            "evidenceGain": gain,
            "skipped": False,
        }

    def _evidence_count(self, entry: dict[str, Any]) -> int:
        try:
            return max(0, int(float(entry.get("evidenceCount") or 0)))
        except (TypeError, ValueError):
            return 0


class AgentDictionaryMergePlanSummary:
    """Shape merge-agent dictionary plans into the JS/Python comparator contract."""

    RESULT_KEYS = ("agentCount", "mainEntries", "totalEvidenceGain", "agents", "summary")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


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
        agents = []
        for index, agent_path in enumerate(self.agent_paths, start=1):
            agents.append(self._load_agent(index, agent_path))
        plan = AgentDictionaryMergePlanner().build_plan(main_entries, agents)
        return {"mainDictionaryPath": str(self.main_dictionary_path), **plan}

    def _load_agent(self, index: int, agent_path: Path) -> dict[str, Any]:
        dictionary_path = agent_path / self.agent_dictionary_relative_path
        try:
            agent_entries = DictionaryLoader(dictionary_path).load().entries
        except Exception as exc:
            return {
                "agent": index,
                "path": str(agent_path),
                "entries": [],
                "reason": f"cannot_read_dictionary: {exc}",
            }
        return {"agent": index, "path": str(agent_path), "entries": agent_entries}


class MergeAgentDictionariesPlanContractComparator:
    """Compare Python merge-agent dry-run plans against saved JS-compatible JSON."""

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
        self.summary = AgentDictionaryMergePlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = MergeAgentDictionariesPlanRunner(
            self.main_dictionary_path,
            self.agent_paths,
            agent_dictionary_relative_path=self.agent_dictionary_relative_path,
        ).run()
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
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class AgentDictionaryMergePlanRequest:
    """Corpus-layer request for merge-agent dictionary plan JSON contract commands."""

    def __init__(
        self,
        main_dictionary_path: str | Path,
        agent_paths: list[str | Path],
        *,
        agent_dictionary_relative_path: str = "server/data/deepseekKeywordDictionary.json",
        compare_js_report_path: str | Path | None = None,
    ):
        self.main_dictionary_path = Path(main_dictionary_path)
        self.agent_paths = agent_paths
        self.agent_dictionary_relative_path = agent_dictionary_relative_path
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return MergeAgentDictionariesPlanContractComparator(
                self.main_dictionary_path,
                self.agent_paths,
                self.compare_js_report_path,
                agent_dictionary_relative_path=self.agent_dictionary_relative_path,
            ).compare()
        return MergeAgentDictionariesPlanRunner(
            self.main_dictionary_path,
            self.agent_paths,
            agent_dictionary_relative_path=self.agent_dictionary_relative_path,
        ).run()


class AgentDictionaryMergePlanCommandRequest:
    """Parse CLI argv for merge-agent plans while keeping ownership in corpus."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def parser(self) -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a dry-run plan for merging agent dictionaries into the main dictionary.")
        parser.add_argument("agent_paths", nargs="*", help="Agent worktree paths containing server/data/deepseekKeywordDictionary.json.")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--agent-dictionary-relative-path", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible merge-agent report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return AgentDictionaryMergePlanRequest(
            args.dictionary,
            args.agent_paths,
            agent_dictionary_relative_path=args.agent_dictionary_relative_path,
            compare_js_report_path=args.compare_js_report or None,
        ).run()
