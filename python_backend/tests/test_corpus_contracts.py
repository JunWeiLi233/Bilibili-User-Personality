import json
import tempfile
import unittest
from pathlib import Path

from python_backend.analysis.audit import CoverageAuditBuilder, CoverageAuditReport
from python_backend.analysis.comment_coverage import CommentCoverageClassifier
from python_backend.analysis.coverage_progress import CoverageProgressTracker
from python_backend.analysis.discovery_report import VideoKeywordDiscoveryReporter
from python_backend.analysis.harvest_options import CoverageRuntimeOptionsBuilder, VideoKeywordDiscoveryOptionsBuilder
from python_backend.analysis.harvest_plan import KeywordHarvestPlanBuilder
from python_backend.analysis.readme_stats import ReadmeStatsBuilder
from python_backend.analysis.semantic_matcher import SemanticMatcherHelper
from python_backend.analysis.verification import RandomVerifier
from python_backend.analyzers.deepseek import AnalyzerRequest, DeepSeekAnalyzerClient
from python_backend.analyzers.keyword_evidence import KeywordEvidenceMatcher
from python_backend.cli.comment_coverage import CommentCoverageContractComparator, CommentCoverageRunner
from python_backend.cli.bilibili_parse import BilibiliParseContractComparator, BilibiliParseRunner
from python_backend.cli.bilibili_crawler import BilibiliCrawlerContractComparator, BilibiliCrawlerRunner
from python_backend.cli.bilibili_probe_plan import BilibiliProbePlanContractComparator, BilibiliProbePlanRunner
from python_backend.cli.coverage_audit import AuditContractComparator
from python_backend.cli.coverage_progress import CoverageProgressContractComparator, CoverageProgressRunner
from python_backend.cli.discovery_report import VideoKeywordDiscoveryReportContractComparator, VideoKeywordDiscoveryReportRunner
from python_backend.cli.harvest_options import HarvestOptionsContractComparator, HarvestOptionsRunner
from python_backend.cli.harvest_plan import KeywordHarvestPlanContractComparator, KeywordHarvestPlanRunner
from python_backend.cli.readme_stats import ReadmeStatsContractComparator, ReadmeStatsRunner
from python_backend.cli.semantic_matcher import SemanticMatcherContractComparator, SemanticMatcherRunner
from python_backend.cli.compare_contracts import ContractComparator
from python_backend.cli.deepseek_analysis_plan import DeepSeekAnalysisPlanContractComparator, DeepSeekAnalysisPlanRunner
from python_backend.cli.keyword_evidence import KeywordEvidenceContractComparator, KeywordEvidenceRunner
from python_backend.cli.history_tag_corpus import HistoryTagCorpusContractComparator, HistoryTagCorpusRunner
from python_backend.cli.huggingface_corpus import HuggingFaceCorpusImportContractComparator, HuggingFaceCorpusImportRunner
from python_backend.cli.local_corpus_evidence import LocalCorpusEvidenceContractComparator, LocalCorpusEvidenceRunner
from python_backend.cli.local_corpus_flatten import LocalCorpusFlattenContractComparator, LocalCorpusFlattenRunner
from python_backend.cli.video_comment_filter import VideoCommentFilterContractComparator, VideoCommentFilterRunner
from python_backend.cli.video_context import VideoContextContractComparator, VideoContextRunner
from python_backend.cli.video_relevance import VideoRelevanceContractComparator, VideoRelevanceRunner
from python_backend.cli.direct_probe_corpus import DirectProbeCorpusContractComparator, DirectProbeCorpusRunner
from python_backend.cli.direct_probe_plan import DirectProbePlanContractComparator, DirectProbePlanRunner
from python_backend.cli.random_verification import RandomVerificationContractComparator, RandomVerificationRunner, json_result_bytes
from python_backend.cli.tieba_corpus import TiebaCorpusUpdateContractComparator, TiebaCorpusUpdateRunner
from python_backend.cli.tieba_html_parse import TiebaHtmlParseContractComparator, TiebaHtmlParseRunner
from python_backend.cli.tieba_timing import TiebaTimingContractComparator, TiebaTimingRunner
from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder
from python_backend.corpus.history_tags import HistoryTagCorpusManager
from python_backend.corpus.huggingface import HuggingFaceCorpusImporter
from python_backend.corpus.local import LocalCorpusEvidenceFinder
from python_backend.corpus.local import LocalCorpusFlattener
from python_backend.corpus.tieba import TiebaCorpusUpdater
from python_backend.analysis.video_filter import VideoCommentFilter, VideoContextBuilder, VideoRelevanceFilter
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader
from python_backend.corpus.writer import CorpusShardWriter
from python_backend.scrapers.adapters import ScrapeRequest, ScraperAdapter
from python_backend.scrapers.bilibili import BilibiliPublicParser
from python_backend.scrapers.bilibili_crawler import BilibiliCrawlerHelper
from python_backend.scrapers.bilibili_probe import BilibiliProbePlanner
from python_backend.scrapers.rate_limiter import RateLimiter
from python_backend.scrapers.tieba_html import TiebaHtmlParser
from python_backend.scrapers.tieba_timing import TiebaScrapeTiming


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

    def test_loader_accepts_utf8_bom_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "demo.comments").mkdir()
            (root / "demo.runs").mkdir()
            (root / "demo.json").write_text(
                "\ufeff"
                + json.dumps(
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
                "\ufeff" + json.dumps({"comments": [{"message": "bom comment", "source": "bilibili"}]}),
                encoding="utf-8",
            )
            (root / "demo.runs" / "runs-0001.json").write_text(
                "\ufeff" + json.dumps({"runs": [{"at": "2026-06-19T00:00:00.000Z"}]}),
                encoding="utf-8",
            )

            corpus = CorpusLoader(root / "demo.json").load()

        self.assertEqual(corpus.comments[0]["message"], "bom comment")
        self.assertEqual(corpus.runs[0]["at"], "2026-06-19T00:00:00.000Z")

    def test_loader_returns_fallback_when_corpus_file_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            corpus = CorpusLoader(
                root / "missing.json",
                fallback={"version": 1, "comments": [{"message": "fallback"}], "runs": [{"at": "fallback-run"}]},
            ).load()

        self.assertEqual(corpus.manifest["version"], 1)
        self.assertEqual(corpus.comments, [{"message": "fallback"}])
        self.assertEqual(corpus.runs, [{"at": "fallback-run"}])

    def test_loader_uses_inline_arrays_when_split_file_lists_are_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "demo.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "storage": "split",
                        "comments": [{"message": "inline comment"}],
                        "runs": [{"at": "inline-run"}],
                    }
                ),
                encoding="utf-8",
            )

            corpus = CorpusLoader(root / "demo.json").load()

        self.assertEqual(corpus.comments, [{"message": "inline comment"}])
        self.assertEqual(corpus.runs, [{"at": "inline-run"}])

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

    def test_writer_uses_js_minimum_shard_size_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "out.json"
            CorpusShardWriter(output, max_shard_bytes=1).write(
                comments=[{"message": "tiny"}],
                runs=[],
                manifest={"version": 1},
            )

            loaded = CorpusLoader(output).load()

        self.assertEqual(loaded.manifest["shardMaxBytes"], 1024)

    def test_writer_shards_include_js_metadata_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "out.json"
            CorpusShardWriter(output, max_shard_bytes=200).write(
                comments=[{"message": "metadata"}],
                runs=[{"at": "now"}],
                manifest={"version": 7, "updatedAt": "2026-06-19T00:00:00.000Z"},
            )

            comment_shard = json.loads((root / "out.comments" / "comments-0001.json").read_text(encoding="utf-8"))
            run_shard = json.loads((root / "out.runs" / "runs-0001.json").read_text(encoding="utf-8"))

        self.assertEqual(comment_shard["version"], 7)
        self.assertEqual(comment_shard["updatedAt"], "2026-06-19T00:00:00.000Z")
        self.assertEqual(run_shard["version"], 7)
        self.assertEqual(run_shard["updatedAt"], "2026-06-19T00:00:00.000Z")

    def test_writer_splits_using_full_js_shard_payload_size(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "out.json"
            CorpusShardWriter(output, max_shard_bytes=1024).write(
                comments=[{"message": "x" * 430}, {"message": "y" * 430}],
                runs=[],
                manifest={"version": 1},
            )

            loaded = CorpusLoader(output).load()

        self.assertEqual(loaded.manifest["commentFiles"], ["out.comments/comments-0001.json", "out.comments/comments-0002.json"])

    def test_writer_removes_stale_split_shards_after_smaller_rewrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "out.json"
            writer = CorpusShardWriter(output, max_shard_bytes=128)
            writer.write(
                comments=[{"message": "first" * 30}, {"message": "second" * 30}, {"message": "third" * 30}],
                runs=[{"at": "old-1"}, {"at": "old-2"}],
                manifest={"version": 1},
            )
            writer.write(
                comments=[{"message": "kept"}],
                runs=[{"at": "new"}],
                manifest={"version": 1},
            )

            comment_shards = sorted(path.name for path in (root / "out.comments").glob("comments-*.json"))
            run_shards = sorted(path.name for path in (root / "out.runs").glob("runs-*.json"))

        self.assertEqual(comment_shards, ["comments-0001.json"])
        self.assertEqual(run_shards, ["runs-0001.json"])

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

    def test_random_verifier_matches_ascii_terms_case_insensitively(self):
        verifier = RandomVerifier(keyword_terms=["YYGQ", "doge"])

        summary = verifier.verify([{"message": "this yyGq comment uses DOGE satire"}], sample_size=1, seed=1)

        self.assertEqual(summary.keyword_hits, 1)
        self.assertEqual(summary.samples[0]["matched_terms"], ["YYGQ", "doge"])
        self.assertEqual(summary.samples[0]["coverage"], "keyword")

    def test_random_verifier_keeps_ascii_terms_out_of_longer_latin_words(self):
        verifier = RandomVerifier(keyword_terms=["md"])

        summary = verifier.verify([{"message": "cmd mode"}, {"message": "MD!"}], sample_size=2, seed=1)

        by_message = {sample["message"]: sample for sample in summary.samples}
        self.assertEqual(by_message["cmd mode"]["matched_terms"], [])
        self.assertEqual(by_message["cmd mode"]["coverage"], "neutral")
        self.assertEqual(by_message["MD!"]["matched_terms"], ["md"])

    def test_random_verifier_normalizes_noisy_chinese_keyword_spacing(self):
        verifier = RandomVerifier(keyword_terms=["\u7f51\u76d8\u89c1"])

        summary = verifier.verify([{"message": "\u54c8\u54c8\u54c8 \u7f51 \u76d8 \u89c1\uff01"}], sample_size=1, seed=1)

        self.assertEqual(summary.keyword_hits, 1)
        self.assertEqual(summary.samples[0]["matched_terms"], ["\u7f51\u76d8\u89c1"])
        self.assertEqual(summary.samples[0]["coverage"], "keyword")

    def test_random_verifier_skips_scrape_diagnostics(self):
        verifier = RandomVerifier(keyword_terms=["狗头"])

        summary = verifier.verify(
            [
                {"message": "HTTP 403 from https://tieba.baidu.com/p/123"},
                {"message": "狗头保命"},
            ],
            sample_size=2,
            seed=1,
        )

        self.assertEqual(summary.sampled, 1)
        self.assertEqual(summary.samples[0]["message"], "狗头保命")
        self.assertEqual(summary.keyword_hits, 1)

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

    def test_coverage_audit_report_load_accepts_utf8_bom_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "audit.json"
            audit_path.write_text(
                "\ufeff"
                + json.dumps(
                    {
                        "ok": False,
                        "targetEvidence": 3,
                        "coverage": {"terms": 2, "weakTerms": 1, "coverageRatio": 0.5},
                        "nextActions": [{"nextQuery": "bom query"}],
                    }
                ),
                encoding="utf-8",
            )

            report = CoverageAuditReport.load(audit_path)

        self.assertEqual(report.terms, 2)
        self.assertEqual(report.weak_terms, 1)
        self.assertEqual(report.next_queries(), ["bom query"])

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
            analyzer.build_payload(AnalyzerRequest(comments=["狗头保命"], keyword_hints=["狗头"]))["keywordHints"],
            [{"term": "狗头", "family": "", "meaning": ""}],
        )

    def test_deepseek_analyzer_builds_standalone_sentence_request(self):
        sentence = "\u8fd9\u53ea\u662f\u5f15\u7528\u68d2\u7403\u672f\u8bed\uff0c\u4e0d\u662f\u5728\u9a82\u4eba\u3002"
        analyzer = DeepSeekAnalyzerClient()

        request = analyzer.build_chat_request(
            AnalyzerRequest(
                comments=[sentence, sentence],
                uid="mid standalone",
                name="standalone tester",
                keyword_hints=[{"term": "\u9a82\u4eba", "family": "attack", "meaning": "\u653b\u51fb\u6027\u8bcd\u9762"}],
            )
        )

        user_prompt = request["messages"][1]["content"]
        self.assertEqual(request["model"], "deepseek-v4-flash")
        self.assertEqual(request["reasoning_effort"], "max")
        self.assertEqual(request["response_format"], {"type": "json_object"})
        self.assertIn("STANDALONE full-sentence psychologist/speech-act analyzer", user_prompt)
        self.assertIn("Keyword hints are optional, non-binding context only", user_prompt)
        self.assertIn("Do not assign radar/personality scores from keyword hits alone", user_prompt)
        self.assertIn(sentence, user_prompt)
        self.assertIn("\u653b\u51fb\u6027\u8bcd\u9762", user_prompt)
        self.assertEqual(user_prompt.count(sentence), 1)

    def test_keyword_evidence_matcher_filters_entries_by_direct_text_evidence(self):
        matcher = KeywordEvidenceMatcher()

        entries = matcher.filter_entries_by_evidence(
            [
                {"term": "YYGQ", "family": "attack", "meaning": "Chinese initialism"},
                {"term": "notpresent", "family": "attack", "meaning": "model hallucination"},
            ],
            "this Bilibili comment uses YYGQ only\nsecond yygq sample",
            source="Bilibili public video comment scan: https://www.bilibili.com/video/BV1source/",
            uid="BV1source",
        )

        self.assertEqual([entry["term"] for entry in entries], ["yygq"])
        self.assertEqual(entries[0]["evidenceCount"], 2)
        self.assertEqual(entries[0]["evidenceSamples"], ["this Bilibili comment uses YYGQ only", "second yygq sample"])
        self.assertEqual(
            entries[0]["evidenceSources"][0],
            {
                "source": "Bilibili public video comment scan: https://www.bilibili.com/video/BV1source/",
                "uid": "BV1source",
                "sample": "this Bilibili comment uses YYGQ only",
            },
        )

    def test_keyword_evidence_matcher_finds_dictionary_entries_and_excludes_terms(self):
        matcher = KeywordEvidenceMatcher()

        entries = matcher.find_dictionary_entries_with_text_evidence(
            {
                "entries": [
                    {"term": "yygq", "family": "attack", "meaning": "Chinese initialism", "evidenceCount": 0},
                    {"term": "\u67e5\u67e5\u8d44\u6599", "family": "evidence", "meaning": "asks for verification", "evidenceCount": 0},
                    {"term": "missing", "family": "attack", "meaning": "not present", "evidenceCount": 0},
                ]
            },
            "first YYGQ comment\n\u5efa\u8bae\u67e5\u67e5\u8d44\u6599\u518d\u8bf4",
            exclude_terms=["missing"],
        )

        self.assertEqual([entry["term"] for entry in entries], ["yygq", "\u67e5\u67e5\u8d44\u6599"])
        self.assertEqual(entries[0]["evidenceCount"], 1)
        self.assertEqual(entries[1]["evidenceSamples"], ["\u5efa\u8bae\u67e5\u67e5\u8d44\u6599\u518d\u8bf4"])

    def test_keyword_evidence_matcher_maps_js_term_aliases_to_dictionary_terms(self):
        matcher = KeywordEvidenceMatcher()

        entries = matcher.find_dictionary_entries_with_text_evidence(
            {
                "entries": [
                    {"term": "\u95ee\u767e\u5ea6", "family": "evasion", "meaning": "\u628a\u89e3\u91ca\u8d23\u4efb\u8f6c\u7ed9\u641c\u7d22\u5f15\u64ce"},
                    {"term": "\u732a\u9f3b", "family": "attack", "meaning": "\u77ed\u4fc3\u8d2c\u635f"},
                ]
            },
            "\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417\n\u8fd9\u64cd\u4f5c\u771f\u732a\u903c",
        )

        self.assertEqual([entry["term"] for entry in entries], ["\u95ee\u767e\u5ea6", "\u732a\u9f3b"])
        self.assertEqual(entries[0]["evidenceSamples"], ["\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417"])
        self.assertEqual(entries[1]["evidenceSamples"], ["\u8fd9\u64cd\u4f5c\u771f\u732a\u903c"])

    def test_keyword_evidence_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "dictionary": {"entries": [{"term": "YYGQ", "family": "attack", "meaning": "Chinese initialism"}]},
                        "text": "YYGQ once\nyygq twice",
                        "source": "Bilibili public comment target expansion",
                        "uid": "mid-1",
                        "mode": "dictionary",
                    }
                ),
                encoding="utf-8",
            )

            result = KeywordEvidenceRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entries"][0]["term"], "yygq")
        self.assertEqual(result["entries"][0]["evidenceCount"], 2)

    def test_keyword_evidence_contract_comparator_reports_entry_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-keyword-evidence.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "entries": [{"term": "YYGQ", "family": "attack", "meaning": "Chinese initialism"}],
                        "text": "YYGQ once\nyygq twice",
                        "source": "Bilibili public comment target expansion",
                        "uid": "mid-1",
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"ok": True, "mode": "entries", "count": 1, "entries": []}),
                encoding="utf-8",
            )

            result = KeywordEvidenceContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "entries",
                    "python": [
                        {
                            "term": "yygq",
                            "family": "attack",
                            "meaning": "Chinese initialism",
                            "evidenceCount": 2,
                            "evidenceSamples": ["YYGQ once", "yygq twice"],
                            "evidenceSources": [
                                {
                                    "source": "Bilibili public comment target expansion",
                                    "uid": "mid-1",
                                    "sample": "YYGQ once",
                                },
                                {
                                    "source": "Bilibili public comment target expansion",
                                    "uid": "mid-1",
                                    "sample": "yygq twice",
                                },
                            ],
                        }
                    ],
                    "js": [],
                }
            ],
        )

    def test_semantic_matcher_helper_matches_js_chunk_and_cosine_contracts(self):
        matcher = SemanticMatcherHelper()

        self.assertEqual(matcher.chunk_comment_text("短句"), [])
        self.assertEqual(matcher.chunk_comment_text("abcdefgh"), ["abcdefgh"])
        self.assertEqual(
            matcher.chunk_comment_text("这是一句足够长的话。第二句也足够长！short enough? another; done"),
            ["这是一句足够长的话", "short enough"],
        )
        self.assertEqual(
            matcher.chunk_comment_text("line one long enough\nline two long enough"),
            ["line one long enough", "line two long enough"],
        )
        self.assertEqual(matcher.cosine_similarity([1, 2, 3], [1, 2, 3]), 1)
        self.assertEqual(matcher.cosine_similarity([0, 0], [1, 2]), 0)
        self.assertEqual(matcher.cosine_similarity([1, 0, 9], [0, 1]), 0)

    def test_semantic_matcher_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "semantic.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "text": "alpha chunk? beta chunk",
                        "vectors": {"left": [1, 0], "right": [0.8, 0.6]},
                        "chunks": ["alpha chunk", "beta chunk"],
                        "chunkEmbeddings": [[1, 0], [0.8, 0.6]],
                        "termEmbeddings": {
                            "term-a": [1, 0],
                            "term-b": [0, 1],
                        },
                        "threshold": 0.5,
                    }
                ),
                encoding="utf-8",
            )

            result = SemanticMatcherRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["chunks"], ["alpha chunk", "beta chunk"])
        self.assertAlmostEqual(result["cosine"], 0.8, places=4)
        self.assertEqual(
            result["matches"],
            [
                {"term": "term-a", "chunk": "alpha chunk", "score": 1.0},
                {"term": "term-a", "chunk": "beta chunk", "score": 0.8},
                {"term": "term-b", "chunk": "beta chunk", "score": 0.6},
            ],
        )

    def test_semantic_matcher_contract_comparator_reports_match_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "semantic.json"
            js_report_path = root / "js-semantic.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "chunks": ["alpha chunk"],
                        "vectors": {"left": [1, 0], "right": [0.8, 0.6]},
                        "chunkEmbeddings": [[1, 0]],
                        "termEmbeddings": {"term-a": [1, 0]},
                        "threshold": 0.7,
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"ok": True, "chunks": ["alpha chunk"], "cosine": 0.7, "matches": []}),
                encoding="utf-8",
            )

            result = SemanticMatcherContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "cosine", "python": 0.8, "js": 0.7},
                {"key": "matches", "python": [{"term": "term-a", "chunk": "alpha chunk", "score": 1.0}], "js": []},
            ],
        )

    def test_readme_stats_builder_matches_js_timeline_contract(self):
        builder = ReadmeStatsBuilder(now=lambda: "2026-06-19T00:00:00.000Z")
        timeline = builder.build_collection_timeline(
            [
                {
                    "name": "direct",
                    "runs": [
                        {"at": "2026-06-17T10:00:00.000Z", "commentsAdded": 3},
                        {"at": "2026-06-17T11:00:00.000Z", "commentsAdded": 2},
                    ],
                    "comments": [
                        {"message": "\u8bc4\u8bba\u4e00", "source": "Bilibili public direct comment probe"},
                        {"message": "\u5f39\u5e55\u4e00", "source": "Bilibili public direct danmaku probe"},
                        {"message": "\u5f39\u5e55\u4e8c", "source": "Bilibili public direct danmaku probe"},
                        {"message": "\u8bc4\u8bba\u4e8c", "source": "Bilibili public direct comment probe"},
                        {"message": "\u8bc4\u8bba\u4e09", "source": "Bilibili public direct comment probe"},
                    ],
                },
                {
                    "name": "external",
                    "runs": [{"at": "2026-06-17T12:00:00.000Z", "addedComments": 2}],
                    "comments": [
                        {"message": "\u6570\u636e\u4e00", "source": "Kaggle dataset"},
                        {"message": "\u6570\u636e\u4e8c", "source": "Kaggle dataset"},
                    ],
                },
            ]
        )

        self.assertEqual(
            [point["date"] for point in timeline["points"]],
            [
                "2026-06-17T10:00:00.000Z",
                "2026-06-17T11:00:00.000Z",
                "2026-06-17T12:00:00.000Z",
            ],
        )
        self.assertEqual([[point["comments"], point["danmaku"]] for point in timeline["points"]], [[2, 1], [3, 2], [5, 2]])
        self.assertEqual(timeline["finalComments"], 5)
        self.assertEqual(timeline["finalDanmaku"], 2)
        self.assertEqual(builder.padded_timeline_max(179185), 200000)

    def test_readme_stats_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "stats.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "generatedAt": "2026-06-19T00:00:00.000Z",
                        "sources": [
                            {
                                "name": "direct",
                                "runs": [{"at": "2026-06-17T10:00:00.000Z", "commentsAdded": 2}],
                                "comments": [
                                    {"message": "\u91cd\u590d", "source": "comment"},
                                    {"message": "\u91cd\u590d", "source": "comment"},
                                    {"message": "\u5f39\u5e55", "source": "danmaku"},
                                    {"message": "latin only", "source": "comment"},
                                ],
                            }
                        ],
                        "dictionary": {"entries": [{"term": "doge"}, {"term": "\u67e5\u8d44\u6599"}]},
                        "coverage": {"coverage": {"coverageRatio": 0.875, "weakTerms": 4, "evidenceDeficit": 6}},
                    }
                ),
                encoding="utf-8",
            )

            result = ReadmeStatsRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["stats"]["comments"], 1)
        self.assertEqual(result["stats"]["danmaku"], 1)
        self.assertEqual(result["stats"]["keywordTerms"], 2)
        self.assertEqual(result["stats"]["coverageRatioLabel"], "87.50%")
        self.assertEqual(result["stats"]["timeline"]["finalTotal"], 2)
        self.assertEqual(result["summary"], {"comments": 1, "danmaku": 1, "keywordTerms": 2, "timelinePoints": 1})

    def test_readme_stats_contract_comparator_reports_summary_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "stats.json"
            js_report_path = root / "js-readme-stats.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "generatedAt": "2026-06-19T00:00:00.000Z",
                        "sources": [
                            {
                                "name": "direct",
                                "runs": [{"at": "2026-06-17T10:00:00.000Z", "commentsAdded": 2}],
                                "comments": [
                                    {"message": "\u8bc4\u8bba", "source": "comment"},
                                    {"message": "\u5f39\u5e55", "source": "danmaku"},
                                ],
                            }
                        ],
                        "dictionary": {"entries": [{"term": "doge"}]},
                        "coverage": {"coverageRatio": 0.5},
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"ok": True, "summary": {"comments": 2, "danmaku": 1, "keywordTerms": 1, "timelinePoints": 1}}),
                encoding="utf-8",
            )

            result = ReadmeStatsContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "summary",
                    "python": {"comments": 1, "danmaku": 1, "keywordTerms": 1, "timelinePoints": 1},
                    "js": {"comments": 2, "danmaku": 1, "keywordTerms": 1, "timelinePoints": 1},
                }
            ],
        )

    def test_deepseek_analyzer_builds_multiagent_request_plan(self):
        sentence = "\u8fd9\u53e5\u662f\u5728\u53cd\u8bbd\u5427[doge]\uff0c\u4e0d\u662f\u771f\u7684\u9a82\u4eba\u3002"
        analyzer = DeepSeekAnalyzerClient()
        request = AnalyzerRequest(comments=[sentence], multiagent=True, keyword_hints=["\u9a82\u4eba"])

        plan = analyzer.build_request_plan(request)
        merge_request = analyzer.build_merge_request(request, [{"id": "lexical-context", "name": "Lexical and emoji context analyst", "ok": True}])

        self.assertEqual(len(plan), 3)
        self.assertTrue(all(item["messages"][1]["content"].startswith("Agent role:") for item in plan))
        self.assertIn("Emoji and Bilibili bracket emotes are semantic tone markers", plan[0]["messages"][1]["content"])
        self.assertIn("keyword or emoji alone", plan[0]["messages"][1]["content"])
        self.assertIn("Merge the specialist agent outputs", merge_request["messages"][1]["content"])
        self.assertIn("quality-control agent", merge_request["messages"][0]["content"])
        self.assertIn("lexical-context", merge_request["messages"][1]["content"])

    def test_deepseek_analysis_plan_runner_reads_js_payload_contract(self):
        sentence = "\u8fd9\u53e5\u662f\u5728\u53cd\u8bbd\u5427[doge]\uff0c\u4e0d\u662f\u771f\u7684\u9a82\u4eba\u3002"
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "uid": "mid plan",
                        "name": "plan tester",
                        "text": sentence,
                        "multiagent": True,
                        "keywordHints": [{"term": "\u9a82\u4eba", "family": "attack"}],
                    }
                ),
                encoding="utf-8",
            )

            result = DeepSeekAnalysisPlanRunner(payload_path).run()

        self.assertEqual(result["mode"], "multiagent")
        self.assertEqual(len(result["requests"]), 3)
        self.assertEqual(result["merge"]["mergeAgent"], "quality-merge")
        self.assertIn(sentence, result["requests"][0]["messages"][1]["content"])

    def test_deepseek_analysis_plan_runner_accepts_utf8_bom_payloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "payload.json"
            payload_path.write_bytes(
                b"\xef\xbb\xbf"
                + json.dumps({"text": "\u72d7\u5934\u4fdd\u547d", "keywordHints": ["\u72d7\u5934"]}, ensure_ascii=False).encode("utf-8")
            )

            result = DeepSeekAnalysisPlanRunner(payload_path).run()

        self.assertEqual(result["mode"], "single")
        self.assertEqual(len(result["requests"]), 1)

    def test_deepseek_analysis_plan_contract_comparator_reports_plan_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_plan_path = root / "js-plan.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "text": "\u8fd9\u53e5\u662f\u5728\u53cd\u8bbd\u5427[doge]\uff0c\u4e0d\u662f\u771f\u7684\u9a82\u4eba\u3002",
                        "multiagent": True,
                        "keywordHints": ["\u9a82\u4eba"],
                        "model": "deepseek-v4-flash",
                    }
                ),
                encoding="utf-8",
            )
            js_plan_path.write_text(
                json.dumps(
                    {
                        "mode": "single",
                        "requests": [
                            {
                                "model": "deepseek-v4-pro",
                                "reasoning_effort": "max",
                                "max_tokens": 2000,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            result = DeepSeekAnalysisPlanContractComparator(payload_path, js_plan_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "mode", "python": "multiagent", "js": "single"},
                {"key": "requestCount", "python": 3, "js": 1},
                {"key": "requests[0].model", "python": "deepseek-v4-flash", "js": "deepseek-v4-pro"},
                {"key": "requests[0].max_tokens", "python": 1600, "js": 2000},
            ],
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

    def test_contract_comparator_rejects_manifest_run_count_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "corpus.runs").mkdir()
            corpus_path = root / "corpus.json"
            audit_path = root / "audit.json"
            corpus_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "storage": "split",
                        "comments": [{"message": "ok"}],
                        "commentCount": 1,
                        "runFiles": ["corpus.runs/runs-0001.json"],
                        "runCount": 2,
                    }
                ),
                encoding="utf-8",
            )
            (root / "corpus.runs" / "runs-0001.json").write_text(
                json.dumps({"runs": [{"at": "only-run"}]}),
                encoding="utf-8",
            )
            audit_path.write_text(
                json.dumps({"ok": False, "targetEvidence": 3, "coverage": {"terms": 1, "coverageRatio": 1}}),
                encoding="utf-8",
            )

            result = ContractComparator(corpus_path, audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "manifestRunCount", "python": 1, "js": 2}])

    def test_contract_comparator_reports_dictionary_contract_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.entries").mkdir()
            (root / "dict.evidence").mkdir()
            corpus_path = root / "corpus.json"
            audit_path = root / "audit.json"
            dictionary_path = root / "dict.json"
            corpus_path.write_text(
                json.dumps({"version": 1, "comments": [{"message": "ok"}], "runs": []}),
                encoding="utf-8",
            )
            audit_path.write_text(
                json.dumps({"ok": False, "targetEvidence": 3, "coverage": {"terms": 1, "coverageRatio": 1}}),
                encoding="utf-8",
            )
            dictionary_path.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "storage": "split",
                        "shardSize": 500,
                        "entryFiles": {"attack": ["dict.entries/attack-001.json"]},
                        "evidenceFiles": {"attack": ["dict.evidence/attack-001.json"]},
                        "families": {"attack": 1},
                    }
                ),
                encoding="utf-8",
            )
            (root / "dict.entries" / "attack-001.json").write_text(
                json.dumps({"entries": [{"term": "doge", "family": "attack", "evidenceCount": 1}]}),
                encoding="utf-8",
            )
            (root / "dict.evidence" / "attack-001.json").write_text(
                json.dumps({"evidence": [{"term": "doge", "evidenceSamples": ["doge"], "evidenceSources": [{"sample": "doge"}]}]}),
                encoding="utf-8",
            )

            result = ContractComparator(corpus_path, audit_path, dictionary_path).compare()

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["dictionary"],
            {
                "terms": 1,
                "storage": "split",
                "version": 2,
                "shardSize": 500,
                "shardMaxBytes": None,
                "evidenceStorage": "split",
                "families": {"attack": 1},
            },
        )

    def test_contract_comparator_rejects_dictionary_audit_term_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus_path = root / "corpus.json"
            audit_path = root / "audit.json"
            dictionary_path = root / "dict.json"
            corpus_path.write_text(
                json.dumps({"version": 1, "comments": [{"message": "ok"}], "runs": []}),
                encoding="utf-8",
            )
            audit_path.write_text(
                json.dumps({"ok": False, "targetEvidence": 3, "coverage": {"terms": 2, "coverageRatio": 1}}),
                encoding="utf-8",
            )
            dictionary_path.write_text(
                json.dumps({"version": 1, "entries": [{"term": "doge", "family": "attack"}]}),
                encoding="utf-8",
            )

            result = ContractComparator(corpus_path, audit_path, dictionary_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "dictionaryTerms", "python": 1, "js": 2}])

    def test_dictionary_loader_hydrates_split_entries_and_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.entries").mkdir()
            (root / "dict.evidence").mkdir()
            (root / "dict.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "storage": "split",
                        "entryFiles": {"attack": ["dict.entries/attack-001.json"]},
                        "evidenceFiles": {"attack": ["dict.evidence/attack-001.json"]},
                    }
                ),
                encoding="utf-8",
            )
            (root / "dict.entries" / "attack-001.json").write_text(
                json.dumps({"entries": [{"term": "doge", "family": "attack", "evidenceCount": 1}]}),
                encoding="utf-8",
            )
            (root / "dict.evidence" / "attack-001.json").write_text(
                json.dumps(
                    {
                        "evidence": [
                            {
                                "term": "doge",
                                "evidenceSamples": ["doge satire"],
                                "evidenceSources": [{"source": "Bilibili public video comment scan", "sample": "doge satire"}],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            dictionary = DictionaryLoader(root / "dict.json").load()

        self.assertEqual(
            dictionary.manifest,
            {
                "version": 1,
                "storage": "split",
                "shardSize": None,
                "shardMaxBytes": None,
                "evidenceStorage": "split",
                "updatedAt": None,
                "entries": [
                    {
                        "term": "doge",
                        "family": "attack",
                        "evidenceCount": 1,
                        "evidenceSamples": ["doge satire"],
                        "evidenceSources": [{"source": "Bilibili public video comment scan", "sample": "doge satire"}],
                    }
                ],
                "families": {},
            },
        )
        self.assertEqual(len(dictionary.entries), 1)
        self.assertEqual(dictionary.entries[0]["term"], "doge")
        self.assertEqual(dictionary.entries[0]["evidenceSamples"], ["doge satire"])
        self.assertEqual(dictionary.entries[0]["evidenceSources"][0]["sample"], "doge satire")

    def test_dictionary_loader_accepts_utf8_bom_split_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.entries").mkdir()
            (root / "dict.evidence").mkdir()
            (root / "dict.json").write_text(
                "\ufeff"
                + json.dumps(
                    {
                        "version": 1,
                        "storage": "split",
                        "entryFiles": {"attack": ["dict.entries/attack-001.json"]},
                        "evidenceFiles": {"attack": ["dict.evidence/attack-001.json"]},
                    }
                ),
                encoding="utf-8",
            )
            (root / "dict.entries" / "attack-001.json").write_text(
                "\ufeff" + json.dumps({"entries": [{"term": "bomTerm", "family": "attack", "evidenceCount": 1}]}),
                encoding="utf-8",
            )
            (root / "dict.evidence" / "attack-001.json").write_text(
                "\ufeff"
                + json.dumps(
                    {
                        "evidence": [
                            {
                                "term": "bomTerm",
                                "evidenceSamples": ["bom sample"],
                                "evidenceSources": [{"source": "bilibili", "sample": "bom sample"}],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            dictionary = DictionaryLoader(root / "dict.json").load()

        self.assertEqual(dictionary.entries[0]["term"], "bomTerm")
        self.assertEqual(dictionary.entries[0]["evidenceSamples"], ["bom sample"])
        self.assertEqual(dictionary.entries[0]["evidenceSources"][0]["sample"], "bom sample")

    def test_dictionary_loader_accepts_string_split_file_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.entries").mkdir()
            (root / "dict.evidence").mkdir()
            (root / "dict.json").write_text(
                json.dumps(
                    {
                        "storage": "split",
                        "entryFiles": {"attack": "dict.entries/attack-001.json"},
                        "evidenceFiles": {"attack": "dict.evidence/attack-001.json"},
                    }
                ),
                encoding="utf-8",
            )
            (root / "dict.entries" / "attack-001.json").write_text(
                json.dumps({"entries": [{"term": "doge", "family": "attack"}]}),
                encoding="utf-8",
            )
            (root / "dict.evidence" / "attack-001.json").write_text(
                json.dumps({"evidence": [{"term": "doge", "evidenceSamples": ["doge"], "evidenceSources": [{"sample": "doge"}]}]}),
                encoding="utf-8",
            )

            dictionary = DictionaryLoader(root / "dict.json").load()

        self.assertEqual(dictionary.entries[0]["term"], "doge")
        self.assertEqual(dictionary.entries[0]["evidenceSamples"], ["doge"])
        self.assertEqual(dictionary.entries[0]["evidenceSources"], [{"sample": "doge"}])

    def test_dictionary_loader_matches_js_family_bucket_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.entries").mkdir()
            (root / "dict.json").write_text(
                json.dumps(
                    {
                        "storage": "split",
                        "entryFiles": {
                            "attack": ["dict.entries/attack-001.json"],
                            "unsupported": ["dict.entries/unsupported-001.json"],
                        },
                    }
                ),
                encoding="utf-8",
            )
            (root / "dict.entries" / "attack-001.json").write_text(
                json.dumps({"entries": [{"term": "bucket-family"}]}),
                encoding="utf-8",
            )
            (root / "dict.entries" / "unsupported-001.json").write_text(
                json.dumps({"entries": [{"term": "ignored", "family": "unsupported"}]}),
                encoding="utf-8",
            )

            dictionary = DictionaryLoader(root / "dict.json").load()

        self.assertEqual([entry["term"] for entry in dictionary.entries], ["bucket-family"])
        self.assertEqual(dictionary.entries[0]["family"], "attack")

    def test_dictionary_loader_returns_js_missing_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            dictionary = DictionaryLoader(root / "missing.json").load()

        self.assertEqual(dictionary.manifest, {"version": 1, "storage": "missing", "updatedAt": None, "entries": [], "families": {}})
        self.assertEqual(dictionary.entries, [])

    def test_dictionary_loader_normalizes_monolith_manifest_like_js(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.json").write_text(
                json.dumps({"entries": [{"term": "doge", "family": "attack"}]}),
                encoding="utf-8",
            )

            dictionary = DictionaryLoader(root / "dict.json").load()

        self.assertEqual(
            dictionary.manifest,
            {
                "version": 1,
                "storage": "monolith",
                "updatedAt": None,
                "entries": [{"term": "doge", "family": "attack"}],
                "families": {},
            },
        )
        self.assertEqual(dictionary.entries, [{"term": "doge", "family": "attack"}])

    def test_dictionary_loader_merges_duplicate_split_evidence_terms(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "dict.entries").mkdir()
            (root / "dict.evidence").mkdir()
            (root / "dict.json").write_text(
                json.dumps(
                    {
                        "storage": "split",
                        "entryFiles": {"attack": ["dict.entries/attack-001.json"]},
                        "evidenceFiles": {"attack": ["dict.evidence/attack-001.json", "dict.evidence/attack-002.json"]},
                    }
                ),
                encoding="utf-8",
            )
            (root / "dict.entries" / "attack-001.json").write_text(
                json.dumps({"entries": [{"term": "doge", "family": "attack", "evidenceCount": 2}]}),
                encoding="utf-8",
            )
            (root / "dict.evidence" / "attack-001.json").write_text(
                json.dumps({"evidence": [{"term": "doge", "evidenceSamples": ["sample one"], "evidenceSources": [{"sample": "sample one"}]}]}),
                encoding="utf-8",
            )
            (root / "dict.evidence" / "attack-002.json").write_text(
                json.dumps({"evidence": [{"term": "doge", "evidenceSamples": ["sample two"], "evidenceSources": [{"sample": "sample two"}]}]}),
                encoding="utf-8",
            )

            dictionary = DictionaryLoader(root / "dict.json").load()

        self.assertEqual(dictionary.entries[0]["evidenceSamples"], ["sample one", "sample two"])
        self.assertEqual([source["sample"] for source in dictionary.entries[0]["evidenceSources"]], ["sample one", "sample two"])

    def test_huggingface_importer_reads_jsonl_conversations(self):
        importer = HuggingFaceCorpusImporter()
        rows = importer.parse_rows(
            '{"messages":[{"role":"user","content":"\u8d34\u5427\u539f\u59cb\u53d1\u8a00"},{"role":"assistant","content":"\u56de\u590d\u5ffd\u7565"}]}\n'
            '{"instruction":"\u67e5\u67e5\u8d44\u6599\u518d\u8bf4"}',
            {"dataset": "Orphanage/Baidu_Tieba_SunXiaochuan", "file": "train.jsonl", "platform": "tieba", "limit": 10},
        )

        self.assertEqual([row["message"] for row in rows], ["\u8d34\u5427\u539f\u59cb\u53d1\u8a00", "\u67e5\u67e5\u8d44\u6599\u518d\u8bf4"])
        self.assertEqual(rows[0]["platform"], "tieba")
        self.assertIn("Hugging Face dataset: Orphanage/Baidu_Tieba_SunXiaochuan/train.jsonl", rows[0]["source"])

    def test_huggingface_importer_reads_bilibili_and_tieba_csv_shapes(self):
        importer = HuggingFaceCorpusImporter()
        bilibili_rows = importer.parse_rows(
            "message,time,timestamp\n"
            "\u5341\u5468\u5e74\u5feb\u4e50,2023-06-13--18:11:16,1686679876\n"
            "\u56de\u590d @\u7528\u6237 :\u54e6\u54e6\u597d\u7684\u8c22\u8c22,2023-06-14--01:01:34,1686704494\n",
            {"dataset": "Midsummra/bilibilicomment", "file": "bilibili.csv", "platform": "bilibili", "limit": 10},
        )
        tieba_rows = importer.parse_rows(
            'title,detail,author,num_reply,href\n'
            '"\u4e3a\u4ec0\u4e48\u6709\u8fdb\u6b65\uff1f","\u56e0\u4e3a\u6709\u4e86\u843d\u540e\u7684\u6807\u51c6\u6240\u4ee5\u5c31\u6709\u4e86\u8fdb\u6b65",tester,2,https://tieba.baidu.com/p/8712791904\n',
            {"dataset": "kirp/ruozhiba-raw", "file": "wisdomBar_raw.csv", "platform": "tieba", "limit": 10},
        )

        self.assertEqual([row["message"] for row in bilibili_rows], ["\u5341\u5468\u5e74\u5feb\u4e50", "\u56de\u590d @\u7528\u6237 :\u54e6\u54e6\u597d\u7684\u8c22\u8c22"])
        self.assertEqual(bilibili_rows[0]["platform"], "bilibili")
        self.assertIn("Midsummra/bilibilicomment/bilibili.csv", bilibili_rows[0]["source"])
        self.assertIn("\u4e3a\u4ec0\u4e48\u6709\u8fdb\u6b65", tieba_rows[0]["message"])
        self.assertIn("\u843d\u540e\u7684\u6807\u51c6", tieba_rows[0]["message"])
        self.assertEqual(tieba_rows[0]["sourceUrl"], "https://tieba.baidu.com/p/8712791904")
        self.assertEqual(tieba_rows[0]["uid"], "tester")

    def test_huggingface_importer_offsets_accepted_rows_and_updates_corpus(self):
        importer = HuggingFaceCorpusImporter()
        rows = importer.parse_rows(
            "comment\nskip english\n\u7b2c\u4e00\u6761\n\u7b2c\u4e8c\u6761\n\u7b2c\u4e09\u6761\n",
            {"dataset": "sample/tieba", "file": "comments.csv", "platform": "tieba", "offset": 1, "limit": 1},
        )
        update = importer.build_update(
            {"version": 1, "comments": [{"message": "\u65e7\u8bc4\u8bba", "platform": "tieba", "sourceUrl": "hf://old"}], "runs": []},
            [
                {"message": "\u65e7\u8bc4\u8bba", "platform": "tieba", "sourceUrl": "hf://old"},
                {"message": "\u65b0\u8bc4\u8bba", "platform": "bilibili", "sourceUrl": "hf://new"},
            ],
            {"dataset": "sample/dataset", "file": "data.jsonl"},
            "2026-06-17T00:00:00.000Z",
        )

        self.assertEqual([row["message"] for row in rows], ["\u7b2c\u4e8c\u6761"])
        self.assertTrue(update["changed"])
        self.assertEqual([row["message"] for row in update["corpus"]["comments"]], ["\u65e7\u8bc4\u8bba", "\u65b0\u8bc4\u8bba"])
        self.assertEqual(update["corpus"]["runs"][0]["addedComments"], 1)

    def test_huggingface_importer_matches_js_object_value_json_parsing(self):
        importer = HuggingFaceCorpusImporter()
        single_object_rows = importer.parse_rows(
            json.dumps({"comment": "\u4e0d\u5e94\u8be5\u88ab\u5f53\u6210\u6574\u884c"}),
            {"dataset": "sample/object", "file": "data.json", "platform": "bilibili", "limit": 10},
        )
        nested_rows = importer.parse_rows(
            json.dumps({"rows": [{"comment": "\u5e94\u8be5\u88ab\u89e3\u6790"}]}),
            {"dataset": "sample/object", "file": "data.json", "platform": "bilibili", "limit": 10},
        )

        self.assertEqual(single_object_rows, [])
        self.assertEqual([row["message"] for row in nested_rows], ["\u5e94\u8be5\u88ab\u89e3\u6790"])

    def test_huggingface_import_runner_reads_raw_and_existing_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw_path = root / "rows.csv"
            existing_path = root / "existing.json"
            raw_path.write_text("message\n\u5341\u5468\u5e74\u5feb\u4e50\n", encoding="utf-8")
            existing_path.write_text(json.dumps({"version": 1, "comments": [], "runs": []}), encoding="utf-8")

            result = HuggingFaceCorpusImportRunner(
                raw_path=raw_path,
                existing_path=existing_path,
                dataset="Midsummra/bilibilicomment",
                file="bilibili.csv",
                platform="bilibili",
                generated_at="2026-06-17T00:00:00.000Z",
            ).run()

        self.assertTrue(result["changed"])
        self.assertEqual(result["importedRows"], 1)
        self.assertEqual(result["addedComments"], 1)
        self.assertEqual(result["corpus"]["comments"][0]["message"], "\u5341\u5468\u5e74\u5feb\u4e50")

    def test_huggingface_import_contract_comparator_reports_corpus_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            raw_path = root / "rows.csv"
            existing_path = root / "existing.json"
            js_report_path = root / "js-huggingface-import.json"
            raw_path.write_text("message\n\u5341\u5468\u5e74\u5feb\u4e50\n", encoding="utf-8")
            existing_path.write_text(json.dumps({"version": 1, "comments": [], "runs": []}), encoding="utf-8")
            js_report_path.write_text(
                json.dumps(
                    {
                        "ok": True,
                        "importedRows": 1,
                        "changed": True,
                        "addedComments": 0,
                    }
                ),
                encoding="utf-8",
            )

            result = HuggingFaceCorpusImportContractComparator(
                raw_path=raw_path,
                existing_path=existing_path,
                dataset="Midsummra/bilibilicomment",
                file="bilibili.csv",
                platform="bilibili",
                js_report_path=js_report_path,
                generated_at="2026-06-17T00:00:00.000Z",
            ).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "addedComments", "python": 1, "js": 0}])
        self.assertEqual(result["python"]["summary"], {"importedRows": 1, "changed": True, "addedComments": 1})
        self.assertEqual(result["js"]["summary"], {"importedRows": 1, "changed": True, "addedComments": 0})

    def test_local_corpus_flattener_reads_uid_maps_and_plain_text(self):
        flattener = LocalCorpusFlattener()

        uid_comments = flattener.flatten(
            {
                "100": [
                    {"message": "\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u5c55\u5f00\u4e86", "uname": "u1", "bvid": "BVabc"},
                    {"message": "", "uname": "u2", "bvid": "BVempty"},
                ]
            }
        )
        plain_comments = flattener.flatten(["discover: HTTP 403 from https://tieba.baidu.com/f?kw=dog", "\u67e5\u67e5\u8d44\u6599\u518d\u8bf4"])

        self.assertEqual(
            uid_comments,
            [
                {
                    "message": "\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u5c55\u5f00\u4e86",
                    "platform": "bilibili",
                    "source": "Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVabc/",
                    "uid": "BVabc",
                    "uname": "u1",
                }
            ],
        )
        self.assertEqual([comment["message"] for comment in plain_comments], ["\u67e5\u67e5\u8d44\u6599\u518d\u8bf4"])

    def test_local_corpus_flattener_reads_aicu_and_scraped_user_shapes(self):
        flattener = LocalCorpusFlattener()
        comments = flattener.flatten(
            {
                "users": {
                    "123": {
                        "comments": [{"message": "\u767e\u5ea6\u4e00\u4e0b\u5c31\u77e5\u9053\u4e86", "oid": "9988"}],
                        "danmaku": [{"content": "\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f", "oid": "7766"}],
                    },
                    "860": {
                        "uid": "860",
                        "uname": "sample-user",
                        "commentText": "first comment\nsecond comment",
                        "bvids": ["BVone", "BVtwo"],
                    },
                }
            }
        )

        self.assertIn(
            {
                "message": "\u767e\u5ea6\u4e00\u4e0b\u5c31\u77e5\u9053\u4e86",
                "platform": "bilibili",
                "source": "Bilibili local AICU corpus: https://www.bilibili.com/video/av9988/",
                "uid": "123",
                "uname": "",
            },
            comments,
        )
        self.assertIn(
            {
                "message": "second comment",
                "platform": "bilibili",
                "source": "Bilibili local scraped user corpus: https://www.bilibili.com/video/BVtwo/",
                "uid": "860",
                "uname": "sample-user",
            },
            comments,
        )

    def test_local_corpus_flattener_reads_tieba_runs_and_direct_comments(self):
        flattener = LocalCorpusFlattener()
        tieba_comments = flattener.flatten(
            {
                "version": 1,
                "runs": [
                    {
                        "results": [
                            {
                                "comments": [
                                    {
                                        "message": "\u72d7\u53bb\u54ea\u91cc\u4e86: discover: HTTP 403 from https://tieba.baidu.com/mo/q/m?kw=dog",
                                        "sourceUrl": "https://tieba.baidu.com/f?kw=dog",
                                        "platform": "tieba",
                                    },
                                    {
                                        "message": "\u771f\u4eba\u56e2 \u63a5\u63a5\u63a5",
                                        "sourceUrl": "https://tieba.baidu.com/p/10792024244",
                                        "platform": "tieba",
                                    },
                                ]
                            }
                        ]
                    }
                ],
            }
        )
        direct_comments = flattener.flatten(
            {
                "version": 1,
                "comments": [
                    {
                        "message": "\u76f4\u63a5\u63a2\u6d4b\u8bc4\u8bba",
                        "source": "Bilibili public direct comment probe: https://www.bilibili.com/video/BVprobe/",
                        "uid": "123",
                    }
                ],
                "runs": [{"at": "2026-06-17T00:00:00.000Z", "commentsCollected": 1}],
            }
        )

        self.assertEqual([comment["message"] for comment in tieba_comments], ["\u771f\u4eba\u56e2 \u63a5\u63a5\u63a5"])
        self.assertEqual(tieba_comments[0]["source"], "Tieba public thread scan: https://tieba.baidu.com/p/10792024244")
        self.assertEqual(direct_comments[0]["source"], "Bilibili public direct comment probe: https://www.bilibili.com/video/BVprobe/")

    def test_local_corpus_flatten_runner_reads_json_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_path = root / "local.json"
            input_path.write_text(
                json.dumps({"_uidComments": {"42": [{"message": "alpha phrase appears here", "uname": "tester", "bvid": "BVprogress"}]}}),
                encoding="utf-8",
            )

            result = LocalCorpusFlattenRunner(input_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["comments"][0]["uid"], "BVprogress")

    def test_local_corpus_flatten_contract_comparator_reports_comment_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            input_path = root / "local.json"
            js_report_path = root / "js-flatten.json"
            input_path.write_text(
                json.dumps({"_uidComments": {"42": [{"message": "alpha phrase appears here", "uname": "tester", "bvid": "BVprogress"}]}}),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"count": 0, "comments": []}),
                encoding="utf-8",
            )

            result = LocalCorpusFlattenContractComparator(input_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "count", "python": 1, "js": 0},
                {
                    "key": "comments",
                    "python": [
                        {
                            "message": "alpha phrase appears here",
                            "platform": "bilibili",
                            "source": "Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVprogress/",
                            "uid": "BVprogress",
                            "uname": "tester",
                        }
                    ],
                    "js": [],
                },
            ],
        )

    def test_local_corpus_evidence_finder_selects_weak_and_strict_comment_backed_terms(self):
        finder = LocalCorpusEvidenceFinder()
        dictionary = {
            "entries": [
                {"term": "\u61c2\u7684\u90fd\u61c2", "family": "evasion", "evidenceCount": 2},
                {"term": "\u67e5\u67e5\u8d44\u6599", "family": "evidence", "evidenceCount": 3},
                {
                    "term": "\u4e0a\u4e0b\u6587\u8bcd",
                    "family": "attack",
                    "evidenceCount": 3,
                    "evidenceSources": [
                        {"source": "search-discovered video context", "sample": "Bilibili video context: \u4e0a\u4e0b\u6587\u8bcd"},
                        {"source": "search-discovered video context", "sample": "Bilibili public video title: \u4e0a\u4e0b\u6587\u8bcd"},
                        {"source": "Bilibili local corpus", "sample": "\u666e\u901a\u6837\u672c\u4e0a\u4e0b\u6587\u8bcd"},
                    ],
                },
            ]
        }

        weak = finder.build_weak_term_set(dictionary, {"targetEvidence": 3})
        strict = finder.build_weak_term_set(dictionary, {"targetEvidence": 3, "targetTerms": ["\u67e5\u67e5\u8d44\u6599"], "requireCommentBackedEvidence": True})

        self.assertEqual(list(weak.keys()), ["\u61c2\u7684\u90fd\u61c2"])
        self.assertEqual(list(strict.keys()), ["\u61c2\u7684\u90fd\u61c2", "\u67e5\u67e5\u8d44\u6599", "\u4e0a\u4e0b\u6587\u8bcd"])

    def test_local_corpus_evidence_finder_creates_merge_ready_entries(self):
        dictionary = {
            "entries": [
                {
                    "term": "\u61c2\u7684\u90fd\u61c2",
                    "family": "evasion",
                    "meaning": "\u6697\u793a\u5f0f\u56de\u907f",
                    "evidenceCount": 1,
                    "evidenceSamples": ["\u65e7\u6837\u672c\u61c2\u7684\u90fd\u61c2"],
                },
                {"term": "\u5403\u76f8\u592a\u96be\u770b", "family": "attack", "evidenceCount": 0},
                {"term": "\u67e5\u67e5\u8d44\u6599", "family": "evidence", "evidenceCount": 3},
            ]
        }
        comments = [
            {
                "message": "\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u5c55\u5f00\u4e86",
                "source": "Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV1/",
                "uid": "BV1",
            },
            {
                "message": "\u65e7\u6837\u672c\u61c2\u7684\u90fd\u61c2",
                "source": "Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV2/",
                "uid": "BV2",
            },
            {
                "message": "\u8fd9\u5403\u76f8\u96be\u770b\u5230\u79bb\u8c31",
                "source": "Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV3/",
                "uid": "BV3",
            },
            {
                "message": "\u5efa\u8bae\u5148\u67e5\u67e5\u8d44\u6599",
                "source": "Bilibili local UID discovery corpus: https://www.bilibili.com/video/BV4/",
                "uid": "BV4",
            },
        ]

        entries = LocalCorpusEvidenceFinder().find_entries(dictionary, comments, {"targetEvidence": 3, "maxSamplesPerTerm": 2})

        self.assertEqual([entry["term"] for entry in entries], ["\u61c2\u7684\u90fd\u61c2", "\u5403\u76f8\u592a\u96be\u770b"])
        self.assertEqual(entries[0]["evidence"], ["\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u5c55\u5f00\u4e86"])
        self.assertEqual(entries[0]["evidenceSources"][0]["uid"], "BV1")
        self.assertEqual(entries[1]["evidence"], ["\u8fd9\u5403\u76f8\u96be\u770b\u5230\u79bb\u8c31"])

    def test_local_corpus_evidence_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            comments_path = root / "comments.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "\u61c2\u7684\u90fd\u61c2", "family": "evasion", "meaning": "\u6697\u793a", "evidenceCount": 0}]}),
                encoding="utf-8",
            )
            comments_path.write_text(
                json.dumps({"comments": [{"message": "\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2", "source": "local", "uid": "42"}]}),
                encoding="utf-8",
            )

            result = LocalCorpusEvidenceRunner(dictionary_path, comments_path, target_evidence=3, max_samples_per_term=1).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entries"][0]["term"], "\u61c2\u7684\u90fd\u61c2")

    def test_local_corpus_evidence_contract_comparator_reports_entry_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            comments_path = root / "comments.json"
            js_report_path = root / "js-report.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "\u61c2\u7684\u90fd\u61c2", "family": "evasion", "meaning": "\u6697\u793a", "evidenceCount": 0}]}),
                encoding="utf-8",
            )
            comments_path.write_text(
                json.dumps({"comments": [{"message": "\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2", "source": "local", "uid": "42"}]}),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"count": 1, "entries": [{"term": "wrong", "evidence": ["wrong sample"]}]}),
                encoding="utf-8",
            )

            result = LocalCorpusEvidenceContractComparator(
                dictionary_path,
                comments_path,
                js_report_path,
                target_evidence=3,
                max_samples_per_term=1,
            ).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "terms", "python": ["\u61c2\u7684\u90fd\u61c2"], "js": ["wrong"]},
                {"key": "evidence", "python": {"\u61c2\u7684\u90fd\u61c2": ["\u8fd9\u4e8b\u61c2\u7684\u90fd\u61c2"]}, "js": {"wrong": ["wrong sample"]}},
            ],
        )

    def test_tieba_corpus_updater_leaves_corpus_unchanged_without_comments(self):
        existing = {
            "version": 1,
            "updatedAt": "2026-06-17T00:00:00.000Z",
            "runs": [{"at": "2026-06-17T00:00:00.000Z"}],
            "comments": [{"message": "\u65e7\u8bc4\u8bba", "sourceUrl": "https://tieba.baidu.com/p/1", "rpid": "tieba-1"}],
        }
        blocked_run = {
            "at": "2026-06-17T01:00:00.000Z",
            "queries": ["\u5fb7\u91cc\u4e0d\u9965\u4eba"],
            "results": [{"query": "\u5fb7\u91cc\u4e0d\u9965\u4eba", "comments": [], "warnings": ["Tieba safety verification page returned"]}],
        }

        update = TiebaCorpusUpdater().build_update(existing, blocked_run, "2026-06-17T01:00:00.000Z")

        self.assertFalse(update["changed"])
        self.assertEqual(update["corpus"], existing)
        self.assertEqual(update["newComments"], [])

    def test_tieba_corpus_updater_dedupes_comments_and_limits_runs(self):
        existing = {
            "version": 1,
            "updatedAt": "2026-06-17T00:00:00.000Z",
            "runs": [{"at": f"old-{index}"} for index in range(55)],
            "comments": [{"message": "\u65e7\u8bc4\u8bba", "sourceUrl": "https://tieba.baidu.com/p/1", "rpid": "tieba-1"}],
        }
        run = {
            "at": "2026-06-17T02:00:00.000Z",
            "results": [
                {
                    "comments": [
                        {"message": "\u65e7\u8bc4\u8bba", "sourceUrl": "https://tieba.baidu.com/p/1", "rpid": "tieba-1"},
                        {"message": "\u65b0\u8bc4\u8bba", "sourceUrl": "https://tieba.baidu.com/p/2", "rpid": "tieba-2"},
                        {"message": "", "sourceUrl": "https://tieba.baidu.com/p/empty", "rpid": "tieba-empty"},
                    ]
                }
            ],
        }

        update = TiebaCorpusUpdater().build_update(existing, run, "2026-06-17T02:00:00.000Z")

        self.assertTrue(update["changed"])
        self.assertEqual([comment["message"] for comment in update["corpus"]["comments"]], ["\u65e7\u8bc4\u8bba", "\u65b0\u8bc4\u8bba"])
        self.assertEqual([comment["message"] for comment in update["newComments"]], ["\u65e7\u8bc4\u8bba", "\u65b0\u8bc4\u8bba", ""])
        self.assertEqual(len(update["corpus"]["runs"]), 50)
        self.assertEqual(update["corpus"]["runs"][0]["at"], "old-6")
        self.assertEqual(update["corpus"]["updatedAt"], "2026-06-17T02:00:00.000Z")

    def test_tieba_corpus_update_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            existing_path = root / "tieba.json"
            run_path = root / "run.json"
            existing_path.write_text(json.dumps({"version": 1, "runs": [], "comments": []}), encoding="utf-8")
            run_path.write_text(
                json.dumps({"at": "2026-06-17T02:00:00.000Z", "results": [{"comments": [{"message": "\u65b0\u8bc4\u8bba", "sourceUrl": "https://tieba.baidu.com/p/2"}]}]}),
                encoding="utf-8",
            )

            result = TiebaCorpusUpdateRunner(existing_path, run_path, generated_at="2026-06-17T02:00:00.000Z").run()

        self.assertTrue(result["changed"])
        self.assertEqual(result["corpus"]["comments"][0]["message"], "\u65b0\u8bc4\u8bba")

    def test_tieba_corpus_update_contract_comparator_reports_update_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            existing_path = root / "tieba.json"
            run_path = root / "run.json"
            js_report_path = root / "js-tieba-update.json"
            existing_path.write_text(json.dumps({"version": 1, "runs": [], "comments": []}), encoding="utf-8")
            run_path.write_text(
                json.dumps({"at": "2026-06-17T02:00:00.000Z", "results": [{"comments": [{"message": "new tieba comment", "sourceUrl": "https://tieba.baidu.com/p/2"}]}]}),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"changed": False, "newComments": [], "corpus": {"version": 1, "runs": [], "comments": []}}),
                encoding="utf-8",
            )

            result = TiebaCorpusUpdateContractComparator(
                existing_path,
                run_path,
                js_report_path,
                generated_at="2026-06-17T02:00:00.000Z",
            ).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "changed", "python": True, "js": False},
                {"key": "newComments", "python": [{"message": "new tieba comment", "sourceUrl": "https://tieba.baidu.com/p/2"}], "js": []},
                {
                    "key": "corpus",
                    "python": {
                        "version": 1,
                        "updatedAt": "2026-06-17T02:00:00.000Z",
                        "runs": [
                            {
                                "at": "2026-06-17T02:00:00.000Z",
                                "results": [{"comments": [{"message": "new tieba comment", "sourceUrl": "https://tieba.baidu.com/p/2"}]}],
                            }
                        ],
                        "comments": [{"message": "new tieba comment", "sourceUrl": "https://tieba.baidu.com/p/2"}],
                    },
                    "js": {"version": 1, "runs": [], "comments": []},
                },
            ],
        )

    def test_tieba_scrape_timing_matches_js_hard_stop_contract(self):
        timing = TiebaScrapeTiming()

        self.assertEqual(
            timing.compute_hard_stop_ms({"maxQueries": 4, "overallTimeoutMs": 30000, "blockCooldownMs": 120000}),
            610000,
        )
        self.assertEqual(timing.compute_hard_stop_ms({"maxQueries": 0, "overallTimeoutMs": 30000, "blockCooldownMs": 120000}), 160000)
        self.assertEqual(timing.compute_hard_stop_ms({"maxQueries": 2, "overallTimeoutMs": -1, "blockCooldownMs": -5}), 10000)

    def test_tieba_timing_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps({"maxQueries": 4, "overallTimeoutMs": 30000, "blockCooldownMs": 120000}),
                encoding="utf-8",
            )

            result = TiebaTimingRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["hardStopMs"], 610000)

    def test_tieba_timing_contract_comparator_reports_hard_stop_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-timing.json"
            payload_path.write_text(
                json.dumps({"maxQueries": 4, "overallTimeoutMs": 30000, "blockCooldownMs": 120000}),
                encoding="utf-8",
            )
            js_report_path.write_text(json.dumps({"hardStopMs": 600000}), encoding="utf-8")

            result = TiebaTimingContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "hardStopMs", "python": 610000, "js": 600000}])

    def test_direct_probe_builder_collects_replies_and_danmaku(self):
        builder = DirectProbeCorpusBuilder()

        replies = builder.collect_reply_messages(
            [
                {
                    "mid": 100,
                    "content": {"message": "top level comment"},
                    "replies": [{"member": {"mid": 200}, "content": {"message": "nested comment"}}],
                }
            ],
            {"bvid": "BVdirect"},
        )
        danmaku = builder.collect_danmaku_messages("<d> \u67e5&amp;\u67e5\u8d44\u6599 </d><d> </d>", {"aid": "12345"})

        self.assertEqual(
            replies,
            [
                {
                    "message": "top level comment",
                    "uid": "100",
                    "source": "Bilibili public direct comment probe: https://www.bilibili.com/video/BVdirect/",
                },
                {
                    "message": "nested comment",
                    "uid": "200",
                    "source": "Bilibili public direct comment probe: https://www.bilibili.com/video/BVdirect/",
                },
            ],
        )
        self.assertEqual(
            danmaku,
            [
                {
                    "message": "\u67e5&\u67e5\u8d44\u6599",
                    "uid": "12345",
                    "source": "Bilibili public direct danmaku probe: https://www.bilibili.com/video/av12345/",
                }
            ],
        )

    def test_direct_probe_builder_extracts_fresh_evidence_entries(self):
        dictionary = {
            "entries": [
                {
                    "term": "\u67e5\u67e5\u8d44\u6599",
                    "family": "evidence",
                    "meaning": "asks for verification",
                    "evidenceCount": 1,
                    "evidenceSamples": ["\u65e7\u6837\u672c\u67e5\u67e5\u8d44\u6599"],
                },
                {"term": "\u5403\u76f8\u592a\u96be\u770b", "family": "attack", "evidenceCount": 0},
                {"term": "\u5df2\u7ecf\u591f\u4e86", "family": "evasion", "evidenceCount": 3},
            ]
        }
        comments = [
            {"message": "\u65e7\u6837\u672c\u67e5\u67e5\u8d44\u6599", "source": "duplicate"},
            {"message": "\u5efa\u8bae\u5148\u67e5\u67e5\u8d44\u6599\u518d\u8bc4\u8bba", "source": "fresh source", "uid": "42"},
            {"message": "\u8fd9\u5403\u76f8\u96be\u770b\u5230\u79bb\u8c31", "source": "alias source", "uid": "43"},
            {"message": "\u5df2\u7ecf\u591f\u4e86\u5427", "source": "complete"},
        ]

        entries = DirectProbeCorpusBuilder().build_fresh_evidence_entries(dictionary, comments)

        self.assertEqual([entry["term"] for entry in entries], ["\u67e5\u67e5\u8d44\u6599", "\u5403\u76f8\u592a\u96be\u770b"])
        self.assertEqual(entries[0]["evidence"], ["\u5efa\u8bae\u5148\u67e5\u67e5\u8d44\u6599\u518d\u8bc4\u8bba"])
        self.assertEqual(entries[1]["evidence"], ["\u8fd9\u5403\u76f8\u96be\u770b\u5230\u79bb\u8c31"])

    def test_direct_probe_builder_builds_probe_corpus_with_han_dedupe(self):
        existing = {
            "version": 2,
            "comments": [
                {"message": "\u65e7\u8bc4\u8bba", "source": "old", "uid": "1"},
                {"message": "plain ascii should be dropped", "source": "old", "uid": "2"},
            ],
            "runs": [{"at": "old-run"}],
        }
        comments = [
            {"message": "\u65e7\u8bc4\u8bba", "source": "duplicate", "uid": "1"},
            {"message": "\u65b0\u5f39\u5e55\u8bc4\u8bba", "source": "fresh", "uid": "BV1"},
            {"message": "ascii only", "source": "skip", "uid": "3"},
        ]
        run = {"at": "2026-06-18T00:00:00.000Z", "videos": [{"bvid": "BV1"}]}

        corpus = DirectProbeCorpusBuilder().build_probe_corpus(existing, comments, run)

        self.assertEqual(corpus["version"], 2)
        self.assertEqual([comment["message"] for comment in corpus["comments"]], ["\u65e7\u8bc4\u8bba", "\u65b0\u5f39\u5e55\u8bc4\u8bba"])
        self.assertEqual(corpus["runs"][-1]["commentsCollected"], 3)
        self.assertEqual(corpus["runs"][-1]["commentsAdded"], 1)
        self.assertEqual(corpus["updatedAt"], "2026-06-18T00:00:00.000Z")

    def test_direct_probe_corpus_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            existing_path = root / "existing.json"
            comments_path = root / "comments.json"
            run_path = root / "run.json"
            existing_path.write_text(json.dumps({"version": 1, "comments": [], "runs": []}), encoding="utf-8")
            comments_path.write_text(json.dumps({"comments": [{"message": "\u65b0\u8bc4\u8bba", "source": "fresh", "uid": "9"}]}), encoding="utf-8")
            run_path.write_text(json.dumps({"at": "2026-06-18T01:00:00.000Z"}), encoding="utf-8")

            result = DirectProbeCorpusRunner(existing_path, comments_path, run_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["corpus"]["comments"][0]["message"], "\u65b0\u8bc4\u8bba")
        self.assertEqual(result["corpus"]["runs"][0]["commentsAdded"], 1)

    def test_direct_probe_corpus_contract_comparator_reports_corpus_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            existing_path = root / "existing.json"
            comments_path = root / "comments.json"
            run_path = root / "run.json"
            js_report_path = root / "js-report.json"
            existing_path.write_text(json.dumps({"version": 1, "comments": [], "runs": []}), encoding="utf-8")
            comments_path.write_text(
                json.dumps({"comments": [{"message": "\u65b0\u8bc4\u8bba", "source": "fresh", "uid": "9"}]}),
                encoding="utf-8",
            )
            run_path.write_text(json.dumps({"at": "2026-06-18T01:00:00.000Z", "query": "\u65b0"}), encoding="utf-8")
            js_report_path.write_text(
                json.dumps(
                    {
                        "corpus": {
                            "comments": [{"message": "\u8def\u8fc7", "source": "wrong", "uid": "2"}],
                            "runs": [{"query": "wrong", "commentsAdded": 0}],
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = DirectProbeCorpusContractComparator(existing_path, comments_path, run_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "commentMessages", "python": ["\u65b0\u8bc4\u8bba"], "js": ["\u8def\u8fc7"]},
                {"key": "runQueries", "python": ["\u65b0"], "js": ["wrong"]},
                {"key": "runCommentsAdded", "python": [1], "js": [0]},
            ],
        )

    def test_direct_probe_builder_plans_search_and_video_rescans(self):
        builder = DirectProbeCorpusBuilder()

        self.assertEqual(builder.bounded_probe_videos_per_query("0", 5), 0)
        self.assertEqual(builder.bounded_probe_videos_per_query("25", 5), 20)
        self.assertEqual(builder.bounded_probe_videos_per_query("bad", 5), 5)
        self.assertEqual(builder.bounded_reply_cursor_skip_pages("200", 3), 20)
        self.assertEqual(builder.probe_search_needles({"term": "\u8d85\u7edd\u65e0\u8bed", "query": "\u8d85\u7edd\u65e0\u8bed \u8bc4\u8bba\u56de\u590d"}), ["\u8d85\u7edd\u65e0\u8bed"])
        self.assertEqual(
            [video["bvid"] for video in builder.rank_probe_videos_for_action(
                [
                    {"bvid": "BVnoise", "title": "\u70ed\u95e8\u56de\u590d\u5408\u96c6"},
                    {"bvid": "BVexact", "title": "\u8d85\u7edd\u65e0\u8bed\u7684\u4e00\u96c6"},
                    {"bvid": "BVother", "title": "\u666e\u901a\u8bc4\u8bba\u533a\u53cd\u5e94"},
                ],
                {"term": "\u8d85\u7edd\u65e0\u8bed", "query": "\u8d85\u7edd\u65e0\u8bed \u8bc4\u8bba\u56de\u590d"},
            )],
            ["BVexact", "BVnoise", "BVother"],
        )
        self.assertEqual(
            builder.extract_bilibili_video_refs(
                "https://www.bilibili.com/video/BV1abc/ and http://www.bilibili.com/video/av123 plus https://www.bilibili.com/video/BV1abc/"
            ),
            [{"bvid": "BV1abc"}, {"aid": "123"}],
        )
        self.assertEqual(
            builder.extract_bilibili_video_refs(
                "Bilibili public reply detail probe: https://www.bilibili.com/video/av116663559131570/?reply=301234384593"
            ),
            [{"aid": "116663559131570", "rootRpid": "301234384593"}],
        )
        self.assertEqual(builder.probe_video_key({"bvid": "BVsource1/"}), "bvid:BVsource1")
        self.assertEqual(builder.probe_video_key({"aid": "av456"}), "aid:456")
        self.assertEqual(builder.collect_scanned_probe_video_keys({"runs": [{"videos": [{"bvid": "BVrun"}, {"key": "aid:123"}]}]}), ["aid:123", "bvid:BVrun"])
        self.assertEqual(
            builder.filter_unscanned_probe_videos([{"bvid": "BVold"}, {"bvid": "BVfresh"}, {"bvid": "BVfresh"}, {"aid": "321"}], {"bvid:BVold"}),
            [{"bvid": "BVfresh"}, {"aid": "321"}],
        )

    def test_direct_probe_plan_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "probe-plan.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "action": {"term": "\u67e5\u67e5\u8d44\u6599", "query": "\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba"},
                        "videos": [{"bvid": "BVnoise", "title": "\u70ed\u95e8\u56de\u590d"}, {"bvid": "BVexact", "title": "\u67e5\u67e5\u8d44\u6599\u5408\u96c6"}],
                        "source": "https://www.bilibili.com/video/av116663559131570/?reply=301234384593",
                        "cursorPayload": {"data": {"cursor": {"is_end": False, "next": 0}}},
                    }
                ),
                encoding="utf-8",
            )

            result = DirectProbePlanRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["needles"], ["\u67e5\u67e5\u8d44\u6599"])
        self.assertEqual([video["bvid"] for video in result["rankedVideos"]], ["BVexact", "BVnoise"])
        self.assertEqual(result["sourceRefs"], [{"aid": "116663559131570", "rootRpid": "301234384593"}])
        self.assertEqual(result["nextReplyCursor"], 1)
        self.assertEqual(result["viewUrl"], "https://api.bilibili.com/x/web-interface/view?aid=116663559131570")
        self.assertIn("keyword=%E6%9F%A5%E6%9F%A5%E8%B5%84%E6%96%99+B%E7%AB%99%E8%AF%84%E8%AE%BA", result["searchUrls"][0])

    def test_direct_probe_plan_contract_comparator_reports_plan_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "probe-plan.json"
            js_plan_path = root / "js-probe-plan.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "action": {"term": "\u67e5\u67e5\u8d44\u6599", "query": "\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba"},
                        "source": "https://www.bilibili.com/video/av116663559131570/?reply=301234384593",
                        "cursorPayload": {"data": {"cursor": {"is_end": False, "next": 0}}},
                    }
                ),
                encoding="utf-8",
            )
            js_plan_path.write_text(
                json.dumps(
                    {
                        "nextReplyCursor": 2,
                        "viewUrl": "https://api.bilibili.com/x/web-interface/view?aid=wrong",
                        "searchUrls": ["https://api.bilibili.com/x/web-interface/search/type?keyword=wrong"],
                    }
                ),
                encoding="utf-8",
            )

            result = DirectProbePlanContractComparator(payload_path, js_plan_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "nextReplyCursor", "python": 1, "js": 2},
                {
                    "key": "viewUrl",
                    "python": "https://api.bilibili.com/x/web-interface/view?aid=116663559131570",
                    "js": "https://api.bilibili.com/x/web-interface/view?aid=wrong",
                },
                {
                    "key": "searchUrls",
                    "python": ["https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%9F%A5%E6%9F%A5%E8%B5%84%E6%96%99+B%E7%AB%99%E8%AF%84%E8%AE%BA&page=1&page_size=20"],
                    "js": ["https://api.bilibili.com/x/web-interface/search/type?keyword=wrong"],
                },
            ],
        )

    def test_direct_probe_builder_creates_browser_identity_contract(self):
        builder = DirectProbeCorpusBuilder()

        cookie = builder.make_synthetic_bilibili_cookie(random_fn=lambda: 0.5, now_ms=1700000000000)
        headers = builder.build_bilibili_web_headers("https://search.bilibili.com/all?keyword=x", {"cookie": "a=b"})

        self.assertEqual(
            cookie,
            "buvid3=88888888-8888-8888-8888-8888888888888infoc; "
            "buvid4=88888888-8888-8888-8888-888888888888-1700000000-1; "
            "b_nut=1700000000; "
            "_uuid=88888888-8888-8888-8888-888888888888888infoc; "
            "b_lsid=88888888_8888888888",
        )
        self.assertEqual(headers["origin"], "https://search.bilibili.com")
        self.assertEqual(headers["cookie"], "a=b")
        self.assertIn("Chrome/125.0.0.0", headers["user-agent"])
        self.assertEqual(headers["sec-fetch-site"], "same-site")

    def test_direct_probe_plan_runner_exposes_browser_identity_json_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "referer": "https://search.bilibili.com/all?keyword=x",
                        "cookie": "a=b",
                        "syntheticCookie": {"randomValue": 0.5, "nowMs": 1700000000000},
                    }
                ),
                encoding="utf-8",
            )

            result = DirectProbePlanRunner(payload_path).run()

        self.assertEqual(result["headers"]["origin"], "https://search.bilibili.com")
        self.assertEqual(result["headers"]["cookie"], "a=b")
        self.assertEqual(
            result["syntheticCookie"],
            DirectProbeCorpusBuilder().make_synthetic_bilibili_cookie(random_fn=lambda: 0.5, now_ms=1700000000000),
        )

    def test_direct_probe_builder_recovers_existing_evidence_source_videos(self):
        builder = DirectProbeCorpusBuilder()

        direct = builder.build_evidence_source_videos_for_actions(
            {
                "entries": [
                    {
                        "term": "rare-term",
                        "evidenceSources": [
                            {"source": "https://www.bilibili.com/video/BVsource1/ https://www.bilibili.com/video/av456"},
                            {"source": "https://www.bilibili.com/video/BVsource2/"},
                        ],
                    },
                    {"term": "other-term", "evidenceSources": [{"source": "https://www.bilibili.com/video/BVother/"}]},
                ]
            },
            [{"term": "rare-term", "query": "rare-term comments"}],
            {"maxPerAction": 2},
        )
        recovered = builder.build_evidence_source_videos_for_actions(
            {
                "entries": [
                    {
                        "term": "uid-only-term",
                        "evidenceSamples": ["corpus backed sample"],
                        "evidenceSources": [
                            {
                                "source": "Popular video comments UID 123 (1 comments from 1 videos)",
                                "sample": "corpus backed sample",
                            }
                        ],
                    }
                ]
            },
            [{"term": "uid-only-term", "query": "uid-only-term comments"}],
            {
                "maxPerAction": 2,
                "corpus": {
                    "comments": [
                        {
                            "message": "corpus backed sample",
                            "source": "Bilibili public direct comment probe: https://www.bilibili.com/video/BVfromCorpus/",
                        },
                        {
                            "message": "corpus backed sample",
                            "source": "Bilibili public reply detail probe: https://www.bilibili.com/video/av987654/?reply=112233",
                        },
                    ]
                },
            },
        )

        self.assertEqual(
            direct,
            {
                "rare-term": [
                    {"bvid": "BVsource1", "title": "existing evidence source for rare-term"},
                    {"aid": "456", "title": "existing evidence source for rare-term"},
                ]
            },
        )
        self.assertEqual(
            recovered,
            {
                "uid-only-term": [
                    {"aid": "987654", "rootRpid": "112233", "title": "existing evidence source for uid-only-term"}
                ]
            },
        )

    def test_history_tag_corpus_manager_merges_and_searches_videos(self):
        manager = HistoryTagCorpusManager(generated_at="2026-06-19T00:00:00.000Z")
        merged = manager.merge(
            {
                "tags": [{"name": "\u5386\u53f2", "source": "seed"}],
                "videos": [{"bvid": "BVhistory001", "title": "\u4e7e\u9686\u8001\u513f", "tags": ["\u5386\u53f2"], "replyCount": 1}],
                "runs": [],
            },
            {
                "tags": [{"name": "\u6e05\u671d", "source": "seed"}],
                "videos": [
                    {"bvid": "BVhistory001", "title": "\u4e7e\u9686\u8001\u513f\u5386\u53f2\u590d\u76d8", "tags": ["\u6e05\u671d", "\u5386\u53f2"], "replyCount": 99},
                    {"bvid": "BVhistory002", "title": "\u666e\u901a\u5a31\u4e50\u89c6\u9891", "tags": ["\u5a31\u4e50"], "replyCount": 100},
                ],
                "runs": [{"at": "now"}],
            },
        )

        matches = manager.videos_for_search(merged, ["\u4e7e\u9686\u8001\u513f \u8bc4\u8bba\u533a"], ["\u4e7e\u9686\u8001\u513f"], 5)

        self.assertEqual(merged["updatedAt"], "2026-06-19T00:00:00.000Z")
        self.assertEqual(len(merged["videos"]), 2)
        self.assertEqual(merged["videos"][0]["replyCount"], 1)
        self.assertEqual([video["bvid"] for video in matches], ["BVhistory001"])
        self.assertEqual(matches[0]["source"], "bilibili-history-tags")

    def test_history_tag_corpus_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            current_path = root / "current.json"
            update_path = root / "update.json"
            current_path.write_text(json.dumps({"tags": [], "videos": [], "runs": []}), encoding="utf-8")
            update_path.write_text(
                json.dumps(
                    {
                        "tags": [{"name": "\u5386\u53f2"}],
                        "videos": [{"bvid": "BVhistory", "aid": 100, "title": "<em>\u5386\u53f2</em>\u89c6\u9891", "tags": "\u5386\u53f2,\u6e05\u671d"}],
                        "runs": [{"at": "run"}],
                    }
                ),
                encoding="utf-8",
            )

            result = HistoryTagCorpusRunner(current_path, update_path, generated_at="2026-06-19T01:00:00.000Z").run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["corpus"]["updatedAt"], "2026-06-19T01:00:00.000Z")
        self.assertEqual(result["corpus"]["videos"][0]["title"], "\u5386\u53f2\u89c6\u9891")
        self.assertEqual(result["corpus"]["videos"][0]["tags"], ["\u5386\u53f2", "\u6e05\u671d"])

    def test_history_tag_corpus_contract_comparator_reports_corpus_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            current_path = root / "current.json"
            update_path = root / "update.json"
            js_report_path = root / "js-history-tags.json"
            current_path.write_text(json.dumps({"tags": [], "videos": [], "runs": []}), encoding="utf-8")
            update_path.write_text(
                json.dumps(
                    {
                        "tags": [{"name": "history"}],
                        "videos": [{"bvid": "BVhistory", "aid": 100, "title": "<em>history</em> video", "tags": "history,archive"}],
                        "runs": [{"at": "run"}],
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "tags": 0,
                        "videos": 0,
                        "runs": 0,
                        "corpus": {"version": 1, "updatedAt": "wrong", "tags": [], "videos": [], "runs": []},
                    }
                ),
                encoding="utf-8",
            )

            result = HistoryTagCorpusContractComparator(
                current_path,
                update_path,
                js_report_path,
                generated_at="2026-06-19T01:00:00.000Z",
            ).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "corpus",
                    "python": {
                        "version": 1,
                        "updatedAt": "2026-06-19T01:00:00.000Z",
                        "tags": [{"name": "history"}],
                        "videos": [
                            {
                                "bvid": "BVhistory",
                                "aid": "100",
                                "title": "history video",
                                "tags": ["history", "archive"],
                                "sourceUrl": "https://www.bilibili.com/video/BVhistory/",
                                "sourceQuery": "",
                                "replyCount": 0,
                            }
                        ],
                        "runs": [{"at": "run"}],
                    },
                    "js": {"version": 1, "updatedAt": "wrong", "tags": [], "videos": [], "runs": []},
                },
                {"key": "tags", "python": 1, "js": 0},
                {"key": "videos", "python": 1, "js": 0},
                {"key": "runs", "python": 1, "js": 0},
            ],
        )

    def test_video_comment_filter_matches_needles_inside_noisy_text(self):
        comment_filter = VideoCommentFilter()
        needles = {"\u7f51\u76d8\u89c1", "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}

        self.assertTrue(comment_filter.comment_matches_needle_set("\u54c8\u54c8\u54c8 \u7f51 \u76d8 \u89c1\uff01", needles))
        self.assertTrue(comment_filter.comment_matches_needle_set("\u8fd9\u5c31\u662f\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28\u4e86", needles))
        self.assertFalse(comment_filter.comment_matches_needle_set("\u5b8c\u5168\u65e0\u5173\u7684\u8bc4\u8bba", needles))
        self.assertFalse(comment_filter.comment_matches_needle_set("\u7f51\u76d8\u89c1", set()))

    def test_video_comment_filter_routes_matching_comments_and_falls_back(self):
        comments = [
            {"rpid": "1", "message": "\u7f51\u76d8\u89c1\uff0c\u61c2\u7684\u90fd\u61c2"},
            {"rpid": "2", "message": "\u8def\u8fc7\u968f\u4fbf\u770b\u770b"},
            {"rpid": "3", "message": "\u8fd9\u4e0d\u5c31\u662f\u5178\u578b\u7684\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"},
        ]

        result = VideoCommentFilter().filter_comments(comments, {"\u7f51\u76d8\u89c1"}, ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"])
        fallback = VideoCommentFilter().filter_comments(comments, {"\u5b8c\u5168\u4e0d\u5b58\u5728\u7684\u8bcd"})

        self.assertTrue(result["applied"])
        self.assertEqual(result["matched"], 2)
        self.assertEqual([comment["rpid"] for comment in result["comments"]], ["1", "3"])
        self.assertFalse(fallback["applied"])
        self.assertEqual(len(fallback["comments"]), 3)

    def test_video_comment_filter_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comments_path = root / "comments.json"
            needles_path = root / "needles.json"
            comments_path.write_text(
                json.dumps({"comments": [{"rpid": "1", "message": "\u7f51\u76d8\u89c1"}, {"rpid": "2", "message": "\u8def\u8fc7"}]}),
                encoding="utf-8",
            )
            needles_path.write_text(json.dumps({"needles": ["\u7f51\u76d8\u89c1"]}), encoding="utf-8")

            result = VideoCommentFilterRunner(comments_path, needles_path, extra_needles=["\\u8def\\u8fc7"]).run()

        self.assertTrue(result["ok"])
        self.assertTrue(result["applied"])
        self.assertEqual(result["matched"], 2)
        self.assertEqual([comment["rpid"] for comment in result["comments"]], ["1", "2"])

    def test_video_comment_filter_builds_dictionary_needles_and_prefilter_envelope(self):
        comments = [
            {"rpid": "1", "message": "\u5efa\u8bae\u7f51 \u76d8 \u89c1"},
            {"rpid": "2", "message": "\u7eaf\u8def\u8fc7"},
            {"rpid": "3", "message": "\u8fd9\u662f\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28\u4e86"},
        ]
        dictionary = {
            "entries": [
                {
                    "term": "\u7f51\u76d8\u89c1",
                    "aliases": ["\u7f51\u76d8\u94fe\u63a5"],
                    "examples": ["\u53bb\u7f51\u76d8\u89c1"],
                },
                {"term": "x", "aliases": ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"]},
            ]
        }
        comment_filter = VideoCommentFilter()

        self.assertEqual(
            comment_filter.dictionary_needle_set(dictionary),
            {"\u7f51\u76d8\u89c1", "\u7f51\u76d8\u94fe\u63a5", "\u53bb\u7f51\u76d8\u89c1", "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"},
        )
        result = comment_filter.prefilter_comments_to_dictionary(comments, dictionary, existing_terms_only=True)
        disabled = comment_filter.prefilter_comments_to_dictionary(comments, dictionary, existing_terms_only=False)
        fallback = comment_filter.prefilter_comments_to_dictionary(comments, {"entries": [{"term": "\u4e0d\u5b58\u5728"}]}, existing_terms_only=True)

        self.assertTrue(result["applied"])
        self.assertEqual(result["needleCount"], 4)
        self.assertEqual(result["before"], 3)
        self.assertEqual(result["after"], 2)
        self.assertEqual([comment["rpid"] for comment in result["comments"]], ["1", "3"])
        self.assertFalse(disabled["applied"])
        self.assertEqual(disabled["after"], 3)
        self.assertFalse(fallback["applied"])
        self.assertEqual(fallback["after"], 3)

    def test_video_comment_filter_runner_accepts_dictionary_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comments_path = root / "comments.json"
            dictionary_path = root / "dictionary.json"
            comments_path.write_text(
                json.dumps(
                    {
                        "comments": [
                            {"rpid": "1", "message": "\u7f51\u76d8\u89c1"},
                            {"rpid": "2", "message": "\u8def\u8fc7"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "\u7f51\u76d8\u89c1"}]}),
                encoding="utf-8",
            )

            result = VideoCommentFilterRunner(
                comments_path,
                dictionary_path,
                extra_needles=[],
                dictionary_mode=True,
                existing_terms_only=True,
            ).run()

        self.assertTrue(result["ok"])
        self.assertTrue(result["applied"])
        self.assertEqual(result["before"], 2)
        self.assertEqual(result["after"], 1)
        self.assertEqual(result["comments"][0]["rpid"], "1")

    def test_video_comment_filter_contract_comparator_reports_filter_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            comments_path = root / "comments.json"
            needles_path = root / "needles.json"
            js_report_path = root / "js-report.json"
            comments_path.write_text(
                json.dumps(
                    {
                        "comments": [
                            {"rpid": "1", "message": "\u7f51\u76d8\u89c1"},
                            {"rpid": "2", "message": "\u8def\u8fc7"},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            needles_path.write_text(json.dumps({"needles": ["\u7f51\u76d8\u89c1"]}), encoding="utf-8")
            js_report_path.write_text(
                json.dumps(
                    {
                        "applied": False,
                        "matched": 0,
                        "before": 2,
                        "after": 2,
                        "comments": [{"rpid": "2", "message": "\u8def\u8fc7"}],
                    }
                ),
                encoding="utf-8",
            )

            result = VideoCommentFilterContractComparator(comments_path, needles_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "applied", "python": True, "js": False},
                {"key": "matched", "python": 1, "js": 0},
                {"key": "after", "python": 1, "js": 2},
                {"key": "comments", "python": ["1"], "js": ["2"]},
            ],
        )

    def test_video_relevance_filter_weights_alias_queries_and_stably_ranks(self):
        relevance = VideoRelevanceFilter()
        videos = [
            {"bvid": "BV0", "title": "\u8def\u8fc7\u89c6\u9891"},
            {"bvid": "BV1", "title": "\u5b9d\u5b9d\u4e89\u8bae"},
            {"bvid": "BV2", "title": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28\u540d\u573a\u9762"},
            {"bvid": "BV3", "title": "\u5b9d\u5b9d \u5b9d\u5b9d"},
        ]

        needles = relevance.search_needles_for_relevance(["\u5b9d\u5b9d \u8bc4\u8bba\u533a"], ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"])
        ranked = relevance.sort_videos_by_relevance(videos, ["\u5b9d\u5b9d \u8bc4\u8bba\u533a"], ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"])
        filtered = relevance.filter_relevant_videos(videos, ["\u5b9d\u5b9d \u8bc4\u8bba\u533a"], ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"])

        self.assertEqual(
            needles,
            [
                "\u5b9d\u5b9d\u8bc4\u8bba\u533a",
                "\u5b9d\u5b9d",
                "\u5b9d\u5b9d\u8bc4\u8bba\u533a",
                "\u5b9d\u5b9d",
                "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28",
                "\u5b9d\u5b9d\u8bc4\u8bba\u533a",
                "\u5b9d\u5b9d",
            ],
        )
        self.assertEqual([video["bvid"] for video in ranked], ["BV2", "BV1", "BV3", "BV0"])
        self.assertEqual([video["bvid"] for video in filtered], ["BV1", "BV2", "BV3"])

    def test_video_relevance_filter_rejects_ask_baidu_product_noise(self):
        relevance = VideoRelevanceFilter()
        videos = [
            {"bvid": "BV1", "title": "\u767e\u5ea6\u8fd9\u4e2a\u6897\u600e\u4e48\u7528"},
            {"bvid": "BV2", "title": "\u767e\u5ea6\u7f51\u76d8\u8d44\u6e90\u5206\u4eab"},
        ]

        filtered = relevance.filter_relevant_videos(videos, ["\u767e\u5ea6"], ["\u95ee\u767e\u5ea6"])

        self.assertEqual([video["bvid"] for video in filtered], ["BV1"])

    def test_video_relevance_filter_enforces_mixed_ascii_anchor_and_strict_targets(self):
        relevance = VideoRelevanceFilter()
        anchor_videos = [
            {"bvid": "BV1", "title": "AI \u8bc4\u8bba\u533a \u5f88\u70ed"},
            {"bvid": "BV2", "title": "\u8bc4\u8bba\u533a \u5f88\u70ed"},
        ]
        strict_videos = [
            {"bvid": "BV3", "title": "\u5b85\u7537\u8054\u76df \u5207\u7247"},
            {"bvid": "BV4", "title": "\u56fd\u9645\u65b0\u95fb \u8bc4\u8bba\u533a"},
        ]

        anchored = relevance.filter_relevant_videos(anchor_videos, ["AI\u4e89\u8bae \u8bc4\u8bba\u533a"], [])
        strict = relevance.filter_relevant_videos(strict_videos, ["\u56fd\u9645 \u8bc4\u8bba\u533a"], ["\u5b85\u7537\u8054\u76df"])

        self.assertEqual([video["bvid"] for video in anchored], ["BV1"])
        self.assertEqual([video["bvid"] for video in strict], ["BV3"])

    def test_video_relevance_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "videos": [
                            {"bvid": "BV1", "title": "\u5b85\u7537\u8054\u76df \u539f\u7247"},
                            {"bvid": "BV2", "title": "\u70ed\u95e8\u8bc4\u8bba\u533a"},
                        ],
                        "searchQueries": ["\u70ed\u95e8 \u8bc4\u8bba\u533a"],
                        "targetExistingTerms": ["\u5b85\u7537\u8054\u76df"],
                        "operation": "filter",
                    }
                ),
                encoding="utf-8",
            )

            result = VideoRelevanceRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["needles"],
            ["\u70ed\u95e8\u8bc4\u8bba\u533a", "\u70ed\u95e8\u8bc4\u8bba\u533a", "\u5b85\u7537\u8054\u76df", "\u70ed\u95e8\u8bc4\u8bba\u533a"],
        )
        self.assertEqual([video["bvid"] for video in result["videos"]], ["BV1"])

    def test_video_relevance_contract_comparator_reports_video_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-report.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "videos": [
                            {"bvid": "BV1", "title": "\u5b85\u7537\u8054\u76df \u539f\u7247"},
                            {"bvid": "BV2", "title": "\u70ed\u95e8\u8bc4\u8bba\u533a"},
                        ],
                        "searchQueries": ["\u70ed\u95e8 \u8bc4\u8bba\u533a"],
                        "targetExistingTerms": ["\u5b85\u7537\u8054\u76df"],
                        "operation": "filter",
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "operation": "sort",
                        "needles": ["wrong"],
                        "videos": [{"bvid": "BV2", "title": "\u70ed\u95e8\u8bc4\u8bba\u533a"}],
                    }
                ),
                encoding="utf-8",
            )

            result = VideoRelevanceContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "operation", "python": "filter", "js": "sort"},
                {
                    "key": "needles",
                    "python": [
                        "\u70ed\u95e8\u8bc4\u8bba\u533a",
                        "\u70ed\u95e8\u8bc4\u8bba\u533a",
                        "\u5b85\u7537\u8054\u76df",
                        "\u70ed\u95e8\u8bc4\u8bba\u533a",
                    ],
                    "js": ["wrong"],
                },
                {"key": "videos", "python": ["BV1"], "js": ["BV2"]},
            ],
        )

    def test_video_context_builder_dedupes_context_and_target_evidence_text(self):
        builder = VideoContextBuilder()
        videos = [
            {
                "bvid": "BV1",
                "title": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u540d\u573a\u9762",
                "desc": "\u8bc4\u8bba\u533a   \u590d\u76d8",
                "description": "\u8bc4\u8bba\u533a \u590d\u76d8",
            },
            {
                "bvid": "BV2",
                "title": "\u8def\u8fc7\u89c6\u9891",
                "desc": "",
                "description": "\u65e0\u5173",
            },
            {
                "bvid": "BV1",
                "title": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u540d\u573a\u9762",
                "desc": "\u8bc4\u8bba\u533a   \u590d\u76d8",
            },
        ]

        context_text = builder.build_video_context_text(videos)
        evidence_text = builder.build_target_video_object_evidence_text(
            videos,
            ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u8bc4\u8bba\u533a"],
            ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"],
        )

        self.assertEqual(
            context_text,
            "\n".join(
                [
                    "Bilibili video context: \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u540d\u573a\u9762",
                    "Bilibili video context: \u8bc4\u8bba\u533a \u590d\u76d8",
                    "Bilibili video context: \u8def\u8fc7\u89c6\u9891",
                    "Bilibili video context: \u65e0\u5173",
                ]
            ),
        )
        self.assertEqual(
            evidence_text,
            "Bilibili public video title: \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u540d\u573a\u9762",
        )

    def test_video_context_builder_builds_collection_diagnostics(self):
        builder = VideoContextBuilder()
        diagnostics = builder.build_collection_diagnostics(
            discovered_videos=[{"bvid": "BVD", "title": "\u53d1\u73b0"}],
            discovery_context_videos=[{"bvid": "BVC", "title": "\u4e0a\u4e0b\u6587"}],
            videos=[{"bvid": "BV1", "title": "\u6807\u9898\n\u5f88\u957f", "sourceUrl": "https://www.bilibili.com/video/BV1"}],
            comments=[{"message": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}, {"message": "\u666e\u901a"}],
            training_text="\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u8def\u8fc7",
            target_existing_terms=["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28", "\u8def\u8fc7", "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"],
            keyword_training={
                "entries": [{"term": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}, {"term": "\u8def\u8fc7"}],
                "dictionaryEvidenceEntries": [{"term": "\u8def\u8fc7"}, {"term": "\u65b0\u8bcd"}],
                "evidenceRejected": "2",
            },
        )

        self.assertEqual(diagnostics["discoveredVideos"], 1)
        self.assertEqual(diagnostics["discoveryContextVideos"], 1)
        self.assertEqual(diagnostics["scannedVideos"], 1)
        self.assertEqual(diagnostics["commentsCollected"], 2)
        self.assertEqual(diagnostics["trainingTextChars"], 16)
        self.assertEqual(
            diagnostics["targetTextHits"],
            [
                {"term": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28", "count": 2},
                {"term": "\u8def\u8fc7", "count": 1},
            ],
        )
        self.assertEqual(diagnostics["acceptedTerms"], ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28", "\u8def\u8fc7", "\u65b0\u8bcd"])
        self.assertEqual(diagnostics["evidenceRejected"], 2)
        self.assertEqual(diagnostics["sampleVideos"], [{"bvid": "BV1", "title": "\u6807\u9898 \u5f88\u957f", "sourceUrl": "https://www.bilibili.com/video/BV1"}])

    def test_video_context_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "videos": [{"bvid": "BV1", "title": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}],
                        "discoveredVideos": [{"bvid": "BVD", "title": "\u53d1\u73b0"}],
                        "comments": [{"message": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}],
                        "trainingText": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28",
                        "searchQueries": ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"],
                        "targetExistingTerms": ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"],
                    }
                ),
                encoding="utf-8",
            )

            result = VideoContextRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(
            result["videoContextText"],
            "Bilibili video context: \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28\nBilibili video context: \u53d1\u73b0",
        )
        self.assertEqual(result["videoObjectEvidenceText"], "Bilibili public video title: \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28")
        self.assertEqual(result["diagnostics"]["targetTextHits"], [{"term": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28", "count": 1}])

    def test_video_context_contract_comparator_reports_context_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-report.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "videos": [{"bvid": "BV1", "title": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}],
                        "discoveredVideos": [{"bvid": "BVD", "title": "\u53d1\u73b0"}],
                        "comments": [{"message": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"}],
                        "trainingText": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28",
                        "searchQueries": ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"],
                        "targetExistingTerms": ["\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28"],
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "videoContextText": "wrong context",
                        "videoObjectEvidenceText": "",
                        "contextSourceUrls": ["https://wrong.example/video"],
                        "diagnostics": {"targetTextHits": [], "commentsCollected": 0},
                    }
                ),
                encoding="utf-8",
            )

            result = VideoContextContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "videoContextText",
                    "python": "Bilibili video context: \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28\nBilibili video context: \u53d1\u73b0",
                    "js": "wrong context",
                },
                {
                    "key": "videoObjectEvidenceText",
                    "python": "Bilibili public video title: \u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28",
                    "js": "",
                },
                {"key": "contextSourceUrls", "python": [], "js": ["https://wrong.example/video"]},
                {"key": "diagnostics.targetTextHits", "python": [{"term": "\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28", "count": 1}], "js": []},
                {"key": "diagnostics.commentsCollected", "python": 1, "js": 0},
            ],
        )

    def test_tieba_html_parser_matches_thread_discovery_contract(self):
        parser = TiebaHtmlParser()
        html = """
        <a href="/p/1234567890" title="&#26080;&#30028;&#21487;&#29233;&#35752;&#35770;">duplicate body</a>
        <a href="https://tieba.baidu.com/p/222" title="second title">ignored short id</a>
        <a href="/p/9876543210">\u8d34\u5427\u9ed1\u8bdd\u590d\u76d8</a>
        <a href="/p/1234567890" title="duplicate">duplicate</a>
        """

        threads = parser.parse_threads(html, "\u65e0\u754c\u53ef\u7231")

        self.assertEqual(
            threads,
            [
                {
                    "id": "1234567890",
                    "kind": "tieba-thread",
                    "title": "\u65e0\u754c\u53ef\u7231\u8ba8\u8bba",
                    "keyword": "\u65e0\u754c\u53ef\u7231",
                    "sourceUrl": "https://tieba.baidu.com/p/1234567890",
                },
                {
                    "id": "222",
                    "kind": "tieba-thread",
                    "title": "second title",
                    "keyword": "\u65e0\u754c\u53ef\u7231",
                    "sourceUrl": "https://tieba.baidu.com/p/222",
                },
                {
                    "id": "9876543210",
                    "kind": "tieba-thread",
                    "title": "\u8d34\u5427\u9ed1\u8bdd\u590d\u76d8",
                    "keyword": "\u65e0\u754c\u53ef\u7231",
                    "sourceUrl": "https://tieba.baidu.com/p/9876543210",
                },
            ],
        )

    def test_tieba_html_parser_extracts_thread_comments(self):
        parser = TiebaHtmlParser()
        html = """
        <div class="l_post" data-field='{"author":{"user_name":"\u8001\u54e5"},"content":{"post_id":11}}'>
          <div class="d_post_content j_d_post_content">\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u7ec6\u8bf4\u4e86</div>
        </div>
        <div class="l_post" data-field='{"author":{"user_name":"\u53e6\u4e00\u4e2a"},"content":{"post_id":12}}'>
          <cc><div>\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f\uff0c\u5efa\u8bae\u67e5\u67e5\u8d44\u6599</div></cc>
        </div>
        """

        comments = parser.parse_thread_comments(
            html,
            {"id": "1234567890", "title": "sample thread", "sourceUrl": "https://tieba.baidu.com/p/1234567890"},
        )

        self.assertEqual(
            [
                {
                    "rpid": comment["rpid"],
                    "uname": comment["uname"],
                    "message": comment["message"],
                    "sourceKind": comment["sourceKind"],
                    "sourceUrl": comment["sourceUrl"],
                }
                for comment in comments
            ],
            [
                {
                    "rpid": "tieba-1234567890-11",
                    "uname": "\u8001\u54e5",
                    "message": "\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u7ec6\u8bf4\u4e86",
                    "sourceKind": "tieba-thread",
                    "sourceUrl": "https://tieba.baidu.com/p/1234567890",
                },
                {
                    "rpid": "tieba-1234567890-12",
                    "uname": "\u53e6\u4e00\u4e2a",
                    "message": "\u8fd9\u8c01\u80fd\u7ef7\u5f97\u4f4f\uff0c\u5efa\u8bae\u67e5\u67e5\u8d44\u6599",
                    "sourceKind": "tieba-thread",
                    "sourceUrl": "https://tieba.baidu.com/p/1234567890",
                },
            ],
        )

    def test_tieba_html_parse_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "comments",
                        "thread": {"id": "1000", "title": "\u6d4b\u8bd5", "sourceUrl": "https://tieba.baidu.com/p/1000"},
                        "html": """
                        <div class="l_post" data-field='{"author":{"user_name":"u"},"content":{"post_id":1}}'>
                          <div class="d_post_content j_d_post_content">\u65b0\u8d34\u5427\u8bc4\u8bba</div>
                        </div>
                        """,
                    }
                ),
                encoding="utf-8",
            )

            result = TiebaHtmlParseRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "comments")
        self.assertEqual(result["comments"][0]["message"], "\u65b0\u8d34\u5427\u8bc4\u8bba")

    def test_tieba_html_parse_contract_comparator_reports_parse_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-tieba-html.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "threads",
                        "keyword": "无界可爱",
                        "html": '<a href="/p/1234567890" title="无界可爱讨论">duplicate body</a>',
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(json.dumps({"ok": True, "mode": "threads", "threads": []}), encoding="utf-8")

            result = TiebaHtmlParseContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "threads",
                    "python": [
                        {
                            "id": "1234567890",
                            "kind": "tieba-thread",
                            "title": "无界可爱讨论",
                            "keyword": "无界可爱",
                            "sourceUrl": "https://tieba.baidu.com/p/1234567890",
                        }
                    ],
                    "js": [],
                }
            ],
        )

    def test_bilibili_public_parser_matches_bvid_contracts(self):
        parser = BilibiliPublicParser()

        self.assertEqual(
            parser.parse_bvid_pool("BV19yGa61Ee6, BV1xx411c7mD\uff0cBVabc1234567  bad-id"),
            ["BV19yGa61Ee6", "BV1xx411c7mD", "BVabc1234567"],
        )
        self.assertEqual(parser.extract_bvid("https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=abc"), "BV19yGa61Ee6")
        self.assertEqual(parser.extract_bvid("https://b23.tv/BV1xx411c7mD"), "BV1xx411c7mD")
        self.assertEqual(parser.extract_bvid("not-a-video"), "")

    def test_bilibili_public_parser_extracts_danmaku_xml_comments(self):
        parser = BilibiliPublicParser()
        comments = parser.parse_danmaku_xml(
            '<i><d p="1,1,25,16777215,1710000000,0,12345,0">\u522b\u55b7\u6211 &amp; \u4e0d\u5439\u4e0d\u9ed1</d></i>',
            {
                "bvid": "BV1danmaku",
                "oid": "123",
                "replyType": 1,
                "title": "danmaku video",
                "sourceUrl": "https://www.bilibili.com/video/BV1danmaku/",
                "cid": "456",
            },
        )

        self.assertEqual(
            comments,
            [
                {
                    "bvid": "BV1danmaku",
                    "oid": "123",
                    "replyType": 1,
                    "sourceTitle": "danmaku video",
                    "sourceUrl": "https://www.bilibili.com/video/BV1danmaku/",
                    "rpid": "danmaku-456-0",
                    "like": 0,
                    "ctime": 1710000000,
                    "uname": "",
                    "mid": "12345",
                    "message": "\u522b\u55b7\u6211 & \u4e0d\u5439\u4e0d\u9ed1",
                    "kind": "danmaku",
                }
            ],
        )

    def test_bilibili_public_parser_normalizes_video_objects(self):
        parser = BilibiliPublicParser()

        self.assertEqual(
            parser.video_object_from_search_item(
                {
                    "aid": 123,
                    "bvid": "BV19yGa61Ee6",
                    "title": '<em class="keyword">\u9634\u9633\u602a\u6c14</em> &amp; sample',
                    "mid": 9,
                    "arcurl": "https://www.bilibili.com/video/BV19yGa61Ee6/",
                    "review": 12,
                }
            ),
            {
                "id": "video-1-123",
                "kind": "video",
                "bvid": "BV19yGa61Ee6",
                "oid": "123",
                "replyType": 1,
                "title": "\u9634\u9633\u602a\u6c14 & sample",
                "authorMid": "9",
                "sourceUrl": "https://www.bilibili.com/video/BV19yGa61Ee6/",
                "replyCount": 12,
            },
        )
        self.assertEqual(
            parser.video_object_from_popular_item(
                {
                    "aid": 456,
                    "bvid": "BV1xx411c7mD",
                    "title": "popular sample",
                    "owner": {"mid": 8},
                    "stat": {"reply": 22, "danmaku": 99},
                }
            ),
            {
                "id": "video-1-456",
                "kind": "video",
                "bvid": "BV1xx411c7mD",
                "oid": "456",
                "replyType": 1,
                "title": "popular sample",
                "authorMid": "8",
                "sourceUrl": "https://www.bilibili.com/video/BV1xx411c7mD/",
                "replyCount": 22,
            },
        )
        self.assertEqual(
            parser.video_object_from_view(
                "BVlookup",
                {"aid": 789, "title": "view sample", "owner": {"mid": 7}, "stat": {"reply": 5}, "pages": [{"cid": 456}]},
            ),
            {
                "id": "video-1-789",
                "kind": "video",
                "bvid": "BVlookup",
                "oid": "789",
                "replyType": 1,
                "title": "view sample",
                "authorMid": "7",
                "sourceUrl": "https://www.bilibili.com/video/BVlookup/",
                "replyCount": 5,
                "cid": "456",
            },
        )
        self.assertEqual(
            parser.video_object_from_space_item({"aid": 321, "bvid": "BVspace", "title": "space sample", "comment": 4}, "42"),
            {
                "id": "video-1-321",
                "kind": "video",
                "bvid": "BVspace",
                "oid": "321",
                "replyType": 1,
                "title": "space sample",
                "authorMid": "42",
                "sourceUrl": "https://www.bilibili.com/video/BVspace/",
                "replyCount": 4,
            },
        )

    def test_bilibili_parse_runner_exposes_video_object_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "video-objects",
                        "bvid": "BVlookup",
                        "uid": "42",
                        "view": {"aid": 789, "title": "view sample", "owner": {"mid": 7}, "stat": {"reply": 5}, "cid": 456},
                        "searchItems": [{"aid": 123, "bvid": "BVsearch", "title": "<em>x</em>", "author_mid": 9, "comment": 2}],
                        "popularItems": [{"bvid": "BVpop", "title": "popular", "mid": 8, "stat": {"danmaku": 3}}],
                        "spaceItems": [{"aid": 321, "bvid": "BVspace", "title": "space", "comment": 4}],
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliParseRunner(payload_path).run()

        self.assertEqual(result["mode"], "video-objects")
        self.assertEqual(result["view"]["cid"], "456")
        self.assertEqual(result["searchVideos"][0]["sourceUrl"], "https://www.bilibili.com/video/BVsearch/")
        self.assertEqual(result["popularVideos"][0]["replyCount"], 3)
        self.assertEqual(result["spaceVideos"][0]["authorMid"], "42")

    def test_bilibili_parse_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "danmaku",
                        "video": {"bvid": "BVcli", "oid": "100", "cid": "200", "title": "cli video"},
                        "xml": '<i><d p="0,1,25,16777215,1710000001,0,42,0">\u5f39\u5e55\u8bc4\u8bba</d></i>',
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliParseRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "danmaku")
        self.assertEqual(result["comments"][0]["message"], "\u5f39\u5e55\u8bc4\u8bba")
        self.assertEqual(result["comments"][0]["rpid"], "danmaku-200-0")

    def test_bilibili_parse_contract_comparator_reports_parser_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-parse.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "xml": '<i><d p="1,1,25,1670000000,1670000001,0,mid-a,0">python danmaku</d></i>',
                        "video": {"bvid": "BVparse", "oid": "200", "replyType": 1, "title": "Parser video", "sourceUrl": "https://www.bilibili.com/video/BVparse/"},
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(json.dumps({"ok": True, "mode": "danmaku", "comments": []}), encoding="utf-8")

            result = BilibiliParseContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "comments",
                    "python": [
                        {
                            "bvid": "BVparse",
                            "oid": "200",
                            "replyType": 1,
                            "sourceTitle": "Parser video",
                            "sourceUrl": "https://www.bilibili.com/video/BVparse/",
                            "rpid": "danmaku-200-0",
                            "like": 0,
                            "ctime": 1670000001,
                            "uname": "",
                            "mid": "mid-a",
                            "message": "python danmaku",
                            "kind": "danmaku",
                        }
                    ],
                    "js": [],
                }
            ],
        )

    def test_bilibili_crawler_helper_matches_bvid_and_block_contracts(self):
        helper = BilibiliCrawlerHelper()

        self.assertEqual(
            helper.parse_bvid_pool("BV19yGa61Ee6, BV1xx411c7mD，BVabc1234567  bad-id"),
            ["BV19yGa61Ee6", "BV1xx411c7mD", "BVabc1234567"],
        )
        self.assertEqual(helper.extract_bvid("BV19yGa61Ee6"), "BV19yGa61Ee6")
        self.assertEqual(helper.extract_bvid("https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=abc"), "BV19yGa61Ee6")
        self.assertEqual(helper.extract_bvid("https://b23.tv/BV1xx411c7mD"), "BV1xx411c7mD")
        self.assertEqual(helper.extract_bvid("not-a-video"), "")
        self.assertTrue(helper.is_block_response({"code": -352}))
        self.assertTrue(helper.is_block_response({"code": "-412"}))
        self.assertFalse(helper.is_block_response({"code": 0}))

    def test_bilibili_crawler_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "text": "BV19yGa61Ee6, BV1xx411c7mD",
                        "payload": {"code": -509},
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliCrawlerRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["bvids"], ["BV19yGa61Ee6", "BV1xx411c7mD"])
        self.assertEqual(result["bvid"], "BV19yGa61Ee6")
        self.assertTrue(result["blocked"])

    def test_bilibili_crawler_contract_comparator_reports_helper_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-crawler.json"
            payload_path.write_text(
                json.dumps({"text": "BV19yGa61Ee6, BV1xx411c7mD", "payload": {"code": -509}}),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"ok": True, "bvids": ["BV19yGa61Ee6"], "bvid": "BV19yGa61Ee6", "blocked": False}),
                encoding="utf-8",
            )

            result = BilibiliCrawlerContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "bvids", "python": ["BV19yGa61Ee6", "BV1xx411c7mD"], "js": ["BV19yGa61Ee6"]},
                {"key": "blocked", "python": True, "js": False},
            ],
        )

    def test_bilibili_crawler_helper_matches_public_comment_contracts(self):
        helper = BilibiliCrawlerHelper()
        bucket = []

        helper.collect_reply_for_uid(
            {
                "rpid": 1,
                "mid": 100,
                "member": {"mid": "100", "uname": "other"},
                "content": {"message": "root"},
                "replies": [
                    {
                        "rpid": 2,
                        "mid": 453244911,
                        "member": {"mid": "453244911", "uname": "target"},
                        "content": {"message": "target message"},
                        "like": 6,
                        "ctime": 1710000000,
                    }
                ],
            },
            "453244911",
            {
                "kind": "video",
                "bvid": "BV19yGa61Ee6",
                "oid": 123,
                "replyType": 1,
                "title": "test video",
                "sourceUrl": "https://www.bilibili.com/video/BV19yGa61Ee6/",
            },
            bucket,
        )

        self.assertEqual(
            bucket,
            [
                {
                    "sourceKind": "video",
                    "bvid": "BV19yGa61Ee6",
                    "oid": "123",
                    "replyType": 1,
                    "sourceTitle": "test video",
                    "sourceUrl": "https://www.bilibili.com/video/BV19yGa61Ee6/",
                    "rpid": "2",
                    "like": 6,
                    "ctime": 1710000000,
                    "uname": "target",
                    "mid": "453244911",
                    "message": "target message",
                }
            ],
        )
        self.assertEqual(
            helper.dedupe_public_objects(
                [
                    {"kind": "video", "oid": 123, "replyType": 1, "title": "A"},
                    {"kind": "video", "oid": "123", "replyType": 1, "title": "A duplicate"},
                    {"kind": "dynamic", "oid": "123", "replyType": 17, "title": "different comment target"},
                    {"kind": "invalid", "replyType": 1, "title": "missing oid"},
                ]
            ),
            [
                {"kind": "video", "oid": "123", "replyType": 1, "title": "A"},
                {"kind": "dynamic", "oid": "123", "replyType": 17, "title": "different comment target"},
            ],
        )

    def test_bilibili_crawler_helper_matches_cookie_and_danmaku_contracts(self):
        helper = BilibiliCrawlerHelper()

        self.assertEqual(
            helper.normalize_bilibili_cookie(" SESSDATA=abc ; invalid ; bad:name=value ; empty= ; good=x=y ; newline=a\nb "),
            "SESSDATA=abc; good=x=y",
        )
        self.assertEqual(
            helper.parse_danmaku_xml(
                '<i><d p="1,1,25,16777215,1710000000,0,12345,0">hello &amp; world</d><d>ignored</d></i>',
                {
                    "bvid": "BV1danmaku",
                    "oid": "123",
                    "replyType": 1,
                    "title": "danmaku video",
                    "sourceUrl": "https://www.bilibili.com/video/BV1danmaku/",
                    "cid": "456",
                },
            ),
            [
                {
                    "bvid": "BV1danmaku",
                    "oid": "123",
                    "replyType": 1,
                    "sourceTitle": "danmaku video",
                    "sourceUrl": "https://www.bilibili.com/video/BV1danmaku/",
                    "rpid": "danmaku-456-0",
                    "like": 0,
                    "ctime": 1710000000,
                    "uname": "",
                    "mid": "12345",
                    "message": "hello & world",
                    "kind": "danmaku",
                }
            ],
        )

    def test_bilibili_crawler_runner_exposes_public_comment_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "cookie": " SESSDATA=abc ; invalid ; good=x=y ",
                        "objects": [
                            {"kind": "video", "oid": 123, "replyType": 1, "title": "A"},
                            {"kind": "video", "oid": "123", "replyType": 1, "title": "A duplicate"},
                        ],
                        "reply": {
                            "rpid": 2,
                            "mid": 453244911,
                            "member": {"mid": "453244911", "uname": "target"},
                            "content": {"message": "target message"},
                        },
                        "targetUid": "453244911",
                        "object": {"kind": "video", "oid": 123, "replyType": 1, "title": "A"},
                        "danmakuXml": '<i><d p="1,1,25,16777215,1710000000,0,12345,0">hello</d></i>',
                        "video": {"bvid": "BV1danmaku", "oid": "123", "cid": "456"},
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliCrawlerRunner(payload_path).run()

        self.assertEqual(result["cookie"], "SESSDATA=abc; good=x=y")
        self.assertEqual(len(result["objects"]), 1)
        self.assertEqual(result["targetReplies"][0]["message"], "target message")
        self.assertEqual(result["danmaku"][0]["rpid"], "danmaku-456-0")

    def test_bilibili_crawler_helper_extracts_dynamic_records(self):
        helper = BilibiliCrawlerHelper()

        records = helper.extract_dynamic_records(
            [
                {
                    "id_str": "111222333",
                    "basic": {"comment_type": 17, "comment_id_str": "998877"},
                    "modules": {
                        "module_dynamic": {
                            "desc": {"text": "dynamic opinion text"},
                        },
                        "module_author": {"pub_ts": 1710000000, "name": "up"},
                        "module_stat": {"comment": {"count": 12}},
                    },
                },
                {
                    "id": 444555666,
                    "basic": {"comment_type": 0},
                    "modules": {
                        "module_dynamic": {
                            "major": {"archive": {"title": "archive title", "desc": "archive desc"}},
                        }
                    },
                },
            ],
            "453244911",
        )

        self.assertEqual(
            records["objects"],
            [
                {
                    "id": "dynamic-17-998877",
                    "kind": "dynamic",
                    "oid": "998877",
                    "replyType": 17,
                    "title": "\u52a8\u6001\uff1adynamic opinion text",
                    "authorMid": "453244911",
                    "sourceUrl": "https://t.bilibili.com/111222333",
                    "replyCount": 12,
                }
            ],
        )
        self.assertEqual(
            records["authoredPosts"],
            [
                {
                    "sourceKind": "dynamic-post",
                    "oid": "998877",
                    "replyType": 17,
                    "sourceTitle": "dynamic opinion text",
                    "sourceUrl": "https://t.bilibili.com/111222333",
                    "rpid": "dynamic-111222333",
                    "like": 0,
                    "ctime": 1710000000,
                    "uname": "up",
                    "mid": "453244911",
                    "message": "dynamic opinion text",
                },
                {
                    "sourceKind": "dynamic-post",
                    "oid": "444555666",
                    "replyType": 17,
                    "sourceTitle": "archive title",
                    "sourceUrl": "https://t.bilibili.com/444555666",
                    "rpid": "dynamic-444555666",
                    "like": 0,
                    "ctime": 0,
                    "uname": "",
                    "mid": "453244911",
                    "message": "archive desc",
                },
            ],
        )

    def test_bilibili_crawler_runner_exposes_dynamic_records_json_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload_path = Path(tmp) / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "uid": "453244911",
                        "dynamicItems": [
                            {
                                "id_str": "111222333",
                                "basic": {"comment_type": 17, "comment_id_str": "998877"},
                                "modules": {
                                    "module_dynamic": {"desc": {"text": "dynamic opinion text"}},
                                    "module_stat": {"comment": {"count": 12}},
                                },
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliCrawlerRunner(payload_path).run()

        self.assertEqual(result["dynamicRecords"]["objects"][0]["id"], "dynamic-17-998877")
        self.assertEqual(result["dynamicRecords"]["authoredPosts"][0]["message"], "dynamic opinion text")

    def test_bilibili_probe_planner_builds_headers_and_urls(self):
        planner = BilibiliProbePlanner()

        headers = planner.build_web_headers("https://search.bilibili.com/all?keyword=x", {"cookie": "a=b"})
        search_urls = planner.build_search_urls("\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba", {"pages": 3, "pageSize": 8})

        self.assertEqual(headers["origin"], "https://search.bilibili.com")
        self.assertEqual(headers["cookie"], "a=b")
        self.assertIn("Chrome", headers["user-agent"])
        self.assertEqual(headers["cache-control"], "no-cache")
        self.assertEqual(headers["pragma"], "no-cache")
        self.assertEqual(headers["sec-fetch-site"], "same-site")
        self.assertEqual(search_urls[0], "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%9F%A5%E6%9F%A5%E8%B5%84%E6%96%99+B%E7%AB%99%E8%AF%84%E8%AE%BA&page=1&page_size=8")
        self.assertEqual(search_urls[1].split("page=")[1].split("&")[0], "2")
        self.assertEqual(search_urls[2].split("page_size=")[1], "8")

    def test_bilibili_probe_planner_builds_reply_urls_and_filters_scanned_videos(self):
        planner = BilibiliProbePlanner()

        self.assertEqual(planner.build_view_url({"bvid": "BVlookup"}), "https://api.bilibili.com/x/web-interface/view?bvid=BVlookup")
        self.assertEqual(planner.build_view_url({"aid": "123"}), "https://api.bilibili.com/x/web-interface/view?aid=123")
        self.assertIsNone(planner.build_view_url({}))
        self.assertEqual(
            planner.build_reply_url({"aid": "123"}, page=2, page_size=100),
            "https://api.bilibili.com/x/v2/reply/main?type=1&oid=123&mode=3&next=2&ps=50",
        )
        self.assertEqual(
            planner.build_reply_page_url({"aid": "456"}, page=0, page_size=100),
            "https://api.bilibili.com/x/v2/reply?type=1&oid=456&sort=2&pn=1&ps=50",
        )
        self.assertEqual(
            planner.build_reply_thread_url({"aid": "789", "rootRpid": "456"}, page=2, page_size=100),
            "https://api.bilibili.com/x/v2/reply/reply?type=1&oid=789&root=456&pn=2&ps=50",
        )
        self.assertEqual(
            planner.filter_unscanned_probe_videos([{"bvid": "BVold"}, {"bvid": "BVfresh"}, {"bvid": "BVfresh"}, {"aid": "321"}], {"bvid:BVold"}),
            [{"bvid": "BVfresh"}, {"aid": "321"}],
        )

    def test_bilibili_probe_plan_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "urls",
                        "query": "\u67e5\u67e5\u8d44\u6599",
                        "search": {"pages": 1, "pageSize": 8},
                        "video": {"aid": "123", "rootRpid": "456"},
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliProbePlanRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "urls")
        self.assertEqual(result["viewUrl"], "https://api.bilibili.com/x/web-interface/view?aid=123")
        self.assertEqual(result["replyThreadUrl"], "https://api.bilibili.com/x/v2/reply/reply?type=1&oid=123&root=456&pn=1&ps=20")
        self.assertEqual(len(result["searchUrls"]), 1)

    def test_bilibili_probe_plan_contract_comparator_reports_plan_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-probe-plan.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "urls",
                        "query": "查查资料",
                        "search": {"pages": 1, "pageSize": 8},
                        "video": {"aid": "123", "rootRpid": "456"},
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps({"ok": True, "mode": "urls", "viewUrl": "wrong", "searchUrls": []}),
                encoding="utf-8",
            )

            result = BilibiliProbePlanContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "viewUrl", "python": "https://api.bilibili.com/x/web-interface/view?aid=123", "js": "wrong"},
                {
                    "key": "searchUrls",
                    "python": ["https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=%E6%9F%A5%E6%9F%A5%E8%B5%84%E6%96%99&page=1&page_size=8"],
                    "js": [],
                },
            ],
        )

    def test_bilibili_probe_planner_recovers_existing_source_videos(self):
        planner = BilibiliProbePlanner()
        refs = planner.extract_video_refs(
            "https://www.bilibili.com/video/BV1abc/ and http://www.bilibili.com/video/av123 plus https://www.bilibili.com/video/BV1abc/"
        )
        reply_refs = planner.extract_video_refs(
            "Bilibili public reply detail probe: https://www.bilibili.com/video/av116663559131570/?reply=301234384593"
        )
        scanned_keys = planner.collect_scanned_probe_video_keys(
            {
                "comments": [{"source": "Bilibili public direct comment probe: https://www.bilibili.com/video/BVcomment/"}],
                "runs": [{"videos": [{"bvid": "BVrun"}, {"key": "aid:123"}]}],
            }
        )
        videos_by_term = planner.build_evidence_source_videos_for_actions(
            {
                "entries": [
                    {
                        "term": "rare-term",
                        "evidenceSources": [
                            {"source": "https://www.bilibili.com/video/BVsource1/ https://www.bilibili.com/video/av456"},
                            {"source": "https://www.bilibili.com/video/BVsource2/"},
                        ],
                    },
                    {"term": "other-term", "evidenceSources": [{"source": "https://www.bilibili.com/video/BVother/"}]},
                ]
            },
            [{"term": "rare-term", "query": "rare-term comments"}],
            {"maxPerAction": 2},
        )

        self.assertEqual(refs, [{"bvid": "BV1abc"}, {"aid": "123"}])
        self.assertEqual(reply_refs, [{"aid": "116663559131570", "rootRpid": "301234384593"}])
        self.assertEqual(scanned_keys, ["aid:123", "bvid:BVcomment", "bvid:BVrun"])
        self.assertEqual(
            videos_by_term,
            {
                "rare-term": [
                    {"bvid": "BVsource1", "title": "existing evidence source for rare-term"},
                    {"aid": "456", "title": "existing evidence source for rare-term"},
                ]
            },
        )

    def test_bilibili_probe_plan_runner_recovers_source_videos_from_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "source-videos",
                        "dictionary": {"entries": [{"term": "rare-term", "evidenceSources": [{"source": "https://www.bilibili.com/video/BVsource1/"}]}]},
                        "actions": [{"term": "rare-term"}],
                        "options": {"maxPerAction": 1},
                    }
                ),
                encoding="utf-8",
            )

            result = BilibiliProbePlanRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "source-videos")
        self.assertEqual(result["videosByTerm"], {"rare-term": [{"bvid": "BVsource1", "title": "existing evidence source for rare-term"}]})

    def test_comment_coverage_classifier_matches_core_js_modes(self):
        dictionary = {
            "entries": [
                {"term": "\u7f51\u76d8\u89c1", "family": "evasion", "aliases": ["\u94fe\u63a5\u81ea\u53d6"]},
                {"term": "\u61c2\u7684\u90fd\u61c2", "family": "evasion"},
            ]
        }
        classifier = CommentCoverageClassifier()

        keyword = classifier.classify(dictionary, {"message": "\u7f51\u76d8\u89c1\uff0c\u61c2\u7684\u90fd\u61c2"})
        neutral = classifier.classify(dictionary, {"message": "\u8def\u8fc7\u770b\u770b"})
        diagnostic = classifier.classify(dictionary, {"message": "discover: HTTP 403 from https://api.bilibili.com/x"})
        unsupported = classifier.classify(dictionary, {"message": "plain ascii only"})

        self.assertEqual(keyword["mode"], "keyword")
        self.assertEqual([hit["term"] for hit in keyword["hits"]], ["\u7f51\u76d8\u89c1", "\u61c2\u7684\u90fd\u61c2"])
        self.assertEqual(neutral["mode"], "neutral")
        self.assertEqual(diagnostic["reason"], "scrape diagnostic line, not user speech")
        self.assertFalse(unsupported["covered"])

    def test_comment_coverage_classifier_samples_comments(self):
        dictionary = {"entries": [{"term": "\u7f51\u76d8\u89c1", "family": "evasion"}]}
        comments = [
            {"message": "\u7f51\u76d8\u89c1"},
            {"message": "\u666e\u901a\u8bc4\u8bba"},
            {"message": "ascii only"},
        ]

        summary = CommentCoverageClassifier().sample(dictionary, comments)

        self.assertEqual(summary["total"], 3)
        self.assertEqual(summary["covered"], 2)
        self.assertEqual(summary["uncovered"], 1)
        self.assertEqual(summary["byMode"], {"keyword": 1, "neutral": 1, "uncovered": 1})

    def test_comment_coverage_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            comments_path = root / "comments.json"
            dictionary_path.write_text(json.dumps({"entries": [{"term": "\u7f51\u76d8\u89c1", "family": "evasion"}]}), encoding="utf-8")
            comments_path.write_text(json.dumps({"comments": [{"message": "\u7f51\u76d8\u89c1"}, {"message": "ascii only"}]}), encoding="utf-8")

            result = CommentCoverageRunner(dictionary_path, comments_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["summary"]["byMode"], {"keyword": 1, "neutral": 0, "uncovered": 1})

    def test_comment_coverage_runner_accepts_utf8_bom_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            comments_path = root / "comments.json"
            dictionary_path.write_text(json.dumps({"entries": [{"term": "\u7f51\u76d8\u89c1"}]}), encoding="utf-8-sig")
            comments_path.write_text(json.dumps([{"message": "\u7f51\u76d8\u89c1"}]), encoding="utf-8-sig")

            result = CommentCoverageRunner(dictionary_path, comments_path).run()

        self.assertEqual(result["summary"]["byMode"], {"keyword": 1, "neutral": 0, "uncovered": 0})

    def test_comment_coverage_contract_comparator_reports_summary_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            comments_path = root / "comments.json"
            js_report_path = root / "js-comment-coverage.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "\u7f51\u76d8\u89c1", "family": "evasion"}]}),
                encoding="utf-8",
            )
            comments_path.write_text(
                json.dumps({"comments": [{"message": "\u7f51\u76d8\u89c1"}, {"message": "\u666e\u901a\u8bc4\u8bba"}]}),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "summary": {
                            "total": 2,
                            "covered": 1,
                            "uncovered": 1,
                            "coverageRatio": 0.5,
                            "byMode": {"keyword": 1, "neutral": 0, "uncovered": 1},
                        }
                    }
                ),
                encoding="utf-8",
            )

            result = CommentCoverageContractComparator(dictionary_path, comments_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "covered", "python": 2, "js": 1},
                {"key": "uncovered", "python": 0, "js": 1},
                {"key": "coverageRatio", "python": 1.0, "js": 0.5},
                {"key": "byMode.neutral", "python": 1, "js": 0},
                {"key": "byMode.uncovered", "python": 0, "js": 1},
            ],
        )

    def test_coverage_progress_tracker_matches_js_delta_and_gate_contract(self):
        tracker = CoverageProgressTracker()
        before = {
            "terms": 100,
            "totalEvidence": 300,
            "coverageRatio": 0.35,
            "evidenceDeficit": 120,
            "weakTerms": 70,
            "zeroEvidenceTerms": 0,
            "sourcedEvidenceTerms": 100,
            "unsourcedEvidenceTerms": 0,
        }
        after = {
            "terms": 102,
            "totalEvidence": 305,
            "coverageRatio": 0.34,
            "evidenceDeficit": 120,
            "weakTerms": 72,
            "zeroEvidenceTerms": 0,
            "sourcedEvidenceTerms": 102,
            "unsourcedEvidenceTerms": 0,
        }

        self.assertEqual(
            tracker.coverage_delta(before, after),
            {
                "evidenceDeficitReduced": 0,
                "zeroEvidenceResolved": 0,
                "weakTermsResolved": 0,
                "unsourcedEvidenceReduced": 0,
                "totalEvidenceGained": 5,
                "termsAdded": 2,
                "coverageRatioDelta": -0.01,
            },
        )
        self.assertFalse(tracker.has_coverage_gate_progress(before, after))
        self.assertTrue(tracker.has_coverage_gate_progress({"evidenceDeficit": 4}, {"evidenceDeficit": 3}))
        self.assertTrue(tracker.has_coverage_gate_progress({"zeroEvidenceTerms": 2}, {"zeroEvidenceTerms": 1}))
        self.assertTrue(tracker.has_coverage_gate_progress({"weakTerms": 4}, {"weakTerms": 3}))
        self.assertTrue(tracker.has_coverage_gate_progress({"unsourcedEvidenceTerms": 2}, {"unsourcedEvidenceTerms": 1}))

    def test_coverage_progress_tracker_accounts_for_target_action_progress(self):
        tracker = CoverageProgressTracker()
        before_coverage = {
            "terms": 100,
            "totalEvidence": 300,
            "coverageRatio": 0.35,
            "evidenceDeficit": 120,
            "weakTerms": 70,
            "zeroEvidenceTerms": 0,
            "unsourcedEvidenceTerms": 0,
        }
        after_coverage = {
            "terms": 104,
            "totalEvidence": 313,
            "coverageRatio": 0.3567,
            "evidenceDeficit": 123,
            "weakTerms": 72,
            "zeroEvidenceTerms": 0,
            "unsourcedEvidenceTerms": 0,
        }

        self.assertEqual(
            tracker.action_progress_delta(
                [{"term": "\u626e\u6f14\u5c0f\u4e11", "needs": 2}, {"term": "\u8865\u836f\u554a", "needs": 2}],
                [{"term": "\u8865\u836f\u554a", "needs": 2}],
            ),
            {"actionTermsResolved": 1, "actionEvidenceNeedReduced": 2},
        )
        self.assertTrue(
            tracker.has_coverage_gate_progress(
                before_coverage,
                after_coverage,
                {
                    "beforeActions": [{"term": "\u626e\u6f14\u5c0f\u4e11", "needs": 2}, {"term": "\u8865\u836f\u554a", "needs": 2}],
                    "afterActions": [{"term": "\u8865\u836f\u554a", "needs": 2}],
                },
            )
        )

    def test_coverage_progress_tracker_filters_audit_only_harvest_drift(self):
        tracker = CoverageProgressTracker()
        before = {
            "terms": 2157,
            "totalEvidence": 6033,
            "coverageRatio": 0.5415,
            "evidenceDeficit": 2086,
            "weakTerms": 989,
            "zeroEvidenceTerms": 227,
            "unsourcedEvidenceTerms": 0,
        }
        after = {
            "terms": 2157,
            "totalEvidence": 6035,
            "coverageRatio": 0.5415,
            "evidenceDeficit": 2084,
            "weakTerms": 989,
            "zeroEvidenceTerms": 225,
            "unsourcedEvidenceTerms": 0,
        }

        drift_delta = tracker.coverage_delta_from_harvest(
            before,
            after,
            [{"weakTermsResolved": 0, "zeroEvidenceResolved": 0, "evidenceGained": 0, "evidenceDeficitReduced": 0}],
        )
        real_delta = tracker.coverage_delta_from_harvest(
            {"totalEvidence": 10, "evidenceDeficit": 5, "zeroEvidenceTerms": 2, "weakTerms": 4},
            {"totalEvidence": 12, "evidenceDeficit": 3, "zeroEvidenceTerms": 1, "weakTerms": 3},
            [{"weakTermsResolved": 0, "zeroEvidenceResolved": 1, "evidenceGained": 2, "evidenceDeficitReduced": 2}],
        )

        self.assertEqual(
            drift_delta,
            {
                "evidenceDeficitReduced": 0,
                "zeroEvidenceResolved": 0,
                "weakTermsResolved": 0,
                "unsourcedEvidenceReduced": 0,
                "totalEvidenceGained": 0,
                "termsAdded": 0,
                "coverageRatioDelta": 0,
            },
        )
        self.assertFalse(tracker.has_coverage_delta_progress(drift_delta))
        self.assertEqual(
            real_delta,
            {
                "evidenceDeficitReduced": 2,
                "zeroEvidenceResolved": 1,
                "weakTermsResolved": 1,
                "unsourcedEvidenceReduced": 0,
                "totalEvidenceGained": 2,
                "termsAdded": 0,
                "coverageRatioDelta": 0,
            },
        )
        self.assertTrue(tracker.has_coverage_delta_progress(real_delta))

    def test_coverage_progress_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "before": {"totalEvidence": 10, "evidenceDeficit": 5, "zeroEvidenceTerms": 2, "weakTerms": 4},
                        "after": {"totalEvidence": 12, "evidenceDeficit": 3, "zeroEvidenceTerms": 1, "weakTerms": 3},
                        "harvestProgress": [{"weakTermsResolved": 0, "zeroEvidenceResolved": 1, "evidenceGained": 2, "evidenceDeficitReduced": 2}],
                        "beforeActions": [{"term": "rare-term", "needs": 2}],
                        "afterActions": [{"term": "rare-term", "needs": 1}],
                    }
                ),
                encoding="utf-8",
            )

            result = CoverageProgressRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["delta"]["evidenceDeficitReduced"], 2)
        self.assertEqual(result["harvestDelta"]["totalEvidenceGained"], 2)
        self.assertEqual(result["actionDelta"], {"actionTermsResolved": 0, "actionEvidenceNeedReduced": 1})
        self.assertTrue(result["hasGateProgress"])
        self.assertTrue(result["hasHarvestProgress"])

    def test_coverage_progress_runner_reports_exhausted_terms_from_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "dictionary": {"entries": [{"term": "\u96f6\u8bc1\u636e", "family": "attack", "evidenceCount": 0}]},
                        "state": {"termAttempts": {"6Zu26K-B5o2u": {"attempts": 11}}},
                        "exhaustedOptions": {"targetEvidence": 3, "attemptThreshold": 10},
                    }
                ),
                encoding="utf-8",
            )

            result = CoverageProgressRunner(payload_path).run()

        self.assertEqual(result["exhaustedTerms"], [{"term": "\u96f6\u8bc1\u636e", "family": "attack", "attempts": 11, "evidence": 0}])

    def test_coverage_progress_contract_comparator_reports_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-progress.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "before": {"totalEvidence": 10, "evidenceDeficit": 5, "zeroEvidenceTerms": 2, "weakTerms": 4},
                        "after": {"totalEvidence": 12, "evidenceDeficit": 3, "zeroEvidenceTerms": 1, "weakTerms": 3},
                        "harvestProgress": [{"weakTermsResolved": 0, "zeroEvidenceResolved": 1, "evidenceGained": 2, "evidenceDeficitReduced": 2}],
                        "beforeActions": [{"term": "rare-term", "needs": 2}],
                        "afterActions": [{"term": "rare-term", "needs": 1}],
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "delta": {"evidenceDeficitReduced": 0},
                        "hasGateProgress": False,
                    }
                ),
                encoding="utf-8",
            )

            result = CoverageProgressContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "delta",
                    "python": {
                        "evidenceDeficitReduced": 2,
                        "zeroEvidenceResolved": 1,
                        "weakTermsResolved": 1,
                        "unsourcedEvidenceReduced": 0,
                        "totalEvidenceGained": 2,
                        "termsAdded": 0,
                        "coverageRatioDelta": 0,
                    },
                    "js": {"evidenceDeficitReduced": 0},
                },
                {"key": "hasGateProgress", "python": True, "js": False},
            ],
        )

    def test_coverage_progress_tracker_selects_exhausted_terms_from_harvest_state(self):
        tracker = CoverageProgressTracker()
        dictionary = {
            "entries": [
                {"term": "\u96f6\u8bc1\u636e", "family": "attack", "evidenceCount": 0},
                {"term": "\u90e8\u5206\u8bc1\u636e", "family": "evidence", "evidenceCount": 1, "evidenceSamples": ["sample"]},
                {"term": "\u5df2\u8986\u76d6", "family": "meme", "evidenceCount": 3, "evidenceSamples": ["a", "b", "c"]},
                {"term": "\u672a\u5c1d\u8bd5", "family": "attack", "evidenceCount": 0},
            ]
        }
        state = {
            "termAttempts": {
                "6Zu26K-B5o2u": {"attempts": 10},
                "\u90e8\u5206\u8bc1\u636e": {"attempts": 12},
                "\u672a\u5c1d\u8bd5": {"attempts": 2},
            }
        }

        strict = tracker.select_exhausted_terms(dictionary, state, {"targetEvidence": 3, "attemptThreshold": 10})
        broad = tracker.select_exhausted_terms(
            dictionary,
            state,
            {"targetEvidence": 3, "attemptThreshold": 10, "requireZeroEvidence": False},
        )

        self.assertEqual(strict, [{"term": "\u96f6\u8bc1\u636e", "family": "attack", "attempts": 10, "evidence": 0}])
        self.assertEqual(
            broad,
            [
                {"term": "\u96f6\u8bc1\u636e", "family": "attack", "attempts": 10, "evidence": 0},
                {"term": "\u90e8\u5206\u8bc1\u636e", "family": "evidence", "attempts": 12, "evidence": 1},
            ],
        )

    def test_video_keyword_discovery_reporter_keeps_query_diagnostics(self):
        reporter = VideoKeywordDiscoveryReporter(now=lambda: "2026-06-19T00:00:00.000Z")
        report = reporter.serialize_report(
            {
                "requestedRounds": 1,
                "growth": {"before": 1, "after": 1},
                "coverage": {"coverageRatio": 0.5},
                "coverageActions": [],
                "state": {"searchedQueries": ["target 评论区"]},
                "rounds": [
                    {
                        "queries": ["target 评论区"],
                        "candidateQueries": ["target 评论区"],
                        "growth": {"before": 1, "after": 1},
                        "coverage": {"evidenceDeficit": 2},
                        "coverageProgress": {"evidenceGained": 0, "evidenceDeficitReduced": 0},
                        "termAttemptSummary": {"attemptedTerms": 1},
                        "warnings": [],
                        "trainingDiagnostics": {"deepseekCalls": 1, "evidenceRejected": 2, "dictionaryEvidenceTerms": 0},
                        "queryDiagnostics": [
                            {
                                "query": "target 评论区",
                                "commentsCollected": 240,
                                "trainingTextChars": 4096,
                                "targetExistingTerms": ["target"],
                                "acceptedTerms": [],
                                "evidenceRejected": 2,
                            }
                        ],
                        "results": [
                            {
                                "query": "target 评论区",
                                "result": {
                                    "ok": True,
                                    "videos": [{"bvid": "BV1target", "title": "target title", "sourceUrl": "https://www.bilibili.com/video/BV1target/"}],
                                    "comments": [{"rpid": 1}],
                                    "keywordTraining": {"evidenceRejected": 2, "dictionaryEvidenceEntries": []},
                                    "entries": [],
                                },
                            }
                        ],
                    }
                ],
            },
            "state.json",
            "report.json",
        )

        self.assertEqual(report["generatedAt"], "2026-06-19T00:00:00.000Z")
        self.assertEqual(report["rounds"][0]["trainingDiagnostics"], {"deepseekCalls": 1, "evidenceRejected": 2, "dictionaryEvidenceTerms": 0})
        self.assertEqual(report["rounds"][0]["queryDiagnostics"][0]["commentsCollected"], 240)
        self.assertEqual(report["rounds"][0]["results"][0]["videos"], [{"bvid": "BV1target", "title": "target title", "sourceUrl": "https://www.bilibili.com/video/BV1target/"}])
        self.assertEqual(report["rounds"][0]["results"][0]["comments"], 1)

    def test_video_keyword_discovery_reporter_counts_unique_accepted_evidence(self):
        reporter = VideoKeywordDiscoveryReporter(now=lambda: "2026-06-19T00:00:00.000Z")
        result = {
            "ok": True,
            "entries": [
                {
                    "term": "sampleTerm",
                    "family": "attack",
                    "evidenceCount": 4,
                    "evidenceSamples": ["sampleTerm first comment", "sampleTerm second comment"],
                    "evidenceSources": [
                        {"source": "Bilibili public video comment scan: https://www.bilibili.com/video/BV1111111111/", "uid": "BV1111111111", "sample": "sampleTerm first comment"},
                        {"source": "Bilibili public video comment scan: https://www.bilibili.com/video/BV1111111111/", "uid": "BV1111111111", "sample": "sampleTerm second comment"},
                    ],
                },
                {"term": "fallbackTerm", "evidenceCount": 3},
                {"term": "fallbackTerm", "evidenceCount": 1},
            ],
        }

        self.assertEqual(reporter.count_accepted_evidence_hits_for_result(result), 5)

    def test_video_keyword_discovery_reporter_expands_priority_actions(self):
        reporter = VideoKeywordDiscoveryReporter()
        items = reporter.priority_action_items_from_coverage_actions(
            [
                {"term": "old term", "family": "attack", "action": "none", "status": "covered", "nextQuery": "old term", "suggestedQueries": ["old term alt"]},
                {
                    "term": "next term",
                    "family": "evidence",
                    "action": "retry_with_new_variant",
                    "status": "weak_missed",
                    "nextQuery": "next term 评论区",
                    "suggestedQueries": ["next term 弹幕", ""],
                },
            ]
        )
        priority_items = reporter.priority_action_items_from_harvest_result(
            {
                "coverageActions": [{"term": "timeoutHeavy", "action": "harvest_more_evidence", "nextQuery": "timeoutHeavy 评论区"}],
                "priorityCoverageActions": [{"term": "betterNext", "action": "retry_with_new_variant", "nextQuery": "betterNext 评论区"}],
            }
        )

        self.assertEqual(
            [{"term": item["term"], "query": item["query"], "nextQuery": item["nextQuery"]} for item in items],
            [
                {"term": "next term", "query": "next term 评论区", "nextQuery": "next term 评论区"},
                {"term": "next term", "query": "next term 弹幕", "nextQuery": "next term 弹幕"},
            ],
        )
        self.assertEqual([item["term"] for item in priority_items], ["betterNext"])

    def test_video_keyword_discovery_report_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "statePath": "state.json",
                        "reportPath": "report.json",
                        "generatedAt": "2026-06-19T00:00:00.000Z",
                        "result": {
                            "requestedRounds": 1,
                            "growth": {"before": 1, "after": 2},
                            "coverage": {"coverageRatio": 0.5},
                            "coverageActions": [{"term": "next term", "action": "retry", "nextQuery": "next term 评论区"}],
                            "state": {},
                            "rounds": [{"queries": [], "candidateQueries": [], "growth": {}, "coverage": {}, "coverageProgress": {}, "results": []}],
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = VideoKeywordDiscoveryReportRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["report"]["generatedAt"], "2026-06-19T00:00:00.000Z")
        self.assertEqual(result["priorityActionItems"][0]["query"], "next term 评论区")

    def test_video_keyword_discovery_report_contract_comparator_reports_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-report.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "statePath": "state.json",
                        "reportPath": "report.json",
                        "generatedAt": "2026-06-19T00:00:00.000Z",
                        "result": {
                            "requestedRounds": 1,
                            "growth": {"before": 1, "after": 2},
                            "coverageActions": [{"term": "next", "action": "retry", "nextQuery": "next comments"}],
                            "rounds": [{"queries": ["next comments"], "results": []}],
                        },
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "report": {"generatedAt": "wrong", "requestedRounds": 1},
                        "priorityActionItems": [],
                    }
                ),
                encoding="utf-8",
            )

            result = VideoKeywordDiscoveryReportContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "report",
                    "python": {
                        "generatedAt": "2026-06-19T00:00:00.000Z",
                        "statePath": "state.json",
                        "reportPath": "report.json",
                        "requestedRounds": 1,
                        "growth": {"before": 1, "after": 2},
                        "coverage": None,
                        "coverageActions": [{"term": "next", "action": "retry", "nextQuery": "next comments"}],
                        "state": None,
                        "rounds": [
                            {
                                "round": 1,
                                "queries": ["next comments"],
                                "candidateQueries": None,
                                "growth": None,
                                "coverage": None,
                                "coverageProgress": None,
                                "acceptedEvidenceCount": 0,
                                "coverageIncreasingAcceptedEvidenceCount": 0,
                                "termAttemptSummary": None,
                                "trainingDiagnostics": None,
                                "queryDiagnostics": None,
                                "warnings": None,
                                "results": [],
                            }
                        ],
                    },
                    "js": {"generatedAt": "wrong", "requestedRounds": 1},
                },
                {
                    "key": "priorityActionItems",
                    "python": [{"term": "next", "action": "retry", "nextQuery": "next comments", "query": "next comments"}],
                    "js": [],
                },
            ],
        )

    def test_video_keyword_discovery_options_builder_matches_strict_comment_contract(self):
        builder = VideoKeywordDiscoveryOptionsBuilder(cwd="D:/Bilibili_User_Personality")
        options = builder.build(
            env={
                "BILIBILI_HARVEST_REQUIRE_SOURCES": "1",
                "BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS": "1",
                "BILIBILI_HARVEST_EXISTING_TERMS_ONLY": "1",
                "BILIBILI_HARVEST_QUERY_TIMEOUT_MS": "45000",
                "BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS": "1",
            },
            priority_queries=["contextOnly 评论区"],
            seed_queries=[],
        )

        self.assertTrue(options["requireSourceBackedEvidence"])
        self.assertTrue(options["requireCommentBackedEvidence"])
        self.assertTrue(options["prioritizeSourceGaps"])
        self.assertTrue(options["existingTermsOnly"])
        self.assertEqual(options["retryBeforeUnattemptedLimit"], 1)
        self.assertEqual(options["perQueryTimeoutMs"], 45000)
        self.assertTrue(options["expandTargetsFromComments"])
        self.assertEqual(options["priorityQueries"], ["contextOnly 评论区"])

    def test_video_keyword_discovery_options_builder_applies_history_tag_cli_flags(self):
        options = VideoKeywordDiscoveryOptionsBuilder(cwd="D:/Bilibili_User_Personality").build(
            env={},
            argv=["--include-history-tags", "--history-tag-corpus=server/data/custom-history.json", "--history-tag-limit=33"],
        )

        self.assertTrue(options["includeHistoryTags"])
        self.assertEqual(options["historyTagCorpusPath"], "server/data/custom-history.json")
        self.assertEqual(options["historyTagVideoLimit"], 33)

    def test_video_keyword_discovery_options_builder_parses_priority_query_content(self):
        builder = VideoKeywordDiscoveryOptionsBuilder()
        structured = builder.parse_priority_query_content(
            json.dumps(
                [
                    {"term": "车圈", "family": "attack", "query": "车圈 热评", "nextQuery": "车圈 热评", "suggestedQueries": ["小米汽车 控评"]},
                    {"term": "没有车圈", "family": "attack", "nextQuery": "车圈 热评"},
                ]
            )
        )
        legacy = builder.parse_priority_query_content("车圈 热评\n不会百度 回复 评论区 热评\n")
        json_lines = builder.parse_priority_query_content(
            "\n".join(
                [
                    json.dumps({"term": "问百度", "family": "evasion", "nextQuery": "不会百度 回复 评论区 热评"}),
                    json.dumps({"term": "问百度有什么用", "family": "evasion", "nextQuery": "不会百度 回复 评论区 热评"}),
                ]
            )
        )

        self.assertEqual([(item["term"], item["query"], item["nextQuery"]) for item in structured], [("车圈", "车圈 热评", "车圈 热评"), ("没有车圈", "车圈 热评", "车圈 热评")])
        self.assertEqual(legacy, ["车圈 热评", "不会百度 回复 评论区 热评"])
        self.assertEqual([item["term"] for item in json_lines], ["问百度", "问百度有什么用"])

    def test_coverage_runtime_options_builder_matches_cli_env_contract(self):
        builder = CoverageRuntimeOptionsBuilder()
        strict = builder.build(argv=["--strict-comment-backed", "--target-evidence", "2", "--max-actions", "7"], env={})
        override = builder.build(
            argv=["--target-evidence=2", "--max-actions=5", "--min-ratio=0.75"],
            env={
                "BILIBILI_HARVEST_TARGET_EVIDENCE": "3",
                "BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS": "12",
                "BILIBILI_COVERAGE_AUDIT_MIN_RATIO": "1",
            },
        )
        retry = builder.build(argv=["--strict-comment-backed", "--retry-before-unattempted", "4"], env={})

        self.assertTrue(strict["requireCommentBackedEvidence"])
        self.assertTrue(strict["requireSourceBackedEvidence"])
        self.assertTrue(strict["prioritizeSourceGaps"])
        self.assertEqual(strict["targetEvidence"], 2)
        self.assertEqual(strict["maxActions"], 7)
        self.assertEqual(strict["retryBeforeUnattemptedLimit"], 1)
        self.assertEqual(override["targetEvidence"], 2)
        self.assertEqual(override["maxActions"], 5)
        self.assertEqual(override["minCoverageRatio"], 0.75)
        self.assertEqual(retry["retryBeforeUnattemptedLimit"], 4)

    def test_harvest_options_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "video-keyword",
                        "env": {"BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS": "1"},
                        "argv": ["--include-history-tags"],
                        "priorityQueries": ["target 评论区"],
                    }
                ),
                encoding="utf-8",
            )

            result = HarvestOptionsRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mode"], "video-keyword")
        self.assertTrue(result["options"]["requireCommentBackedEvidence"])
        self.assertTrue(result["options"]["includeHistoryTags"])
        self.assertEqual(result["options"]["priorityQueries"], ["target 评论区"])

    def test_harvest_options_contract_comparator_reports_option_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "payload.json"
            js_report_path = root / "js-options.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "mode": "coverage-runtime",
                        "env": {"BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS": "1"},
                        "argv": ["--target-evidence", "2", "--max-actions=5"],
                    }
                ),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "mode": "coverage-runtime",
                        "options": {"targetEvidence": 3, "maxActions": 5},
                    }
                ),
                encoding="utf-8",
            )

            result = HarvestOptionsContractComparator(payload_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "options",
                    "python": {
                        "targetEvidence": 2,
                        "maxActions": 5,
                        "minCoverageRatio": 1.0,
                        "requireComplete": True,
                        "requireSourceBackedEvidence": True,
                        "requireCommentBackedEvidence": True,
                        "prioritizeSourceGaps": True,
                        "retryBeforeUnattemptedLimit": 1,
                        "strict": False,
                    },
                    "js": {"targetEvidence": 3, "maxActions": 5},
                }
            ],
        )

    def test_keyword_harvest_plan_builder_matches_js_priority_and_dictionary_contract(self):
        builder = KeywordHarvestPlanBuilder()

        plan = builder.build_query_plan(
            {"entries": [{"term": "doge", "family": "cooperation", "evidenceCount": 0}]},
            {
                "priorityQueries": [{"term": "doge", "family": "cooperation", "nextQuery": "manual doge query", "attempts": 2}],
                "seedQueries": ["seed topic"],
                "coverageMode": "all-weak",
                "maxQueries": 4,
                "queryVariantsPerTerm": 2,
            },
        )

        self.assertEqual(
            plan,
            [
                {
                    "query": "manual doge query",
                    "source": "priority",
                    "term": "doge",
                    "family": "cooperation",
                    "priorAttempts": 2,
                    "variantIndex": None,
                    "builtInVariant": True,
                    "previouslyTried": False,
                },
                {
                    "query": "doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4",
                    "source": "dictionary",
                    "term": "doge",
                    "family": "cooperation",
                    "evidenceCount": 0,
                    "sourcedEvidence": False,
                    "recommendationGroup": "doge",
                    "priorAttempts": 0,
                    "priorSuccessfulAttempts": 0,
                    "variantIndex": 0,
                    "builtInVariant": True,
                    "previouslyTried": False,
                },
                {
                    "query": "doge \u8bc4\u8bba\u533a",
                    "source": "dictionary",
                    "term": "doge",
                    "family": "cooperation",
                    "evidenceCount": 0,
                    "sourcedEvidence": False,
                    "recommendationGroup": "doge",
                    "priorAttempts": 0,
                    "priorSuccessfulAttempts": 0,
                    "variantIndex": 1,
                    "builtInVariant": True,
                    "previouslyTried": False,
                },
                {"query": "seed topic", "source": "seed"},
            ],
        )

    def test_keyword_harvest_plan_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "harvest-plan.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "dictionary": {"entries": [{"term": "weak", "family": "attack", "evidenceCount": 0}]},
                        "options": {"coverageMode": "all-weak", "maxQueries": 2, "queryVariantsPerTerm": 1, "seedQueries": ["seed topic"]},
                    }
                ),
                encoding="utf-8",
            )

            result = KeywordHarvestPlanRunner(payload_path).run()

        self.assertTrue(result["ok"])
        self.assertEqual(result["queries"], ["weak \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4", "seed topic"])
        self.assertEqual(result["plan"][0]["source"], "dictionary")

    def test_keyword_harvest_plan_contract_comparator_reports_plan_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload_path = root / "harvest-plan.json"
            js_plan_path = root / "js-plan.json"
            payload_path.write_text(
                json.dumps(
                    {
                        "dictionary": {"entries": [{"term": "weak", "family": "attack", "evidenceCount": 0}]},
                        "options": {"coverageMode": "all-weak", "maxQueries": 2, "queryVariantsPerTerm": 1, "seedQueries": ["seed topic"]},
                    }
                ),
                encoding="utf-8",
            )
            js_plan_path.write_text(
                json.dumps(
                    {
                        "queries": ["wrong query"],
                        "plan": [{"query": "wrong query", "source": "seed", "term": "wrong", "family": "wrong"}],
                    }
                ),
                encoding="utf-8",
            )

            result = KeywordHarvestPlanContractComparator(payload_path, js_plan_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "queries", "python": ["weak \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4", "seed topic"], "js": ["wrong query"]},
                {
                    "key": "plan",
                    "python": [
                        {"query": "weak \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4", "source": "dictionary", "term": "weak", "family": "attack"},
                        {"query": "seed topic", "source": "seed", "term": None, "family": None},
                    ],
                    "js": [{"query": "wrong query", "source": "seed", "term": "wrong", "family": "wrong"}],
                },
            ],
        )

    def test_keyword_harvest_plan_builder_expands_repeated_misses_to_untried_variants(self):
        plan = KeywordHarvestPlanBuilder().build_query_plan(
            {"entries": [{"term": "doge", "family": "cooperation", "evidenceCount": 0}]},
            {
                "seedQueries": [],
                "coverageMode": "all-weak",
                "maxQueries": 4,
                "queryVariantsPerTerm": 2,
                "termAttempts": {
                    "doge": {
                        "term": "doge",
                        "attempts": 2,
                        "successfulAttempts": 0,
                        "queries": [
                            {"query": "doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4"},
                            {"query": "doge \u8bc4\u8bba\u533a"},
                        ],
                    }
                },
            },
        )

        self.assertEqual(
            [[item["query"], item["variantIndex"], item["previouslyTried"]] for item in plan],
            [
                ["doge \u70ed\u8bc4", 2, False],
                ["doge \u5f39\u5e55", 3, False],
                ["doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4", 0, True],
                ["doge \u8bc4\u8bba\u533a", 1, True],
            ],
        )

    def test_keyword_harvest_plan_builder_prioritizes_retry_before_fresh_terms(self):
        plan = KeywordHarvestPlanBuilder().build_query_plan(
            {
                "entries": [
                    {"term": "fresh", "family": "attack", "evidenceCount": 0},
                    {"term": "missed", "family": "attack", "evidenceCount": 0},
                ]
            },
            {
                "seedQueries": [],
                "coverageMode": "all-weak",
                "maxQueries": 2,
                "queryVariantsPerTerm": 2,
                "includeExhaustedFallbackTemplates": False,
                "termAttempts": {
                    "missed": {
                        "term": "missed",
                        "attempts": 1,
                        "successfulAttempts": 0,
                        "queries": [{"query": "missed \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4"}],
                    }
                },
            },
        )

        self.assertEqual([item["term"] for item in plan], ["missed", "missed"])
        self.assertEqual(plan[0]["query"], "missed \u8bc4\u8bba\u533a")
        self.assertFalse(plan[0]["previouslyTried"])

    def test_keyword_harvest_plan_builder_targets_source_metadata_gaps(self):
        plan = KeywordHarvestPlanBuilder().build_query_plan(
            {
                "entries": [
                    {"term": "coveredNoSource", "family": "attack", "evidenceCount": 3, "evidenceSamples": ["sample one", "sample two", "sample three"]},
                    {"term": "weak", "family": "attack", "evidenceCount": 0},
                    {
                        "term": "coveredWithSource",
                        "family": "attack",
                        "evidenceCount": 3,
                        "evidenceSources": [
                            {"source": "Bilibili public video comment scan", "sample": "sample one"},
                            {"source": "Bilibili public video comment scan", "sample": "sample two"},
                            {"source": "Bilibili public video comment scan", "sample": "sample three"},
                        ],
                    },
                ]
            },
            {
                "seedQueries": [],
                "coverageMode": "all-weak",
                "maxQueries": 2,
                "queryVariantsPerTerm": 1,
                "requireSourceBackedEvidence": True,
            },
        )

        self.assertEqual([item["term"] for item in plan], ["weak", "coveredNoSource"])
        self.assertEqual(plan[1]["evidenceCount"], 3)
        self.assertFalse(plan[1]["sourcedEvidence"])

    def test_coverage_audit_builder_matches_js_metric_contract(self):
        dictionary = {
            "entries": [
                {
                    "term": "covered",
                    "family": "attack",
                    "evidenceCount": 3,
                    "evidenceSources": [
                        {"source": "Bilibili public video comment scan", "sample": "covered sample 1"},
                        {"source": "Bilibili public video comment scan", "sample": "covered sample 2"},
                        {"source": "Bilibili public video comment scan", "sample": "covered sample 3"},
                    ],
                    "evidenceSamples": ["covered sample 1", "covered sample 2", "covered sample 3"],
                },
                {"term": "weak", "family": "attack", "evidenceCount": 1, "evidenceSamples": ["weak sample"]},
                {"term": "zero", "family": "evidence", "evidenceCount": 0},
            ]
        }

        audit = CoverageAuditBuilder(target_evidence=3, max_actions=10, require_source_backed_evidence=True).build(dictionary)

        self.assertFalse(audit["ok"])
        self.assertEqual(audit["coverage"]["terms"], 3)
        self.assertEqual(audit["coverage"]["totalEvidence"], 4)
        self.assertEqual(audit["coverage"]["weakTerms"], 2)
        self.assertEqual(audit["coverage"]["zeroEvidenceTerms"], 1)
        self.assertEqual(audit["coverage"]["evidenceDeficit"], 5)
        self.assertEqual(audit["coverage"]["sourcedEvidenceTerms"], 1)
        self.assertEqual(audit["coverage"]["unsourcedEvidenceTerms"], 1)
        self.assertEqual(audit["coverage"]["coverageRatio"], 0.3333)
        self.assertEqual(audit["familyGaps"][0]["family"], "evidence")
        self.assertEqual([item["term"] for item in audit["nextActions"]], ["zero", "weak"])
        self.assertIn("2 term(s) are below 3 evidence hit(s)", audit["failureReasons"])

    def test_coverage_audit_builder_caps_evidence_count_to_sample_units(self):
        dictionary = {
            "entries": [
                {
                    "term": "inflated",
                    "family": "attack",
                    "evidenceCount": 8,
                    "evidenceSamples": ["same sample"],
                    "evidenceSources": [{"source": "Bilibili public video comment scan", "sample": "same sample"}],
                }
            ]
        }

        audit = CoverageAuditBuilder(target_evidence=3).build(dictionary)

        self.assertEqual(audit["coverage"]["totalEvidence"], 1)
        self.assertEqual(audit["coverage"]["weakTerms"], 1)
        self.assertEqual(audit["coverage"]["evidenceDeficit"], 2)

    def test_coverage_audit_builder_matches_js_canonical_evidence_overrides(self):
        dictionary = {
            "entries": [
                {
                    "term": "\u7cbe\u795e\u5916\u56fd\u4eba",
                    "family": "attack",
                    "evidenceCount": 6,
                    "evidenceSamples": ["one", "two", "three", "four", "five"],
                    "evidenceSources": [
                        {"source": "Bilibili public video comment scan", "sample": "one"},
                        {"source": "Bilibili public video comment scan", "sample": "two"},
                        {"source": "Bilibili public video comment scan", "sample": "three"},
                        {"source": "Bilibili public video comment scan", "sample": "four"},
                        {"source": "Bilibili public video comment scan", "sample": "five"},
                        {"source": "Bilibili public video comment scan", "uid": "source-only"},
                    ],
                }
            ]
        }

        audit = CoverageAuditBuilder(target_evidence=3).build(dictionary)

        self.assertEqual(audit["coverage"]["totalEvidence"], 5)

    def test_audit_contract_comparator_reports_metric_parity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {"term": "covered", "family": "attack", "evidenceCount": 3},
                            {"term": "weak", "family": "attack", "evidenceCount": 1},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 2,
                            "totalEvidence": 4,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0.5,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 2,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mismatches"], [])
        self.assertEqual(result["python"]["coverage"]["weakTerms"], 1)

    def test_audit_contract_comparator_accepts_utf8_bom_js_audit_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {"term": "covered", "family": "attack", "evidenceCount": 3},
                            {"term": "weak", "family": "attack", "evidenceCount": 1},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                "\ufeff"
                + json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 2,
                            "totalEvidence": 4,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0.5,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 2,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mismatches"], [])

    def test_audit_contract_comparator_honors_comment_backed_evidence_mode(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {
                                "term": "context-only",
                                "family": "attack",
                                "evidenceCount": 3,
                                "evidenceSamples": [
                                    "Bilibili video context: one",
                                    "Bilibili video context: two",
                                    "Bilibili video context: three",
                                ],
                                "evidenceSources": [
                                    {"source": "search-discovered video context", "sample": "Bilibili video context: one"},
                                    {"source": "search-discovered video context", "sample": "Bilibili video context: two"},
                                    {"source": "search-discovered video context", "sample": "Bilibili video context: three"},
                                ],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "requireCommentBackedEvidence": True,
                        "coverage": {
                            "terms": 1,
                            "totalEvidence": 0,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 1,
                            "evidenceDeficit": 3,
                            "coverageRatio": 0,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 1,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mismatches"], [])
        self.assertEqual(result["python"]["coverage"]["totalEvidence"], 0)
        self.assertEqual(result["python"]["coverage"]["sourcedEvidenceTerms"], 0)
        self.assertEqual(result["python"]["coverage"]["unsourcedEvidenceTerms"], 1)

    def test_audit_contract_comparator_honors_js_gate_options(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "weak", "family": "attack", "evidenceCount": 0}]}),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "ok": True,
                        "targetEvidence": 3,
                        "minCoverageRatio": 0,
                        "requireComplete": False,
                        "coverage": {
                            "terms": 1,
                            "totalEvidence": 0,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 1,
                            "evidenceDeficit": 3,
                            "coverageRatio": 0,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 0,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertTrue(result["ok"])
        self.assertEqual(result["mismatches"], [])
        self.assertTrue(result["python"]["ok"])

    def test_audit_contract_comparator_reports_top_level_ok_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "covered", "family": "attack", "evidenceCount": 3}]}),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "ok": False,
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 1,
                            "totalEvidence": 3,
                            "weakTerms": 0,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 0,
                            "coverageRatio": 1,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 1,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "ok", "python": True, "js": False}])

    def test_audit_contract_comparator_reports_failure_reason_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "weak", "family": "attack", "evidenceCount": 1}]}),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "ok": False,
                        "targetEvidence": 3,
                        "minCoverageRatio": 0,
                        "coverage": {
                            "terms": 1,
                            "totalEvidence": 1,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 1,
                        },
                        "failureReasons": ["stale JS reason"],
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "failureReasons",
                    "python": ["1 term(s) are below 3 evidence hit(s)"],
                    "js": ["stale JS reason"],
                }
            ],
        )

    def test_audit_contract_comparator_reports_family_gap_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {"term": "weak", "family": "attack", "evidenceCount": 1},
                            {"term": "covered", "family": "cooperation", "evidenceCount": 3},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 2,
                            "totalEvidence": 4,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0.5,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 2,
                        },
                        "familyGaps": [{"family": "stale", "terms": 2, "weak": 1, "zero": 0, "evidence": 4, "coverageRatio": 0.5}],
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {
                    "key": "familyGaps",
                    "python": [
                        {"family": "attack", "terms": 1, "weak": 1, "zero": 0, "evidence": 1, "coverageRatio": 0},
                        {"family": "cooperation", "terms": 1, "weak": 0, "zero": 0, "evidence": 3, "coverageRatio": 1},
                    ],
                    "js": [{"family": "stale", "terms": 2, "weak": 1, "zero": 0, "evidence": 4, "coverageRatio": 0.5}],
                }
            ],
        )

    def test_audit_contract_comparator_reports_complete_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "weak", "family": "attack", "evidenceCount": 1}]}),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "complete": True,
                            "terms": 1,
                            "totalEvidence": 1,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 1,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "complete", "python": False, "js": True}])

    def test_audit_contract_comparator_reports_average_evidence_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {"term": "covered", "family": "attack", "evidenceCount": 3},
                            {"term": "weak", "family": "attack", "evidenceCount": 1},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 2,
                            "totalEvidence": 4,
                            "averageEvidence": 1.5,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0.5,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 2,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "averageEvidence", "python": 2.0, "js": 1.5}])

    def test_audit_contract_comparator_reports_source_coverage_ratio_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {
                                "term": "covered",
                                "family": "attack",
                                "evidenceCount": 3,
                                "evidenceSources": [{"source": "Bilibili public video comment scan", "sample": "covered"}],
                            },
                            {"term": "unsourced", "family": "attack", "evidenceCount": 3},
                        ]
                    }
                ),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 2,
                            "totalEvidence": 4,
                            "weakTerms": 1,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 2,
                            "coverageRatio": 0.5,
                            "sourcedEvidenceTerms": 1,
                            "sourceCoverageRatio": 1,
                            "unsourcedEvidenceTerms": 1,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "sourceCoverageRatio", "python": 0.5, "js": 1}])

    def test_audit_contract_comparator_reports_coverage_target_evidence_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "covered", "family": "attack", "evidenceCount": 3}]}),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "targetEvidence": 2,
                            "terms": 1,
                            "totalEvidence": 3,
                            "weakTerms": 0,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 0,
                            "coverageRatio": 1,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 1,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "targetEvidence", "python": 3, "js": 2}])

    def test_audit_contract_comparator_reports_total_evidence_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            dictionary_path = root / "dictionary.json"
            js_audit_path = root / "js-audit.json"
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "covered", "family": "attack", "evidenceCount": 3}]}),
                encoding="utf-8",
            )
            js_audit_path.write_text(
                json.dumps(
                    {
                        "targetEvidence": 3,
                        "coverage": {
                            "terms": 1,
                            "totalEvidence": 2,
                            "weakTerms": 0,
                            "zeroEvidenceTerms": 0,
                            "evidenceDeficit": 0,
                            "coverageRatio": 1,
                            "sourcedEvidenceTerms": 0,
                            "unsourcedEvidenceTerms": 1,
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = AuditContractComparator(dictionary_path, js_audit_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(result["mismatches"], [{"key": "totalEvidence", "python": 3, "js": 2}])
        self.assertEqual(result["warnings"], [])

    def test_random_verification_runner_reads_json_contracts(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus_path = root / "corpus.json"
            dictionary_path = root / "dictionary.json"
            corpus_path.write_text(
                json.dumps(
                    {
                        "comments": [
                            {"message": "ordinary"},
                            {"message": "doge satire"},
                            {"message": "check source"},
                        ],
                        "runs": [],
                    }
                ),
                encoding="utf-8",
            )
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "doge", "family": "attack"}, {"term": "source", "family": "evidence"}]}),
                encoding="utf-8",
            )

            result = RandomVerificationRunner(corpus_path, dictionary_path, sample_size=3, seed=1).run()

        self.assertEqual(result["sampled"], 3)
        self.assertEqual(result["keywordHits"], 2)
        self.assertEqual(result["neutral"], 1)
        self.assertEqual(result["uncovered"], 0)
        self.assertEqual(result["dictionaryTerms"], 2)

    def test_random_verification_runner_uses_dictionary_aliases_and_examples(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus_path = root / "corpus.json"
            dictionary_path = root / "dictionary.json"
            corpus_path.write_text(
                json.dumps(
                    {
                        "comments": [
                            {"message": "dddd"},
                            {"message": "\u5927\u5bb6\u90fd\u61c2"},
                            {"message": "ordinary"},
                        ],
                        "runs": [],
                    }
                ),
                encoding="utf-8",
            )
            dictionary_path.write_text(
                json.dumps(
                    {
                        "entries": [
                            {
                                "term": "\u61c2\u7684\u90fd\u61c2",
                                "family": "evasion",
                                "aliases": ["dddd"],
                                "examples": ["\u5927\u5bb6\u90fd\u61c2"],
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            result = RandomVerificationRunner(corpus_path, dictionary_path, sample_size=3, seed=1).run()

        self.assertEqual(result["sampled"], 3)
        self.assertEqual(result["keywordHits"], 2)
        self.assertEqual(result["neutral"], 1)
        self.assertEqual(result["dictionaryTerms"], 3)

    def test_random_verification_contract_comparator_reports_metric_mismatches(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            corpus_path = root / "corpus.json"
            dictionary_path = root / "dictionary.json"
            js_report_path = root / "js-random-verification.json"
            corpus_path.write_text(
                json.dumps(
                    {
                        "comments": [
                            {"message": "ordinary"},
                            {"message": "doge satire"},
                            {"message": "source check"},
                        ],
                        "runs": [],
                    }
                ),
                encoding="utf-8",
            )
            dictionary_path.write_text(
                json.dumps({"entries": [{"term": "doge"}, {"term": "source"}]}),
                encoding="utf-8",
            )
            js_report_path.write_text(
                json.dumps(
                    {
                        "sampleSize": 3,
                        "seed": 1,
                        "sampled": 3,
                        "keywordHits": 1,
                        "neutral": 2,
                        "uncovered": 0,
                    }
                ),
                encoding="utf-8",
            )

            result = RandomVerificationContractComparator(corpus_path, dictionary_path, js_report_path).compare()

        self.assertFalse(result["ok"])
        self.assertEqual(
            result["mismatches"],
            [
                {"key": "keywordHits", "python": 2, "js": 1},
                {"key": "neutral", "python": 1, "js": 2},
            ],
        )
        self.assertEqual(result["python"]["sampled"], 3)
        self.assertEqual(result["js"]["sampled"], 3)

    def test_random_verification_json_output_is_utf8_safe(self):
        payload = {"ok": True, "samples": [{"message": "emoji 😭 and hangul 눈"}]}

        encoded = json_result_bytes(payload)
        decoded = encoded.decode("utf-8")

        self.assertIn("emoji 😭 and hangul 눈", decoded)


if __name__ == "__main__":
    unittest.main()
