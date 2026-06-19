import json
import tempfile
import unittest
from pathlib import Path

from python_backend.analysis.audit import CoverageAuditBuilder, CoverageAuditReport
from python_backend.analysis.verification import RandomVerifier
from python_backend.analyzers.deepseek import AnalyzerRequest, DeepSeekAnalyzerClient
from python_backend.cli.coverage_audit import AuditContractComparator
from python_backend.cli.compare_contracts import ContractComparator
from python_backend.cli.deepseek_analysis_plan import DeepSeekAnalysisPlanRunner
from python_backend.cli.huggingface_corpus import HuggingFaceCorpusImportRunner
from python_backend.cli.local_corpus_flatten import LocalCorpusFlattenRunner
from python_backend.cli.random_verification import RandomVerificationRunner
from python_backend.corpus.huggingface import HuggingFaceCorpusImporter
from python_backend.corpus.local import LocalCorpusFlattener
from python_backend.corpus.dictionary import DictionaryLoader
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
