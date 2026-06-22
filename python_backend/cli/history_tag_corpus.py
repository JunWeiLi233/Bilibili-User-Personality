from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.history_tags import (
    HistoryTagCorpusPayloadContractComparator as HistoryTagCorpusContractComparator,
    HistoryTagCorpusRequest,
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
        if not args.update and not args.plan_payload and not args.write_payload:
            parser.error("--update is required unless --plan-payload is used")
        return HistoryTagCorpusRequest(
            current_path=args.current,
            update_path=args.update or None,
            generated_at=args.generated_at or None,
            compare_js_report_path=args.compare_js_report or None,
            plan_payload_path=args.plan_payload or None,
            write_payload_path=args.write_payload or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = HistoryTagCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
