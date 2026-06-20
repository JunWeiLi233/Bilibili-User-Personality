from __future__ import annotations

import argparse
import json

from python_backend.analysis.audit import CoverageAuditPayloadContractComparator as AuditContractComparator

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare Python coverage-audit metrics against the current JS audit report.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--js-audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--strict-total-evidence", action="store_true")
    args = parser.parse_args(argv)
    result = AuditContractComparator(args.dictionary, args.js_audit, strict_total_evidence=args.strict_total_evidence).compare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
