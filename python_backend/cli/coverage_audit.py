from __future__ import annotations

import argparse
import json

from python_backend.analysis.audit import CoverageAuditPayloadContractComparator as AuditContractComparator


class CoverageAuditRunner:
    """CLI-compatible coverage-audit comparator runner for JS/Python contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return AuditContractComparator(args.dictionary, args.js_audit, strict_total_evidence=args.strict_total_evidence).compare()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Compare Python coverage-audit metrics against the current JS audit report.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--js-audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--strict-total-evidence", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    result = CoverageAuditRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
