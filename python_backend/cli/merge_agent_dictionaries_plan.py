from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.agent_merge import AgentDictionaryMergePlanRequest, MergeAgentDictionariesPlanContractComparator, MergeAgentDictionariesPlanRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a dry-run plan for merging agent dictionaries into the main dictionary.")
    parser.add_argument("agent_paths", nargs="*", help="Agent worktree paths containing server/data/deepseekKeywordDictionary.json.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--agent-dictionary-relative-path", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible merge-agent report to compare.")
    return parser


class MergeAgentDictionariesPlanCliRunner:
    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        argv = [str(item) for item in self.argv] if self.argv is not None else None
        args = build_parser().parse_args(argv)
        return AgentDictionaryMergePlanRequest(
            args.dictionary,
            args.agent_paths,
            agent_dictionary_relative_path=args.agent_dictionary_relative_path,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = MergeAgentDictionariesPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
