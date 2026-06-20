from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.agent_merge import MergeAgentDictionariesPlanContractComparator, MergeAgentDictionariesPlanRunner


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
