from __future__ import annotations

from typing import Any


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
