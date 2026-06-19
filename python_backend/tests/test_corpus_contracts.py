import json
import tempfile
import unittest
from pathlib import Path

from python_backend.analysis.audit import CoverageAuditReport
from python_backend.analysis.verification import RandomVerifier
from python_backend.analyzers.deepseek import AnalyzerRequest, DeepSeekAnalyzerClient
from python_backend.cli.compare_contracts import ContractComparator
from python_backend.corpus.loader import CorpusLoader
from python_backend.corpus.writer import CorpusShardWriter
from python_backend.scrapers.adapters import ScrapeRequest, ScraperAdapter
from python_backend.scrapers.rate_limiter import RateLimiter


class CorpusContractTests(unittest.TestCase):
    def test_loader_hydrates_split_corpus_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "demo.comments").mkdir()
            (root / "demo.runs").mkdir()
            (root / "demo.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "storage": "split",
                        "commentFiles": ["demo.comments/comments-0001.json"],
                        "runFiles": ["demo.runs/runs-0001.json"],
                    }
                ),
                encoding="utf-8",
            )
            (root / "demo.comments" / "comments-0001.json").write_text(
                json.dumps({"comments": [{"message": "狗头保命", "source": "bilibili"}]}),
                encoding="utf-8",
            )
            (root / "demo.runs" / "runs-0001.json").write_text(
                json.dumps({"runs": [{"at": "2026-06-19T00:00:00.000Z"}]}),
                encoding="utf-8",
            )

            corpus = CorpusLoader(root / "demo.json").load()

        self.assertEqual(corpus.comments[0]["message"], "狗头保命")
        self.assertEqual(corpus.runs[0]["at"], "2026-06-19T00:00:00.000Z")
        self.assertEqual(corpus.manifest["storage"], "split")

    def test_writer_round_trips_small_split_corpus(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "out.json"
            CorpusShardWriter(output, max_shard_bytes=200).write(
                comments=[{"message": "查查资料"}, {"message": "真的吗我不信"}],
                runs=[{"at": "now"}],
                manifest={"version": 1, "updatedAt": "now"},
            )

            loaded = CorpusLoader(output).load()

        self.assertEqual([item["message"] for item in loaded.comments], ["查查资料", "真的吗我不信"])
        self.assertEqual(loaded.runs, [{"at": "now"}])
        self.assertEqual(loaded.manifest["storage"], "split")

    def test_random_verifier_samples_are_deterministic_and_keyword_aware(self):
        verifier = RandomVerifier(keyword_terms=["狗头", "查查资料"])
        comments = [
            {"message": "普通评论"},
            {"message": "查查资料再说"},
            {"message": "狗头保命"},
        ]

        first = verifier.verify(comments, sample_size=2, seed=7)
        second = verifier.verify(comments, sample_size=2, seed=7)

        self.assertEqual(first, second)
        self.assertEqual(first.sampled, 2)
        self.assertGreaterEqual(first.keyword_hits, 1)
        self.assertEqual(first.uncovered, 0)

    def test_coverage_audit_report_reads_current_json_shape(self):
        payload = {
            "ok": False,
            "targetEvidence": 3,
            "coverage": {
                "terms": 10,
                "coverageRatio": 0.8,
                "weakTerms": 2,
                "zeroEvidenceTerms": 0,
                "evidenceDeficit": 3,
            },
            "nextActions": [{"term": "查查资料", "nextQuery": "查查资料 B站评论"}],
        }

        report = CoverageAuditReport.from_json(payload)

        self.assertFalse(report.ok)
        self.assertEqual(report.target_evidence, 3)
        self.assertEqual(report.weak_terms, 2)
        self.assertEqual(report.next_queries(), ["查查资料 B站评论"])

    def test_rate_limiter_uses_injected_sleep_without_real_waiting(self):
        sleeps = []
        limiter = RateLimiter(delay_seconds=1.25, sleep=sleeps.append)

        limiter.wait()

        self.assertEqual(sleeps, [1.25])

    def test_scraper_and_analyzer_boundaries_are_class_based(self):
        request = ScrapeRequest(query="历史", limit=3)
        scraper = ScraperAdapter(rate_limiter=RateLimiter(delay_seconds=0, sleep=lambda _: None))
        analyzer = DeepSeekAnalyzerClient()

        self.assertEqual(scraper.build_metadata_request(request)["query"], "历史")
        self.assertEqual(
            analyzer.build_payload(AnalyzerRequest(comments=["狗头保命"], keyword_hints=["狗头"]))["keyword_hints"],
            ["狗头"],
        )

    def test_contract_comparator_checks_manifest_count_and_audit_terms(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus_path = root / "corpus.json"
            audit_path = root / "audit.json"
            corpus_path.write_text(
                json.dumps({"version": 1, "comments": [{"message": "ok"}], "runs": []}),
                encoding="utf-8",
            )
            audit_path.write_text(
                json.dumps({"ok": False, "targetEvidence": 3, "coverage": {"terms": 1, "coverageRatio": 1}}),
                encoding="utf-8",
            )

            result = ContractComparator(corpus_path, audit_path).compare()

        self.assertTrue(result["ok"])
        self.assertEqual(result["corpus"]["comments"], 1)
        self.assertEqual(result["audit"]["terms"], 1)


if __name__ == "__main__":
    unittest.main()
