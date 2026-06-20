from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.history_tags import (
    HistoryTagCorpusPayloadContractComparator as HistoryTagCorpusContractComparator,
    HistoryTagCorpusRunner,
    HistoryTagCorpusShardWritePayloadContractComparator as HistoryTagCorpusShardWriteContractComparator,
    HistoryTagCorpusShardWriteRunner,
    HistoryTagScrapePlanPayloadContractComparator as HistoryTagScrapePlanContractComparator,
    HistoryTagScrapePlanRunner,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Merge JS-compatible Bilibili history tag corpus JSON.")
    parser.add_argument("--current", default="server/data/bilibiliHistoryTagCorpus.json")
    parser.add_argument("--update", default="", help="History-tag scrape update JSON object.")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible history-tag corpus report to compare.")
    parser.add_argument("--plan-payload", default="", help="Optional JSON payload for scrape option/request planning.")
    parser.add_argument("--write-payload", default="", help="Optional JSON payload for split history-tag corpus writing.")
    return parser


class HistoryTagCorpusCliRunner:
    """CLI-compatible history-tag corpus runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        parser = build_parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.write_payload and args.compare_js_report:
            return HistoryTagCorpusShardWriteContractComparator(args.write_payload, args.compare_js_report).compare()
        if args.write_payload:
            return HistoryTagCorpusShardWriteRunner(args.write_payload).run()
        if args.plan_payload and args.compare_js_report:
            return HistoryTagScrapePlanContractComparator(args.plan_payload, args.compare_js_report).compare()
        if args.plan_payload:
            return HistoryTagScrapePlanRunner(args.plan_payload).run()
        if args.compare_js_report:
            return HistoryTagCorpusContractComparator(
                args.current,
                args.update,
                args.compare_js_report,
                generated_at=args.generated_at or None,
            ).compare()
        if not args.update:
            parser.error("--update is required unless --plan-payload is used")
        return HistoryTagCorpusRunner(args.current, args.update, generated_at=args.generated_at or None).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = HistoryTagCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
