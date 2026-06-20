from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.history_tags import (
    HistoryTagCorpusPayloadContractComparator as HistoryTagCorpusContractComparator,
    HistoryTagCorpusRunner,
    HistoryTagScrapePlanPayloadContractComparator as HistoryTagScrapePlanContractComparator,
    HistoryTagScrapePlanRunner,
)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Merge JS-compatible Bilibili history tag corpus JSON.")
    parser.add_argument("--current", default="server/data/bilibiliHistoryTagCorpus.json")
    parser.add_argument("--update", default="", help="History-tag scrape update JSON object.")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible history-tag corpus report to compare.")
    parser.add_argument("--plan-payload", default="", help="Optional JSON payload for scrape option/request planning.")
    args = parser.parse_args(argv)
    if args.plan_payload and args.compare_js_report:
        result = HistoryTagScrapePlanContractComparator(args.plan_payload, args.compare_js_report).compare()
    elif args.plan_payload:
        result = HistoryTagScrapePlanRunner(args.plan_payload).run()
    elif args.compare_js_report:
        result = HistoryTagCorpusContractComparator(
            args.current,
            args.update,
            args.compare_js_report,
            generated_at=args.generated_at or None,
        ).compare()
    else:
        if not args.update:
            parser.error("--update is required unless --plan-payload is used")
        result = HistoryTagCorpusRunner(args.current, args.update, generated_at=args.generated_at or None).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
