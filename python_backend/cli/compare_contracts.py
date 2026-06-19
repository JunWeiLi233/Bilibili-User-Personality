from __future__ import annotations

import argparse
import json
from pathlib import Path

from python_backend.analysis.audit import CoverageAuditReport
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader


class ContractComparator:
    """Compare Python-read JSON contracts against manifest/audit invariants."""

    def __init__(self, corpus_path: str | Path, audit_path: str | Path, dictionary_path: str | Path | None = None):
        self.corpus_path = Path(corpus_path)
        self.audit_path = Path(audit_path)
        self.dictionary_path = Path(dictionary_path) if dictionary_path else None

    def compare(self) -> dict[str, object]:
        corpus = CorpusLoader(self.corpus_path).load()
        audit = CoverageAuditReport.load(self.audit_path)
        dictionary = DictionaryLoader(self.dictionary_path).load() if self.dictionary_path else None
        manifest_comment_count = corpus.manifest.get("commentCount")
        result: dict[str, object] = {
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
        if dictionary:
            result["dictionary"] = {
                "terms": len(dictionary.entries),
                "storage": dictionary.manifest.get("storage"),
                "version": dictionary.manifest.get("version"),
                "shardSize": dictionary.manifest.get("shardSize"),
                "shardMaxBytes": dictionary.manifest.get("shardMaxBytes"),
                "evidenceStorage": dictionary.manifest.get("evidenceStorage"),
                "families": dictionary.manifest.get("families") or {},
            }
        return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Python compatibility with JS JSON corpus/audit contracts.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    args = parser.parse_args()
    result = ContractComparator(args.corpus, args.audit, args.dictionary).compare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
