import json
import tempfile
import unittest
from pathlib import Path

from python_backend.analysis.audit import CoverageAuditBuilder, CoverageAuditReport
from python_backend.analysis.comment_coverage import CommentCoverageClassifier
from python_backend.analysis.verification import RandomVerifier
from python_backend.analyzers.deepseek import AnalyzerRequest, DeepSeekAnalyzerClient
from python_backend.cli.comment_coverage import CommentCoverageRunner
from python_backend.cli.coverage_audit import AuditContractComparator
from python_backend.cli.compare_contracts import ContractComparator
from python_backend.cli.deepseek_analysis_plan import DeepSeekAnalysisPlanRunner
from python_backend.cli.history_tag_corpus import HistoryTagCorpusRunner
from python_backend.cli.huggingface_corpus import HuggingFaceCorpusImportRunner
from python_backend.cli.local_corpus_evidence import LocalCorpusEvidenceRunner
from python_backend.cli.local_corpus_flatten import LocalCorpusFlattenRunner
from python_backend.cli.video_comment_filter import VideoCommentFilterRunner
from python_backend.cli.direct_probe_corpus import DirectProbeCorpusRunner
from python_backend.cli.random_verification import RandomVerificationRunner
from python_backend.cli.tieba_corpus import TiebaCorpusUpdateRunner
from python_backend.cli.tieba_html_parse import TiebaHtmlParseRunner
from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder
from python_backend.corpus.history_tags import HistoryTagCorpusManager
from python_backend.corpus.huggingface import HuggingFaceCorpusImporter
from python_backend.corpus.local import LocalCorpusEvidenceFinder
from python_backend.corpus.local import LocalCorpusFlattener
from python_backend.corpus.tieba import TiebaCorpusUpdater
from python_backend.analysis.video_filter import VideoCommentFilter
from python_backend.corpus.dictionary import DictionaryLoader
from python_backend.corpus.loader import CorpusLoader
from python_backend.corpus.writer import CorpusShardWriter
from python_backend.scrapers.adapters import ScrapeRequest, ScraperAdapter
from python_backend.scrapers.rate_limiter import RateLimiter
from python_backend.scrapers.tieba_html import TiebaHtmlParser


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

        self.assertEqual(dictionary.manifest["storage"], "split")
        self.assertEqual(len(dictionary.entries), 1)
        self.assertEqual(dictionary.entries[0]["term"], "doge")
        self.assertEqual(dictionary.entries[0]["evidenceSamples"], ["doge satire"])
        self.assertEqual(dictionary.entries[0]["evidenceSources"][0]["sample"], "doge satire")

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


if __name__ == "__main__":
    unittest.main()
