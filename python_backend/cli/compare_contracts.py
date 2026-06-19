from __future__ import annotations

import argparse
import json
from pathlib import Path

from python_backend.analysis.audit import CoverageAuditReport
from python_backend.corpus.loader import CorpusLoader


class ContractComparator:
    """Compare Python-read JSON contracts against manifest/audit invariants."""

    def __init__(self, corpus_path: str | Path, audit_path: str | Path):
        self.corpus_path = Path(corpus_path)
        self.audit_path = Path(audit_path)

    def compare(self) -> dict[str, object]:
        corpus = CorpusLoader(self.corpus_path).load()
        audit = CoverageAuditReport.load(self.audit_path)
        manifest_comment_count = corpus.manifest.get("commentCount")
        return {
            "ok": manifest_comment_count in (None, len(corpus.comments)) and audit.terms > 0,
            "corpus": {
                "comments": len(corpus.comments),
                "runs": len(corpus.runs),
                "manifestCommentCount": manifest_comment_count,
                "storage": corpus.manifest.get("storage", "monolith"),
            },
            "audit": {
                "terms": audit.terms,
                "weakTerms": audit.weak_terms,
                "coverageRatio": audit.coverage_ratio,
                "targetEvidence": audit.target_evidence,
            },
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Python compatibility with JS JSON corpus/audit contracts.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--audit", default="server/data/keywordCoverageAudit.json")
    args = parser.parse_args()
    result = ContractComparator(args.corpus, args.audit).compare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
