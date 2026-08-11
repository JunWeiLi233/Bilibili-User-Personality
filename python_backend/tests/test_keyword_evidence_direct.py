"""Direct unit tests for previously-indirectly-tested helpers.

Covers:
  - KeywordEvidenceMatcher.evidence_for_term: the per-term evidence matcher
    (branching on source/uid, sample clipping at 120 chars, the 3-sample cap,
    non-overlapping needle counting).
  - corpus.local.is_scrape_diagnostic_message / clean_comment_message:
    the diagnostic-message regex branches (HTTP 403/4xx/5xx detection across
    discover/tieba/bilibili hosts).
"""

from __future__ import annotations

import unittest

from python_backend.analyzers.keyword_evidence import KeywordEvidenceMatcher
from python_backend.corpus.local import clean_comment_message, is_scrape_diagnostic_message


class TestEvidenceForTermNeedleMatching(unittest.TestCase):
    def setUp(self):
        self.matcher = KeywordEvidenceMatcher()

    def test_returns_zero_count_when_text_has_no_match(self):
        result = self.matcher.evidence_for_term("辣眼睛", "完全不相关的评论文本在这里")
        self.assertEqual(result["evidenceCount"], 0)
        self.assertEqual(result["evidenceSamples"], [])
        self.assertEqual(result["evidenceSources"], [])

    def test_counts_a_single_match(self):
        result = self.matcher.evidence_for_term("辣眼睛", "这个视频真是辣眼睛啊")
        self.assertEqual(result["evidenceCount"], 1)
        self.assertEqual(len(result["evidenceSamples"]), 1)
        self.assertIn("辣眼睛", result["evidenceSamples"][0])

    def test_counts_non_overlapping_repeats_on_one_line(self):
        result = self.matcher.evidence_for_term("辣眼睛", "辣眼睛辣眼睛辣眼睛")
        # three non-overlapping occurrences
        self.assertEqual(result["evidenceCount"], 3)

    def test_matches_per_line_and_aggregates_count_across_lines(self):
        text = "第一行辣眼睛\n第二行无关\n第三行又是辣眼睛"
        result = self.matcher.evidence_for_term("辣眼睛", text)
        self.assertEqual(result["evidenceCount"], 2)
        self.assertEqual(len(result["evidenceSamples"]), 2)

    def test_aliases_also_match(self):
        # 问百度 aliases: 不会百度, 自己百度, 你不会百度吗, ...
        text = "你不会百度吗？这种问题自己百度一下"
        result = self.matcher.evidence_for_term("问百度", text)
        # at least one alias hit
        self.assertGreater(result["evidenceCount"], 0)
        self.assertEqual(len(result["evidenceSamples"]), 1)

    def test_empty_or_missing_term_yields_zero(self):
        self.assertEqual(self.matcher.evidence_for_term("", "any text")["evidenceCount"], 0)
        self.assertEqual(self.matcher.evidence_for_term(None, "any text")["evidenceCount"], 0)

    def test_empty_text_yields_zero(self):
        self.assertEqual(self.matcher.evidence_for_term("辣眼睛", "")["evidenceCount"], 0)
        self.assertEqual(self.matcher.evidence_for_term("辣眼睛", None)["evidenceCount"], 0)
        self.assertEqual(self.matcher.evidence_for_term("辣眼睛", "   \n  ")["evidenceCount"], 0)

    def test_samples_capped_at_three(self):
        # 5 distinct lines each matching
        text = "\n".join(f"第{i}行辣眼睛内容" for i in range(5))
        result = self.matcher.evidence_for_term("辣眼睛", text)
        self.assertEqual(len(result["evidenceSamples"]), 3)
        self.assertEqual(len(result["evidenceSources"]), 0)  # no source/uid → no sources

    def test_long_sample_is_clipped_to_120_chars_with_ellipsis(self):
        long_line = "前缀" + "辣眼睛" + "填充" * 200  # well over 120 chars
        result = self.matcher.evidence_for_term("辣眼睛", long_line)
        sample = result["evidenceSamples"][0]
        self.assertGreater(len(sample), 120)
        self.assertTrue(sample.endswith("..."))

    def test_source_and_uid_propagate_into_evidence_sources(self):
        text = "这是辣眼睛的评论"
        result = self.matcher.evidence_for_term(
            "辣眼睛", text, source="bilibili-comment", uid="12345"
        )
        self.assertEqual(len(result["evidenceSources"]), 1)
        entry = result["evidenceSources"][0]
        self.assertEqual(entry["source"], "bilibili-comment")
        self.assertEqual(entry["uid"], "12345")
        self.assertIn("辣眼睛", entry["sample"])

    def test_source_omitted_when_both_source_and_uid_blank(self):
        result = self.matcher.evidence_for_term("辣眼睛", "辣眼睛评论")
        self.assertEqual(result["evidenceSources"], [])

    def test_result_keys_are_exactly_the_three_expected(self):
        result = self.matcher.evidence_for_term("辣眼睛", "辣眼睛")
        self.assertEqual(set(result.keys()), {"evidenceCount", "evidenceSamples", "evidenceSources"})


