from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.keyword_evidence import (
    KeywordEvidencePayloadContractComparator as KeywordEvidenceContractComparator,
    KeywordEvidenceRequest,
    KeywordEvidencePayloadRunner as KeywordEvidenceRunner,
)


class KeywordEvidenceCliRunner:
    """CLI-compatible keyword evidence runner for analyzer JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = parse_args(self.argv)
        return KeywordEvidenceRequest(
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Match keyword dictionary entries against direct text evidence.")
    parser.add_argument("--payload", required=True, help="JSON payload with entries or dictionary plus text.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible keyword evidence report to compare.")
    return parser.parse_args([str(item) for item in argv] if argv is not None else None)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = KeywordEvidenceCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
