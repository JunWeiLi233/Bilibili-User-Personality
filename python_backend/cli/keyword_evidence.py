from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.keyword_evidence import (
    KeywordEvidencePayloadContractComparator as KeywordEvidenceContractComparator,
    KeywordEvidencePayloadRunner as KeywordEvidenceRunner,
)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Match keyword dictionary entries against direct text evidence.")
    parser.add_argument("--payload", required=True, help="JSON payload with entries or dictionary plus text.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible keyword evidence report to compare.")
    args = parser.parse_args(argv)
    if args.compare_js_report:
        result = KeywordEvidenceContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = KeywordEvidenceRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