class TestIsScrapeDiagnosticMessage(unittest.TestCase):
    def test_detects_discover_403_with_host(self):
        msg = "discover: failed HTTP 403 from https://tieba.baidu.com/p/123"
        self.assertTrue(is_scrape_diagnostic_message(msg))

    def test_detects_explicit_tieba_thread_403(self):
        msg = "explicit Tieba thread URLs: blocked HTTP 403 from https://tieba.baidu.com/"
        self.assertTrue(is_scrape_diagnostic_message(msg))

    def test_detects_bilibili_host_5xx(self):
        msg = "upstream HTTP 502 from https://api.bilibili.com/x/v2/reply"
        self.assertTrue(is_scrape_diagnostic_message(msg))

    def test_detects_c_tieba_host_4xx(self):
        msg = "HTTP 412 from https://c.tieba.baidu.com/c/f/frs/page"
        self.assertTrue(is_scrape_diagnostic_message(msg))

    def test_detects_www_bilibili_host(self):
        msg = "HTTP 403 from https://www.bilibili.com/video/BV123"
        self.assertTrue(is_scrape_diagnostic_message(msg))

    def test_rejects_non_diagnostic_comment(self):
        self.assertFalse(is_scrape_diagnostic_message("这个视频真有意思哈哈哈"))
        self.assertFalse(is_scrape_diagnostic_message("HTTP 200 from https://api.bilibili.com/"))
        self.assertFalse(is_scrape_diagnostic_message(""))

    def test_rejects_4xx_5xx_from_unrecognized_host(self):
        # the host must be one of tieba/c.tieba/www.bilibili/api.bilibili
        self.assertFalse(is_scrape_diagnostic_message("HTTP 403 from https://example.com/foo"))

    def test_case_insensitive_http(self):
        self.assertTrue(is_scrape_diagnostic_message("http 403 from https://tieba.baidu.com/"))


class TestCleanCommentMessage(unittest.TestCase):
    def test_passes_through_normal_message_collapsing_whitespace(self):
        self.assertEqual(clean_comment_message("  hello   world  "), "hello world")

    def test_returns_empty_for_diagnostic_message(self):
        self.assertEqual(
            clean_comment_message("discover: HTTP 403 from https://tieba.baidu.com/p/1"),
            "",
        )

    def test_returns_empty_for_empty_input(self):
        self.assertEqual(clean_comment_message(""), "")
        self.assertEqual(clean_comment_message(None), "")

    def test_normal_comment_with_word_http_is_preserved(self):
        # 'HTTP' as part of normal text without the diagnostic pattern stays intact
        self.assertEqual(clean_comment_message("聊聊 HTTP 协议的发展"), "聊聊 HTTP 协议的发展")


if __name__ == "__main__":
    unittest.main()
