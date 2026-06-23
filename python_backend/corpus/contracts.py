from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from python_backend.analysis.audit import CoverageAuditReport
from python_backend.analysis.verification import RandomVerificationPayloadContractComparator
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader
from python_backend.runtime.json_contracts import JsonResultBytesContract, safe_read_json_object


class CorpusContractSummary:
    """Shape corpus/audit/dictionary contract comparisons for stable JSON output."""

    RESULT_KEYS = ("ok", "mismatches", "corpus", "audit", "dictionary", "tiebaCorpus", "randomVerification")

    def summarize(self, result: dict[str, object] | None = None) -> dict[str, object]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class CompareContractsJsonResultContract(JsonResultBytesContract):
    """Serialize JS/Python compare-contract results exactly as the CLI expects."""


class CompareContractsOutputWriter:
    """Persist compare-contract JSON output using the shared CLI result contract."""

    def __init__(self, output_path: str | Path):
        self.output_path = Path(output_path)

    def write(self, result: dict[str, object]) -> dict[str, object]:
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_bytes(CompareContractsJsonResultContract(result).to_bytes())
        return result


class ContractComparator:
    """Compare Python-read JSON contracts against manifest/audit invariants."""

    def __init__(
        self,
        corpus_path: str | Path,
        audit_path: str | Path,
        dictionary_path: str | Path | None = None,
        tieba_corpus_path: str | Path | None = None,
        random_report_path: str | Path | None = None,
        random_sample_size: int | None = None,
        random_seed: int | None = None,
        summary: CorpusContractSummary | None = None,
    ):
        self.corpus_path = Path(corpus_path)
        self.audit_path = Path(audit_path)
        self.dictionary_path = Path(dictionary_path) if dictionary_path else None
        self.tieba_corpus_path = Path(tieba_corpus_path) if tieba_corpus_path else None
        self.random_report_path = Path(random_report_path) if random_report_path else None
        self.random_sample_size = random_sample_size
        self.random_seed = random_seed
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
        if self.random_report_path and self.dictionary_path:
            random_comparison = RandomVerificationPayloadContractComparator(
                self.corpus_path,
                self.dictionary_path,
                self.random_report_path,
                sample_size=self.random_sample_size,
                seed=self.random_seed,
            ).compare()
            result["randomVerification"] = random_comparison
            if not random_comparison.get("ok"):
                mismatches.append({"key": "randomVerification", "python": random_comparison.get("python"), "js": random_comparison.get("js")})
        result["ok"] = bool(result["ok"]) and len(mismatches) == 0
        return self.summary.summarize(result)


class CompareContractsRequest:
    """Corpus-layer request for JS/Python JSON compatibility comparisons."""

    def __init__(
        self,
        corpus_path: str | Path,
        audit_path: str | Path,
        dictionary_path: str | Path | None = None,
        tieba_corpus_path: str | Path | None = None,
        random_report_path: str | Path | None = None,
        random_sample_size: int | None = None,
        random_seed: int | None = None,
        output_path: str | Path | None = None,
    ):
        self.corpus_path = Path(corpus_path)
        self.audit_path = Path(audit_path)
        self.dictionary_path = Path(dictionary_path) if dictionary_path else None
        self.tieba_corpus_path = Path(tieba_corpus_path) if tieba_corpus_path else None
        self.random_report_path = Path(random_report_path) if random_report_path else None
        self.random_sample_size = random_sample_size
        self.random_seed = random_seed
        self.output_path = Path(output_path) if output_path else None

    def run(self) -> dict[str, object]:
        result = ContractComparator(
            self.corpus_path,
            self.audit_path,
            self.dictionary_path,
            self.tieba_corpus_path,
            random_report_path=self.random_report_path,
            random_sample_size=self.random_sample_size,
            random_seed=self.random_seed,
        ).compare()
        if self.output_path:
            return CompareContractsOutputWriter(self.output_path).write(result)
        return result


class CompareContractsCommandRequest:
    """Parse CLI argv for JS/Python contract comparison in the corpus layer."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Validate Python compatibility with JS JSON corpus/audit contracts.")
        parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
        parser.add_argument("--audit", default="server/data/keywordCoverageAudit.json")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--tieba-corpus", default="server/data/tiebaKeywordCorpus.json")
        parser.add_argument("--random-report", default="", help="Optional JS-compatible random-verification report to compare.")
        parser.add_argument("--random-sample-size", type=int, default=None)
        parser.add_argument("--random-seed", type=int, default=None)
        parser.add_argument("--output", default="", help="Optional path to write the compare-contract JSON result.")
        return parser

    def run(self) -> dict[str, object]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return CompareContractsRequest(
            args.corpus,
            args.audit,
            args.dictionary,
            args.tieba_corpus,
            random_report_path=args.random_report or None,
            random_sample_size=args.random_sample_size,
            random_seed=args.random_seed,
            output_path=args.output or None,
        ).run()
