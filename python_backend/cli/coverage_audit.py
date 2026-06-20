from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditContractComparator as CoverageAuditPayloadComparator
from python_backend.corpus.dictionary import DictionaryLoader


class AuditContractComparator:
    """Compare Python-generated audit metrics against the current JS audit JSON."""

    def __init__(self, dictionary_path: str | Path, js_audit_path: str | Path, strict_total_evidence: bool = False):
        self.dictionary_path = Path(dictionary_path)
        self.js_audit_path = Path(js_audit_path)
        self.comparator = CoverageAuditPayloadComparator(strict_total_evidence=strict_total_evidence)

    def compare(self) -> dict[str, Any]:
        with self.js_audit_path.open("r", encoding="utf-8-sig") as handle:
            js_audit = json.load(handle)
        dictionary = DictionaryLoader(self.dictionary_path).load()
        python_audit = self.comparator.builder_from_js_audit(js_audit).build({"entries": dictionary.entries})
        return self.comparator.compare(python_audit, js_audit)

def main() -> int:
    parser = argparse.ArgumentParser(description="Compare Python coverage-audit metrics against the current JS audit report.")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--js-audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--strict-total-evidence", action="store_true")
    args = parser.parse_args()
    result = AuditContractComparator(args.dictionary, args.js_audit, strict_total_evidence=args.strict_total_evidence).compare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
