from __future__ import annotations

from pathlib import Path

from python_backend.analysis.audit import CoverageAuditReport
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader


class CorpusContractSummary:
    """Shape corpus/audit/dictionary contract comparisons for stable JSON output."""

    RESULT_KEYS = ("ok", "mismatches", "corpus", "audit", "dictionary", "tiebaCorpus")

    def summarize(self, result: dict[str, object] | None = None) -> dict[str, object]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class ContractComparator:
    """Compare Python-read JSON contracts against manifest/audit invariants."""

    def __init__(
        self,
        corpus_path: str | Path,
        audit_path: str | Path,
        dictionary_path: str | Path | None = None,
        tieba_corpus_path: str | Path | None = None,
        summary: CorpusContractSummary | None = None,
    ):
        self.corpus_path = Path(corpus_path)
        self.audit_path = Path(audit_path)
        self.dictionary_path = Path(dictionary_path) if dictionary_path else None
        self.tieba_corpus_path = Path(tieba_corpus_path) if tieba_corpus_path else None
        self.summary = summary or CorpusContractSummary()

    def compare(self) -> dict[str, object]:
        corpus = CorpusLoader(self.corpus_path).load()
        audit = CoverageAuditReport.load(self.audit_path)
        dictionary = DictionaryLoader(self.dictionary_path).load() if self.dictionary_path else None
        manifest_comment_count = corpus.manifest.get("commentCount")
        manifest_run_count = corpus.manifest.get("runCount")
        mismatches = []
        if manifest_comment_count not in (None, len(corpus.comments)):
            mismatches.append({"key": "manifestCommentCount", "python": len(corpus.comments), "js": manifest_comment_count})
        if manifest_run_count not in (None, len(corpus.runs)):
            mismatches.append({"key": "manifestRunCount", "python": len(corpus.runs), "js": manifest_run_count})
        result: dict[str, object] = {
            "ok": audit.terms > 0,
            "mismatches": mismatches,
            "corpus": {
                "comments": len(corpus.comments),
                "runs": len(corpus.runs),
                "manifestCommentCount": manifest_comment_count,
                "manifestRunCount": manifest_run_count,
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
            if len(dictionary.entries) != audit.terms:
                mismatches.append({"key": "dictionaryTerms", "python": len(dictionary.entries), "js": audit.terms})
        if self.tieba_corpus_path:
            tieba_corpus = CorpusLoader(self.tieba_corpus_path).load()
            tieba_manifest_comment_count = tieba_corpus.manifest.get("commentCount")
            tieba_manifest_run_count = tieba_corpus.manifest.get("runCount")
            result["tiebaCorpus"] = {
                "comments": len(tieba_corpus.comments),
                "runs": len(tieba_corpus.runs),
                "manifestCommentCount": tieba_manifest_comment_count,
                "manifestRunCount": tieba_manifest_run_count,
                "storage": tieba_corpus.manifest.get("storage", "monolith"),
            }
            if tieba_manifest_comment_count not in (None, len(tieba_corpus.comments)):
                mismatches.append({"key": "tiebaManifestCommentCount", "python": len(tieba_corpus.comments), "js": tieba_manifest_comment_count})
            if tieba_manifest_run_count not in (None, len(tieba_corpus.runs)):
                mismatches.append({"key": "tiebaManifestRunCount", "python": len(tieba_corpus.runs), "js": tieba_manifest_run_count})
        result["ok"] = bool(result["ok"]) and len(mismatches) == 0
        return self.summary.summarize(result)
