"""Unit tests for Python analyzer modules (Phase 3: Analyzer Clients).

Tests pure computation classes without network calls or file I/O.
"""

from __future__ import annotations

import unittest

from python_backend.analyzers.deepseek import (
    AnalyzerRequest,
    DeepSeekAnalysisInputBuilder,
    DeepSeekAnalysisNormalizer,
    DeepSeekAnalysisValidator,
    DeepSeekAnalyzerClient,
    DeepSeekRequestOptionsContract,
    normalize_deepseek_model,
    normalize_reasoning_effort,
)
from python_backend.analyzers.deepseek_config import (
    DeepSeekConfigStatusBuilder,
    DeepSeekConfigSummary,
    DeepSeekConfigContractComparator,
    DEEPSEEK_V4_MODELS,
    REASONING_EFFORTS,
)
from python_backend.analyzers.keyword_evidence import (
    # Classes
    KeywordEvidenceMatcher,
    KeywordEvidenceSummary,
    KeywordEvidenceContractComparator,
    # Constants
    TERM_EVIDENCE_ALIASES,
    # Module-level helpers
    _canonical_meaning_for_term,
    _clean_evidence_text,
    _clean_keyword_term,
    _clean_text,
    _deepseek_clean_keyword_term,
    _deepseek_clean_term,
    _eval_rule_condition,
    _evidence_sample_sort_key,
    _evidence_source_sort_key,
    _evidence_unit_count,
    _has_video_context_only_evidence,
    _is_ambiguous_benign_evidence_sample,
    _is_ascii_suffix_fragment_of,
    _is_ask_baidu_song_video_context_only_term,
    _is_misleading_car_army_video_context_only_term,
    _is_noisy_evidence_sample,
    _is_pure_ascii_suffix_only_fragment,
    _is_recovered_placeholder_meaning,
    _is_short_negated_attack_mention,
    _is_title_spliced_video_context_only_term,
    _is_video_context_sample,
    _is_video_context_source,
    _looks_like_mojibake_chinese,
    _merge_keyword_entry,
    _normalize_family,
    _prioritize_evidence_sources_for_samples,
    _prune_suffix_only_fragments,
    _recovered_meaning_for_term,
    _semantically_equal_ignoring_updated_at,
    _stable_json,
    _unique,
    _without_updated_at,
    normalize_keyword_entries,
)


class NormalizeReasoningEffortTests(unittest.TestCase):
    """Test normalize_reasoning_effort against all known alias forms."""

    def test_passthrough_valid_values(self):
        self.assertEqual(normalize_reasoning_effort("max"), "max")
        self.assertEqual(normalize_reasoning_effort("high"), "high")
        self.assertEqual(normalize_reasoning_effort("medium"), "medium")
        self.assertEqual(normalize_reasoning_effort("low"), "low")

    def test_normalizes_hyphenated_aliases(self):
        self.assertEqual(normalize_reasoning_effort("high-effort"), "high")
        self.assertEqual(normalize_reasoning_effort("medium-effort"), "medium")
        self.assertEqual(normalize_reasoning_effort("low-effort"), "low")

    def test_normalizes_compact_aliases(self):
        self.assertEqual(normalize_reasoning_effort("maxeffort"), "max")
        self.assertEqual(normalize_reasoning_effort("maximum"), "max")
        self.assertEqual(normalize_reasoning_effort("higheffort"), "high")
        self.assertEqual(normalize_reasoning_effort("mediumeffort"), "medium")
        self.assertEqual(normalize_reasoning_effort("loweffort"), "low")

    def test_normalizes_underscore_form(self):
        self.assertEqual(normalize_reasoning_effort("high_effort"), "high")

    def test_case_insensitive(self):
        self.assertEqual(normalize_reasoning_effort("MAX"), "max")
        self.assertEqual(normalize_reasoning_effort("High"), "high")

    def test_defaults_to_max(self):
        self.assertEqual(normalize_reasoning_effort(""), "max")
        self.assertEqual(normalize_reasoning_effort(None), "max")
        self.assertEqual(normalize_reasoning_effort("unknown"), "max")


class NormalizeDeepSeekModelTests(unittest.TestCase):
    """Test normalize_deepseek_model against all known alias forms."""

    def test_passthrough_canonical(self):
        self.assertEqual(normalize_deepseek_model("deepseek-v4-flash"), "deepseek-v4-flash")
        self.assertEqual(normalize_deepseek_model("deepseek-v4-pro"), "deepseek-v4-pro")

    def test_normalizes_compact_aliases(self):
        self.assertEqual(normalize_deepseek_model("deepseekv4flash"), "deepseek-v4-flash")
        self.assertEqual(normalize_deepseek_model("deepseekv4pro"), "deepseek-v4-pro")
        self.assertEqual(normalize_deepseek_model("v4flash"), "deepseek-v4-flash")
        self.assertEqual(normalize_deepseek_model("v4pro"), "deepseek-v4-pro")
        self.assertEqual(normalize_deepseek_model("flash"), "deepseek-v4-flash")
        self.assertEqual(normalize_deepseek_model("pro"), "deepseek-v4-pro")

    def test_case_insensitive(self):
        self.assertEqual(normalize_deepseek_model("FLASH"), "deepseek-v4-flash")
        self.assertEqual(normalize_deepseek_model("DeepSeek-V4-Pro"), "deepseek-v4-pro")

    def test_fallback_returns_input(self):
        self.assertEqual(normalize_deepseek_model("gpt-4"), "gpt-4")
        self.assertEqual(normalize_deepseek_model(""), "deepseek-v4-flash")


class AnalyzerRequestTests(unittest.TestCase):
    """Test AnalyzerRequest dataclass defaults and construction."""

    def test_defaults(self):
        req = AnalyzerRequest(comments=["hello"])
        self.assertEqual(req.comments, ["hello"])
        self.assertEqual(req.keyword_hints, [])
        self.assertEqual(req.source_comments, [])
        self.assertEqual(req.uid, "unknown")
        self.assertEqual(req.name, "unknown")
        self.assertEqual(req.model, "deepseek-v4-flash")
        self.assertEqual(req.effort, "max")
        self.assertFalse(req.multiagent)

    def test_full_construction(self):
        req = AnalyzerRequest(
            comments=["c1", "c2"],
            keyword_hints=[{"term": "test"}],
            source_comments=[{"text": "src"}],
            uid="user123",
            name="test-user",
            model="deepseek-v4-pro",
            effort="high",
            multiagent=True,
        )
        self.assertEqual(req.comments, ["c1", "c2"])
        self.assertEqual(req.uid, "user123")
        self.assertEqual(req.model, "deepseek-v4-pro")
        self.assertEqual(req.effort, "high")
        self.assertTrue(req.multiagent)

    def test_immutable(self):
        req = AnalyzerRequest(comments=["hello"])
        with self.assertRaises(Exception):
            req.comments = ["other"]  # type: ignore


class DeepSeekRequestOptionsContractTests(unittest.TestCase):
    """Test the stable chat request option payload builder."""

    def test_build_messages(self):
        req = AnalyzerRequest(comments=["test"], model="deepseek-v4-pro", effort="max")
        contract = DeepSeekRequestOptionsContract(req)
        result = contract.build(
            [{"role": "user", "content": "hello"}],
            max_tokens=1000,
        )
        self.assertEqual(result["model"], "deepseek-v4-pro")
        self.assertEqual(result["reasoning_effort"], "max")
        self.assertEqual(result["messages"], [{"role": "user", "content": "hello"}])
        self.assertEqual(result["response_format"], {"type": "json_object"})
        self.assertFalse(result["stream"])
        self.assertEqual(result["max_tokens"], 1000)

    def test_bounded_max_tokens(self):
        req = AnalyzerRequest(comments=["test"])
        contract = DeepSeekRequestOptionsContract(req)
        result = contract.build([{"role": "system", "content": "sys"}], max_tokens=0)
        self.assertEqual(result["max_tokens"], 1)
        result2 = contract.build([{"role": "system", "content": "sys"}], max_tokens=-5)
        self.assertEqual(result2["max_tokens"], 1)
        result3 = contract.build([{"role": "system", "content": "sys"}], max_tokens="invalid")
        self.assertEqual(result3["max_tokens"], 2000)


class DeepSeekAnalysisInputBuilderTests(unittest.TestCase):
    """Test the input builder that prepares JSON for DeepSeek prompts."""

    def setUp(self):
        self.builder = DeepSeekAnalysisInputBuilder()

    def test_build_default(self):
        req = AnalyzerRequest(comments=["hello world", "test comment"])
        result = self.builder.build(req)
        self.assertEqual(result["uid"], "unknown")
        self.assertIn("comments", result)
        self.assertIn("sourceComments", result)
        self.assertIn("keywordHints", result)

    def test_compact_limits_comments(self):
        req = AnalyzerRequest(comments=[f"comment {i}" for i in range(100)])
        result = self.builder.build(req, compact=True)
        self.assertLessEqual(len(result["comments"]), 40)

    def test_normalize_hints_filters_duplicates(self):
        hints = self.builder._normalize_hints([
            {"term": "test", "family": "", "meaning": ""},
            {"term": "test", "family": "", "meaning": ""},
        ])
        self.assertEqual(len(hints), 1)

    def test_normalize_hints_string_input(self):
        hints = self.builder._normalize_hints(["hello", "world"])
        self.assertEqual(len(hints), 2)
        self.assertEqual(hints[0]["term"], "hello")
        self.assertEqual(hints[0]["family"], "")
        self.assertEqual(hints[0]["meaning"], "")

    def test_normalize_hints_respects_limit(self):
        hints = self.builder._normalize_hints([{"term": f"t{i}"} for i in range(100)])
        self.assertLessEqual(len(hints), 80)

    def test_split_sentences(self):
        sentences = self.builder._split_sentences("Hello world。Another sentence！Final one.")
        self.assertIn("Hello world。", sentences)
        self.assertIn("Another sentence！", sentences)
        self.assertIn("Final one.", sentences)


class DeepSeekAnalyzerClientTests(unittest.TestCase):
    """Test the main analyzer client for building request contracts."""

    def setUp(self):
        self.client = DeepSeekAnalyzerClient()

    def test_build_request_from_payload_minimal(self):
        req = self.client.build_request_from_payload({"comments": ["hello", "world"]})
        self.assertEqual(req.comments, ["hello", "world"])
        self.assertEqual(req.uid, "unknown")
        self.assertFalse(req.multiagent)

    def test_build_request_from_payload_multiagent(self):
        req = self.client.build_request_from_payload({"comments": ["test"], "multiagent": True})
        self.assertTrue(req.multiagent)

    def test_build_request_from_payload_with_text_field(self):
        req = self.client.build_request_from_payload({"text": "single comment"})
        self.assertEqual(req.comments, ["single comment"])

    def test_build_payload_roundtrip(self):
        original = AnalyzerRequest(
            comments=["c1", "c2"],
            keyword_hints=[{"term": "hint"}],
            uid="user1",
            name="test",
            model="deepseek-v4-pro",
            effort="high",
            multiagent=True,
        )
        payload = self.client.build_payload(original)
        self.assertEqual(payload["uid"], "user1")
        self.assertEqual(payload["model"], "deepseek-v4-pro")
        self.assertTrue(payload["multiagent"])

    def test_build_chat_request_single_agent(self):
        req = AnalyzerRequest(comments=["hello world"])
        chat = self.client.build_chat_request(req)
        self.assertIn("model", chat)
        self.assertIn("messages", chat)
        self.assertEqual(chat["messages"][0]["role"], "system")
        self.assertEqual(chat["messages"][1]["role"], "user")
        self.assertFalse(chat["stream"])

    def test_build_chat_request_compact(self):
        req = AnalyzerRequest(comments=["test"])
        chat = self.client.build_chat_request(req, compact=True)
        self.assertEqual(chat["max_tokens"], 8192)

    def test_build_request_plan_single_agent(self):
        req = AnalyzerRequest(comments=["test"], multiagent=False)
        plan = self.client.build_request_plan(req)
        self.assertEqual(len(plan), 1)

    def test_build_request_plan_multiagent(self):
        req = AnalyzerRequest(comments=["test"], multiagent=True)
        plan = self.client.build_request_plan(req)
        self.assertEqual(len(plan), 3)  # 3 multiagent specialists

    def test_build_request_plan_multiagent_compact(self):
        req = AnalyzerRequest(comments=["test"], multiagent=True)
        plan = self.client.build_request_plan(req, compact=True)
        self.assertEqual(len(plan), 3)
        for p in plan:
            self.assertLessEqual(p["max_tokens"], 4000)

    def test_keyword_hints_from_payload_explicit(self):
        hints = self.client._keyword_hints_from_payload({
            "keywordHints": [{"term": "explicit"}],
        })
        self.assertEqual(len(hints), 1)
        self.assertEqual(hints[0]["term"], "explicit")

    def test_keyword_hints_from_payload_empty(self):
        hints = self.client._keyword_hints_from_payload({})
        self.assertEqual(hints, [])

    def test_comments_from_payload_dict_items(self):
        comments = self.client._comments_from_payload({
            "comments": [{"message": "hello"}, {"message": "world"}],
        })
        self.assertEqual(comments, ["hello", "world"])

    def test_comments_from_payload_string_items(self):
        comments = self.client._comments_from_payload({
            "comments": ["direct string 1", "direct string 2"],
        })
        self.assertEqual(comments, ["direct string 1", "direct string 2"])

    def test_source_comments_from_payload(self):
        src = self.client._source_comments_from_payload({
            "comments": [{"message": "hello", "rpid": "123", "author": "test"}],
        })
        self.assertEqual(len(src), 1)
        self.assertEqual(src[0]["text"], "hello")
        self.assertEqual(src[0]["rpid"], "123")

    def test_multiagent_specialists_have_required_fields(self):
        for agent in self.client.MULTIAGENTS:
            self.assertIn("id", agent)
            self.assertIn("name", agent)
            self.assertIn("focus", agent)


class DeepSeekAnalysisValidatorTests(unittest.TestCase):
    """Test analysis validation that checks quotes against source comments."""

    def setUp(self):
        self.validator = DeepSeekAnalysisValidator()

    def test_validate_empty(self):
        result = self.validator.validate([], {})
        self.assertTrue(result["ok"])
        self.assertEqual(result["summary"]["sourceSentences"], 0)

    def test_validate_supported_quotes(self):
        comments = ["Hello world。Test sentence。"]
        analysis = {
            "sentenceAnalyses": [
                {"quote": "Hello world。", "speechAct": "statement"},
                {"quote": "Test sentence。", "speechAct": "question"},
            ],
        }
        result = self.validator.validate(comments, analysis)
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["unsupportedQuotes"]), 0)

    def test_validate_unsupported_quotes(self):
        comments = ["Only this sentence。"]
        analysis = {
            "sentenceAnalyses": [
                {"quote": "Made up quote that doesn't exist", "speechAct": "fake"},
            ],
        }
        result = self.validator.validate(comments, analysis)
        self.assertFalse(result["ok"])
        self.assertGreater(len(result["unsupportedQuotes"]), 0)

    def test_validate_axis_evidence(self):
        comments = ["Evidence present here。"]
        analysis = {
            "axes": [
                {"axis": "对抗性动机", "score": 60, "evidence": ["Evidence present here。"], "reasoning": "valid"},
            ],
        }
        result = self.validator.validate(comments, analysis)
        self.assertTrue(result["ok"])

    def test_normalize_quote_strips_whitespace(self):
        normalized = self.validator._normalize_quote("  Hello   World  ")
        self.assertEqual(normalized, "helloworld")


class DeepSeekAnalysisNormalizerTests(unittest.TestCase):
    """Test analysis normalization into the JS runtime result contract."""

    def setUp(self):
        self.normalizer = DeepSeekAnalysisNormalizer()

    def test_normalize_minimal_returns_contract(self):
        result = self.normalizer.normalize({}, {})
        self.assertTrue(result["ok"])
        self.assertEqual(result["provider"], "deepseek")
        self.assertEqual(len(result["axes"]), 6)
        self.assertEqual(result["axes"][0]["axis"], "对抗性动机")
        self.assertEqual(result["axes"][0]["score"], 50)

    def test_normalize_preserves_configured_model(self):
        result = self.normalizer.normalize({}, {}, model="deepseek-v4-pro", reasoning_effort="high")
        self.assertEqual(result["model"], "deepseek-v4-pro")
        self.assertEqual(result["reasoningEffort"], "high")

    def test_normalize_retried_compact_prompt_flag(self):
        result = self.normalizer.normalize({}, {}, retried_compact_prompt=True)
        self.assertTrue(result["retriedCompactPrompt"])

    def test_normalize_axis_label_normalization(self):
        label = self.normalizer._normalize_axis_label("attack")
        self.assertEqual(label, "对抗性动机")
        label2 = self.normalizer._normalize_axis_label("closure")
        self.assertEqual(label2, "认知闭合")
        label3 = self.normalizer._normalize_axis_label("evidence")
        self.assertEqual(label3, "证据敏感")

    def test_normalize_axis_label_empty(self):
        self.assertEqual(self.normalizer._normalize_axis_label(""), "")
        self.assertEqual(self.normalizer._normalize_axis_label("a|b"), "")

    def test_normalize_axis_label_fuzzy_match(self):
        label = self.normalizer._normalize_axis_label("对抗性动机分析")
        self.assertEqual(label, "对抗性动机")

    def test_normalize_clamps_confidence(self):
        result = self.normalizer.normalize({}, {"parsed": {"confidence": 1.5}})
        self.assertEqual(result["confidence"], 0.92)
        result2 = self.normalizer.normalize({}, {"parsed": {"confidence": -0.5}})
        self.assertEqual(result2["confidence"], 0.45)
        result3 = self.normalizer.normalize({}, {"parsed": {"confidence": 0.75}})
        self.assertEqual(result3["confidence"], 0.75)

    def test_normalize_overall_risk_band(self):
        result = self.normalizer.normalize(
            {}, {"parsed": {"overall": {"riskBand": "低风险讨论型", "summary": "safe"}}}
        )
        self.assertEqual(result["overall"]["riskBand"], "低风险讨论型")

    def test_ground_sentence_quote_exact_match(self):
        sentences = ["Hello world。", "Test。"]
        grounded = self.normalizer._ground_sentence_quote("Hello world。", sentences)
        self.assertEqual(grounded, "Hello world。")

    def test_ground_sentence_quote_substring_match(self):
        sentences = ["This is a long sentence with Hello world inside。"]
        grounded = self.normalizer._ground_sentence_quote("Hello world", sentences)
        self.assertEqual(grounded, "This is a long sentence with Hello world inside。")

    def test_ground_sentence_quote_no_match(self):
        grounded = self.normalizer._ground_sentence_quote("nonexistent", ["Only this。"])
        self.assertEqual(grounded, "")

    def test_has_explicit_correction_evidence_true(self):
        self.assertTrue(self.normalizer._has_explicit_correction_evidence("我承认错误"))
        self.assertTrue(self.normalizer._has_explicit_correction_evidence("说错了 我收回"))
        self.assertTrue(self.normalizer._has_explicit_correction_evidence("谢谢指正"))

    def test_has_explicit_correction_evidence_false(self):
        self.assertFalse(self.normalizer._has_explicit_correction_evidence("没有承认"))
        self.assertFalse(self.normalizer._has_explicit_correction_evidence("random text"))

    def test_axis_has_usable_evidence_correction_special(self):
        # "no evidence" won't match English correction patterns (unlike "no correction" which
        # matches the \bcorrect(?:ed|ion)?\b regex)
        self.assertFalse(
            self.normalizer._axis_has_usable_evidence("修正意愿", ["test"], "no evidence of change", "")
        )
        self.assertTrue(
            self.normalizer._axis_has_usable_evidence("修正意愿", ["我收回之前的说法"], "", "我收回之前的说法")
        )


class DeepSeekConfigStatusBuilderTests(unittest.TestCase):
    """Test DeepSeek config/status payload builder."""

    def test_no_api_key(self):
        builder = DeepSeekConfigStatusBuilder(env={})
        result = builder.build()
        self.assertFalse(result["ok"])
        self.assertFalse(result["available"])
        self.assertFalse(result["keyConfigured"])
        self.assertIn("error", result)

    def test_with_api_key_and_models(self):
        builder = DeepSeekConfigStatusBuilder(
            env={"DEEPSEEK_API_KEY": "sk-test"},
            models=["deepseek-v4-flash", "deepseek-v4-pro"],
        )
        result = builder.build()
        self.assertTrue(result["ok"])
        self.assertTrue(result["available"])
        self.assertTrue(result["keyConfigured"])
        self.assertIn(result["model"], DEEPSEEK_V4_MODELS)

    def test_model_list_error(self):
        builder = DeepSeekConfigStatusBuilder(
            env={"DEEPSEEK_API_KEY": "sk-test"},
            model_list_error="Connection refused",
        )
        result = builder.build()
        self.assertTrue(result["ok"])
        self.assertIn("warning", result)

    def test_configured_model_fallback(self):
        builder = DeepSeekConfigStatusBuilder(
            env={"DEEPSEEK_API_KEY": "sk-test", "DEEPSEEK_MODEL": "gpt-4"},
            models=["deepseek-v4-flash"],
        )
        result = builder.build()
        self.assertEqual(result["configuredModel"], "gpt-4")
        self.assertEqual(result["model"], "deepseek-v4-flash")

    def test_reasoning_effort_validation(self):
        builder = DeepSeekConfigStatusBuilder(
            env={"DEEPSEEK_API_KEY": "sk-test", "DEEPSEEK_REASONING_EFFORT": "invalid"},
        )
        result = builder.build()
        self.assertEqual(result["reasoningEffort"], "max")

    def test_valid_reasoning_efforts(self):
        for effort in REASONING_EFFORTS:
            with self.subTest(effort=effort):
                builder = DeepSeekConfigStatusBuilder(
                    env={"DEEPSEEK_API_KEY": "sk-test", "DEEPSEEK_REASONING_EFFORT": effort},
                )
                result = builder.build()
                self.assertEqual(result["reasoningEffort"], effort)

    def test_base_url_trailing_slash_removed(self):
        builder = DeepSeekConfigStatusBuilder(
            env={"DEEPSEEK_API_KEY": "sk-test", "DEEPSEEK_BASE_URL": "https://custom.api.com/"},
        )
        result = builder.build()
        self.assertEqual(result["baseUrl"], "https://custom.api.com")


class DeepSeekConfigSummaryTests(unittest.TestCase):
    """Test config summary contract keys."""

    def test_summarize_full_result(self):
        summary = DeepSeekConfigSummary()
        result = {
            "ok": True,
            "provider": "deepseek",
            "baseUrl": "https://api.deepseek.com",
            "model": "deepseek-v4-pro",
            "configuredModel": "deepseek-v4-pro",
            "reasoningEffort": "max",
            "available": True,
            "keyConfigured": True,
            "models": DEEPSEEK_V4_MODELS,
            "error": None,
            "warning": None,
        }
        summarized = summary.summarize(result)
        for key in DeepSeekConfigSummary.RESULT_KEYS:
            if key in result:
                self.assertIn(key, summarized)

    def test_compare_no_mismatches(self):
        comparator = DeepSeekConfigContractComparator()
        result = {"ok": True, "provider": "deepseek", "model": "deepseek-v4-pro", "available": True}
        comparison = comparator.compare(result, result)
        self.assertTrue(comparison["ok"])
        self.assertEqual(len(comparison["mismatches"]), 0)

    def test_compare_detects_mismatches(self):
        comparator = DeepSeekConfigContractComparator()
        py = {"ok": True, "provider": "deepseek", "model": "deepseek-v4-pro"}
        js = {"ok": True, "provider": "deepseek", "model": "deepseek-v4-flash"}
        comparison = comparator.compare(py, js)
        self.assertFalse(comparison["ok"])
        self.assertGreater(len(comparison["mismatches"]), 0)


class KeywordEvidenceSummaryTests(unittest.TestCase):
    """Test keyword evidence summary contract."""

    def test_summarize_extracts_contract_keys(self):
        summary = KeywordEvidenceSummary()
        result = {"ok": True, "mode": "multiagent", "count": 5, "entries": [], "extra": "ignored"}
        summarized = summary.summarize(result)
        self.assertIn("ok", summarized)
        self.assertIn("mode", summarized)
        self.assertIn("count", summarized)
        self.assertIn("entries", summarized)
        self.assertNotIn("extra", summarized)

    def test_summarize_none(self):
        summary = KeywordEvidenceSummary()
        summarized = summary.summarize(None)
        self.assertEqual(summarized, {})

    def test_summarize_partial(self):
        summary = KeywordEvidenceSummary()
        summarized = summary.summarize({"ok": False})
        self.assertEqual(summarized, {"ok": False})


class KeywordEvidenceTermAliasesTests(unittest.TestCase):
    """Test TERM_EVIDENCE_ALIASES are well-formed."""

    def test_all_aliases_are_strings(self):
        for term, aliases in TERM_EVIDENCE_ALIASES.items():
            with self.subTest(term=term):
                self.assertIsInstance(term, str)
                self.assertIsInstance(aliases, list)
                for alias in aliases:
                    self.assertIsInstance(alias, str)

    def test_empty_aliases_allowed(self):
        comparator = KeywordEvidenceContractComparator()
        result = comparator.compare(
            {"ok": True, "mode": "single", "count": 0, "entries": []},
            {"ok": True, "mode": "single", "count": 0, "entries": []},
        )
        self.assertIn("ok", result)


# =============================================================================
# Module-level pure function tests
# =============================================================================


class CleanTextHelperTests(unittest.TestCase):
    """Test _clean_text, _clean_keyword_term, _clean_evidence_text, _unique."""

    def test_clean_text_collapses_whitespace(self):
        self.assertEqual(_clean_text("  hello   world  "), "hello world")

    def test_clean_text_empty_and_none(self):
        self.assertEqual(_clean_text(None), "")
        self.assertEqual(_clean_text(""), "")

    def test_clean_text_non_string(self):
        self.assertEqual(_clean_text(123), "123")

    def test_clean_keyword_term_lowercases(self):
        self.assertEqual(_clean_keyword_term("Hello World"), "hello world")

    def test_clean_keyword_term_empty(self):
        self.assertEqual(_clean_keyword_term(None), "")
        self.assertEqual(_clean_keyword_term(""), "")

    def test_clean_evidence_text_lowercases(self):
        self.assertEqual(_clean_evidence_text("ABC DEF"), "abc def")

    def test_unique_deduplicates_preserving_order(self):
        self.assertEqual(_unique(["a", "b", "a", "c"]), ["a", "b", "c"])

    def test_unique_empty_and_blank(self):
        self.assertEqual(_unique([]), [])
        self.assertEqual(_unique([""]), [])

    def test_unique_skips_empty_string_key(self):
        self.assertEqual(_unique(["a", "", "b"]), ["a", "b"])


class NormalizeFamilyTests(unittest.TestCase):
    """Test _normalize_family mapping."""

    def test_supported_family_passthrough(self):
        for family in ("attack", "absolutes", "evidence", "evasion", "cooperation", "correction"):
            with self.subTest(family=family):
                self.assertEqual(_normalize_family(family), family)

    def test_alias_mapping(self):
        cases = {"sarcasm": "attack", "insult": "attack", "meme": "cooperation",
                 "absolute": "absolutes", "source": "evidence", "dodge": "evasion",
                 "revision": "correction"}
        for alias, expected in cases.items():
            with self.subTest(alias=alias):
                self.assertEqual(_normalize_family(alias), expected)

    def test_unknown_family_defaults_to_attack(self):
        self.assertEqual(_normalize_family("unknown"), "attack")
        self.assertEqual(_normalize_family(""), "attack")
        self.assertEqual(_normalize_family(None), "attack")


class DeepseekCleanTermTests(unittest.TestCase):
    """Test _deepseek_clean_term — NFKC + CJK/alphanum preservation."""

    def test_removes_non_alphanumeric(self):
        self.assertEqual(_deepseek_clean_term("hello, world!"), "helloworld")

    def test_preserves_cjk_and_alphanum(self):
        self.assertEqual(_deepseek_clean_term("测试abc123"), "测试abc123")

    def test_strips_leading_digits_before_baifenbai(self):
        self.assertEqual(_deepseek_clean_term("100百分百"), "百分百")

    def test_keeps_digits_without_baifenbai(self):
        self.assertEqual(_deepseek_clean_term("100测试"), "100测试")

    def test_does_not_strip_mid_word_digits_before_baifenbai(self):
        self.assertEqual(_deepseek_clean_term("abc100百分百"), "abc100百分百")

    def test_empty_and_none(self):
        self.assertEqual(_deepseek_clean_term(None), "")
        self.assertEqual(_deepseek_clean_term(""), "")


class DeepseekCleanKeywordTermTests(unittest.TestCase):
    """Test _deepseek_clean_keyword_term — mojibake, prefix, doge cleanup."""

    def test_removes_non_alphanumeric_and_lowercases(self):
        self.assertEqual(_deepseek_clean_keyword_term("Hello World!!"), "helloworld")

    def test_strips_rexi_prefix(self):
        self.assertEqual(_deepseek_clean_keyword_term("热词系列测试"), "测试")

    def test_strips_trailing_doge_with_cjk(self):
        self.assertEqual(_deepseek_clean_keyword_term("测试doge"), "测试")

    def test_preserves_doge_without_cjk(self):
        self.assertEqual(_deepseek_clean_keyword_term("mydoge"), "mydoge")

    def test_short_doge_not_stripped(self):
        self.assertEqual(_deepseek_clean_keyword_term("adoge"), "adoge")

    def test_empties_on_mojibake(self):
        self.assertEqual(_deepseek_clean_keyword_term("锻abc123"), "")

    def test_empty_and_none(self):
        self.assertEqual(_deepseek_clean_keyword_term(None), "")
        self.assertEqual(_deepseek_clean_keyword_term(""), "")


class LooksLikeMojibakeChineseTests(unittest.TestCase):
    """Test _looks_like_mojibake_chinese detection."""

    def test_empty_or_no_cjk_returns_false(self):
        self.assertFalse(_looks_like_mojibake_chinese(None))
        self.assertFalse(_looks_like_mojibake_chinese(""))
        self.assertFalse(_looks_like_mojibake_chinese("abc"))

    def test_known_mojibake_prefix(self):
        self.assertTrue(_looks_like_mojibake_chinese("锻abc"))
        self.assertTrue(_looks_like_mojibake_chinese("鏂abc"))

    def test_replacement_character(self):
        self.assertTrue(_looks_like_mojibake_chinese("试ab�cd"))
        self.assertTrue(_looks_like_mojibake_chinese("试ab??cd"))

    def test_marker_chars_high_ratio(self):
        self.assertTrue(_looks_like_mojibake_chinese("锟斤拷"))

    def test_single_marker_char_low_ratio_returns_false(self):
        self.assertFalse(_looks_like_mojibake_chinese("锟abc"))

    def test_clean_chinese_returns_false(self):
        self.assertFalse(_looks_like_mojibake_chinese("你好世界"))


class IsRecoveredPlaceholderMeaningTests(unittest.TestCase):
    """Test _is_recovered_placeholder_meaning detection."""

    def test_exact_match(self):
        self.assertTrue(_is_recovered_placeholder_meaning(
            "Recovered term metadata after an interrupted local dictionary write"
        ))

    def test_case_insensitive(self):
        self.assertTrue(_is_recovered_placeholder_meaning(
            "recovered term metadata after an interrupted local dictionary write"
        ))

    def test_normal_meaning_returns_false(self):
        self.assertFalse(_is_recovered_placeholder_meaning("Some normal meaning"))
        self.assertFalse(_is_recovered_placeholder_meaning(None))
        self.assertFalse(_is_recovered_placeholder_meaning(""))


class RecoveredMeaningForTermTests(unittest.TestCase):
    """Test _recovered_meaning_for_term templates."""

    def test_attack_family(self):
        result = _recovered_meaning_for_term("傻逼", "attack")
        self.assertIn("傻逼", result)
        self.assertIn("嘲讽", result)

    def test_absolutes_family(self):
        result = _recovered_meaning_for_term("永远", "absolutes")
        self.assertIn("永远", result)
        self.assertIn("强断言", result)

    def test_evidence_family(self):
        result = _recovered_meaning_for_term("出处", "evidence")
        self.assertIn("出处", result)
        self.assertIn("来源", result)

    def test_evasion_family(self):
        result = _recovered_meaning_for_term("你猜", "evasion")
        self.assertIn("你猜", result)
        self.assertIn("暗示", result)

    def test_cooperation_family(self):
        result = _recovered_meaning_for_term("顶", "cooperation")
        self.assertIn("顶", result)
        self.assertIn("支持", result)

    def test_correction_family(self):
        result = _recovered_meaning_for_term("更正", "correction")
        self.assertIn("更正", result)
        self.assertIn("修正", result)

    def test_unknown_family(self):
        result = _recovered_meaning_for_term("test", "unknown")
        self.assertIn("test", result)
        self.assertIn("语用义", result)


class CanonicalMeaningForTermTests(unittest.TestCase):
    """Test _canonical_meaning_for_term special cases."""

    def test_ruanwen_evidence_special_case(self):
        result = _canonical_meaning_for_term("软文", "evidence", "original")
        self.assertIn("软文", result)
        self.assertIn("付费宣传", result)

    def test_ruanwen_other_family_passthrough(self):
        result = _canonical_meaning_for_term("软文", "attack", "original meaning")
        self.assertEqual(result, "original meaning")

    def test_other_term_passthrough(self):
        result = _canonical_meaning_for_term("其他", "attack", "some meaning")
        self.assertEqual(result, "some meaning")

    def test_none_meaning_returns_empty_string(self):
        result = _canonical_meaning_for_term("其他", "attack", None)
        self.assertEqual(result, "")


class IsAsciiSuffixFragmentOfTests(unittest.TestCase):
    """Test _is_ascii_suffix_fragment_of — suffix fragment matching."""

    def test_suffix_fragment_match(self):
        self.assertTrue(_is_ascii_suffix_fragment_of("world", "helloworld"))

    def test_fragment_too_short(self):
        self.assertFalse(_is_ascii_suffix_fragment_of("ab", "abcdef"))

    def test_term_too_short(self):
        self.assertFalse(_is_ascii_suffix_fragment_of("abcd", "efabcd"))

    def test_not_a_suffix(self):
        self.assertFalse(_is_ascii_suffix_fragment_of("abcd", "xyzabcde"))

    def test_length_gap_below_minimum(self):
        self.assertFalse(_is_ascii_suffix_fragment_of("hello", "yhello"))

    def test_non_alpha_fragment(self):
        self.assertFalse(_is_ascii_suffix_fragment_of("1234", "abc1234"))


class IsNoisyEvidenceSampleTests(unittest.TestCase):
    """Test _is_noisy_evidence_sample — noisy sample detection."""

    def test_empty_or_none(self):
        self.assertTrue(_is_noisy_evidence_sample(None))
        self.assertTrue(_is_noisy_evidence_sample(""))

    def test_yiyi_pattern(self):
        self.assertTrue(_is_noisy_evidence_sample("异议！"))
        self.assertTrue(_is_noisy_evidence_sample("异议[doge]"))
        self.assertTrue(_is_noisy_evidence_sample("异议（幻听）"))

    def test_diaoxiaozhenzhu(self):
        self.assertTrue(_is_noisy_evidence_sample("掉小珍珠了，呜呜"))

    def test_baidu_netdisk_patterns(self):
        self.assertTrue(_is_noisy_evidence_sample("百度网盘分享的文件xxx"))
        self.assertTrue(_is_noisy_evidence_sample("通过百度网盘分享"))
        self.assertTrue(_is_noisy_evidence_sample("超级会员v3"))

    def test_clean_samples_are_not_noisy(self):
        self.assertFalse(_is_noisy_evidence_sample("正常评论内容"))
        self.assertFalse(_is_noisy_evidence_sample("这是一个正常的句子"))


class VideoContextHelperTests(unittest.TestCase):
    """Test _is_video_context_sample, _evidence_sample_sort_key, _is_video_context_source."""

    def test_video_context_prefix_detected(self):
        self.assertTrue(_is_video_context_sample("Bilibili video context: some title"))
        self.assertTrue(_is_video_context_sample("Bilibili public video title: some title"))

    def test_non_video_sample_not_detected(self):
        self.assertFalse(_is_video_context_sample("regular comment"))
        self.assertFalse(_is_video_context_sample(""))
        self.assertFalse(_is_video_context_sample(None))

    def test_video_sample_sort_key_is_1(self):
        self.assertEqual(_evidence_sample_sort_key("Bilibili video context: title"), 1)

    def test_non_video_sort_key_is_0(self):
        self.assertEqual(_evidence_sample_sort_key("regular comment"), 0)
        self.assertEqual(_evidence_sample_sort_key(""), 0)

    def test_video_context_source_checks_sample(self):
        self.assertTrue(_is_video_context_source({"sample": "Bilibili video context: title"}))

    def test_video_context_source_checks_source_text(self):
        source = {"source": "search-discovered video context", "sample": "something"}
        self.assertTrue(_is_video_context_source(source))

    def test_non_dict_source_returns_false(self):
        self.assertFalse(_is_video_context_source(None))
        self.assertFalse(_is_video_context_source("string"))

    def test_regular_source_returns_false(self):
        self.assertFalse(_is_video_context_source({"source": "user comment", "sample": "hello"}))


class HasVideoContextOnlyEvidenceTests(unittest.TestCase):
    """Test _has_video_context_only_evidence — all-samples-are-video check."""

    def test_empty_returns_false(self):
        self.assertFalse(_has_video_context_only_evidence(None, None))
        self.assertFalse(_has_video_context_only_evidence([], []))

    def test_all_video_context_returns_true(self):
        samples = ["Bilibili video context: title1", "Bilibili video context: title2"]
        self.assertTrue(_has_video_context_only_evidence(samples))

    def test_mixed_returns_false(self):
        samples = ["Bilibili video context: title", "regular comment"]
        self.assertFalse(_has_video_context_only_evidence(samples))

    def test_all_non_video_returns_false(self):
        self.assertFalse(_has_video_context_only_evidence(["comment1", "comment2"]))

    def test_sources_are_checked_too(self):
        sources = [{"sample": "Bilibili video context: title"}]
        self.assertTrue(_has_video_context_only_evidence([], sources))

    def test_mixed_samples_and_sources(self):
        samples = ["regular"]
        sources = [{"sample": "Bilibili video context: title"}]
        self.assertFalse(_has_video_context_only_evidence(samples, sources))


class VideoContextOnlyTermTests(unittest.TestCase):
    """Test _is_title_spliced_video_context_only_term, _is_ask_baidu_song_video_context_only_term,
    _is_misleading_car_army_video_context_only_term."""

    # ---- _is_title_spliced_video_context_only_term ----

    def test_title_spliced_not_video_only_returns_false(self):
        self.assertFalse(_is_title_spliced_video_context_only_term("卡脖子", [], []))

    def test_title_spliced_kabozi_exception(self):
        samples = ["Bilibili video context: 卡脖子"]
        self.assertFalse(_is_title_spliced_video_context_only_term("卡脖子", samples, []))

    def test_title_spliced_matches_pattern(self):
        samples = ["Bilibili video context: 卡别人脖子"]
        self.assertTrue(_is_title_spliced_video_context_only_term("卡别人脖子", samples, []))

    def test_title_spliced_does_not_match_pattern(self):
        samples = ["Bilibili video context: 卡脖"]
        self.assertFalse(_is_title_spliced_video_context_only_term("卡脖", samples, []))

    # ---- _is_ask_baidu_song_video_context_only_term ----

    def test_ask_baidu_song_not_ask_baidu_term(self):
        self.assertFalse(_is_ask_baidu_song_video_context_only_term("其他", [], []))

    def test_ask_baidu_song_not_video_only(self):
        self.assertFalse(_is_ask_baidu_song_video_context_only_term("问百度", [], []))

    def test_ask_baidu_song_matches(self):
        samples = ["Bilibili video context: 《问百度》歌曲很好听"]
        self.assertTrue(_is_ask_baidu_song_video_context_only_term("问百度", samples, []))

    def test_ask_baidu_song_no_song_context(self):
        samples = ["Bilibili video context: 问百度是什么意思"]
        self.assertFalse(_is_ask_baidu_song_video_context_only_term("问百度", samples, []))

    # ---- _is_misleading_car_army_video_context_only_term ----

    def test_car_army_not_car_army_term(self):
        self.assertFalse(_is_misleading_car_army_video_context_only_term("其他", [], []))

    def test_car_army_not_video_only(self):
        self.assertFalse(_is_misleading_car_army_video_context_only_term("车家军", [], []))

    def test_car_army_space_content_excluded(self):
        samples = ["Bilibili video context: 航天车家军威武"]
        self.assertTrue(_is_misleading_car_army_video_context_only_term("车家军", samples, []))

    def test_car_army_car_keywords_acceptable(self):
        samples = ["Bilibili video context: 小米SU7车家军"]
        self.assertFalse(_is_misleading_car_army_video_context_only_term("车家军", samples, []))

    def test_car_army_no_car_keywords(self):
        samples = ["Bilibili video context: 车家军真厉害"]
        self.assertTrue(_is_misleading_car_army_video_context_only_term("车家军", samples, []))

    def test_car_army_meiyou_chejiajun_matches(self):
        samples = ["Bilibili video context: 没有车家军"]
        self.assertTrue(_is_misleading_car_army_video_context_only_term("没有车家军", samples, []))

    def test_car_army_meiyou_with_car_context_acceptable(self):
        samples = ["Bilibili video context: 小米没有车家军"]
        self.assertFalse(_is_misleading_car_army_video_context_only_term("没有车家军", samples, []))


class EvidenceUnitCountTests(unittest.TestCase):
    """Test _evidence_unit_count — unique evidence unit counting."""

    def test_empty_returns_zero(self):
        self.assertEqual(_evidence_unit_count(None, None), 0)
        self.assertEqual(_evidence_unit_count([], []), 0)

    def test_samples_counted(self):
        self.assertEqual(_evidence_unit_count(["a", "b", "c"]), 3)

    def test_samples_deduplicated(self):
        self.assertEqual(_evidence_unit_count(["a", "a", "b"]), 2)

    def test_sources_with_samples_counted(self):
        sources = [{"sample": "a"}, {"sample": "b"}]
        self.assertEqual(_evidence_unit_count([], sources), 2)

    def test_samples_and_sources_deduplicated_across(self):
        sources = [{"sample": "a"}]
        self.assertEqual(_evidence_unit_count(["a"], sources), 1)

    def test_source_without_sample_uses_source_and_uid(self):
        sources = [{"source": "src1", "uid": "uid1"}]
        self.assertEqual(_evidence_unit_count([], sources), 1)

    def test_source_without_sample_or_uid_ignored(self):
        sources = [{"source": ""}]
        self.assertEqual(_evidence_unit_count([], sources), 0)

    def test_non_dict_source_ignored(self):
        sources = ["not a dict"]
        self.assertEqual(_evidence_unit_count([], sources), 0)

    def test_blank_samples_skipped(self):
        self.assertEqual(_evidence_unit_count(["a", "", "b"]), 2)


class IsShortNegatedAttackMentionTests(unittest.TestCase):
    """Test _is_short_negated_attack_mention — negation prefix detection."""

    def test_negated_mention_returns_true(self):
        self.assertTrue(_is_short_negated_attack_mention("傻逼", "没有傻逼"))

    def test_term_starts_with_negation_returns_false(self):
        self.assertFalse(_is_short_negated_attack_mention("不是东西", "不是东西"))

    def test_sample_too_long_returns_false(self):
        self.assertFalse(_is_short_negated_attack_mention("傻逼", "这是一个很长的句子没有傻逼在里面"))

    def test_not_negated_returns_false(self):
        self.assertFalse(_is_short_negated_attack_mention("傻逼", "你就是傻逼"))

    def test_empty_sample_returns_false(self):
        self.assertFalse(_is_short_negated_attack_mention("傻逼", ""))

    def test_different_negation_prefixes(self):
        self.assertTrue(_is_short_negated_attack_mention("傻逼", "不是傻逼"))
        self.assertTrue(_is_short_negated_attack_mention("傻逼", "没傻逼"))
        self.assertTrue(_is_short_negated_attack_mention("傻逼", "无傻逼"))


class IsPureAsciiSuffixOnlyFragmentTests(unittest.TestCase):
    """Test _is_pure_ascii_suffix_only_fragment — ASCII suffix fragment detection."""

    def test_non_ascii_term_returns_false(self):
        self.assertFalse(_is_pure_ascii_suffix_only_fragment({"term": "测试"}, []))

    def test_short_ascii_term_returns_false(self):
        self.assertFalse(_is_pure_ascii_suffix_only_fragment({"term": "abc"}, []))

    def test_not_suffix_of_any_other(self):
        entry = {"term": "hello", "family": "attack", "meaning": "greeting"}
        other = {"term": "hellomundo", "family": "attack", "meaning": "greeting"}
        self.assertFalse(_is_pure_ascii_suffix_only_fragment(entry, [entry, other]))

    def test_is_suffix_fragment(self):
        entry = {"term": "world", "family": "attack", "meaning": "test"}
        other = {"term": "helloworld", "family": "attack", "meaning": "test"}
        self.assertTrue(_is_pure_ascii_suffix_only_fragment(entry, [entry, other]))


class PruneSuffixOnlyFragmentsTests(unittest.TestCase):
    """Test _prune_suffix_only_fragments — filtering suffix-only entries."""

    def test_no_fragments_preserves_all(self):
        entries = [{"term": "测试"}]
        self.assertEqual(_prune_suffix_only_fragments(entries), entries)

    def test_prunes_suffix_fragment(self):
        entries = [
            {"term": "world", "family": "attack", "meaning": "test"},
            {"term": "helloworld", "family": "attack", "meaning": "test"},
        ]
        result = _prune_suffix_only_fragments(entries)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["term"], "helloworld")

    def test_empty_entries(self):
        self.assertEqual(_prune_suffix_only_fragments([]), [])


class EvidenceSourceSortKeyHelperTests(unittest.TestCase):
    """Test _evidence_source_sort_key."""

    def test_video_context_source_returns_1(self):
        self.assertEqual(_evidence_source_sort_key({"sample": "Bilibili video context: title"}), 1)

    def test_non_video_source_returns_0(self):
        self.assertEqual(_evidence_source_sort_key({"sample": "comment"}), 0)

    def test_none_source_returns_0(self):
        self.assertEqual(_evidence_source_sort_key(None), 0)


class StableJsonTests(unittest.TestCase):
    """Test _stable_json — deterministic JSON serialization."""

    def test_string(self):
        self.assertEqual(_stable_json("hello"), '"hello"')

    def test_number(self):
        self.assertEqual(_stable_json(42), "42")

    def test_list(self):
        self.assertEqual(_stable_json(["b", "a"]), '["b","a"]')

    def test_dict_sorted_keys(self):
        self.assertEqual(_stable_json({"z": 1, "a": 2}), '{"a":2,"z":1}')

    def test_nested(self):
        result = _stable_json({"b": {"d": 1, "c": 2}, "a": 3})
        self.assertEqual(result, '{"a":3,"b":{"c":2,"d":1}}')

    def test_none(self):
        self.assertEqual(_stable_json(None), "null")

    def test_boolean(self):
        self.assertEqual(_stable_json(True), "true")

    def test_mixed_list(self):
        self.assertEqual(_stable_json([3, 1, 2]), '[3,1,2]')


class WithoutUpdatedAtTests(unittest.TestCase):
    """Test _without_updated_at — stripping metadata keys."""

    def test_strips_updated_at(self):
        result = _without_updated_at({"term": "test", "updatedAt": "2024-01-01"})
        self.assertEqual(result, {"term": "test"})

    def test_strips_storage_and_entryfiles(self):
        result = _without_updated_at({"term": "test", "storage": {}, "entryFiles": []})
        self.assertEqual(result, {"term": "test"})

    def test_preserves_other_keys(self):
        input_dict = {"term": "test", "meaning": "some meaning"}
        self.assertEqual(_without_updated_at(input_dict), input_dict)

    def test_nested_lists(self):
        result = _without_updated_at([
            {"term": "a", "updatedAt": "t1"},
            {"term": "b", "updatedAt": "t2"},
        ])
        self.assertEqual(result, [{"term": "a"}, {"term": "b"}])

    def test_empty_and_none(self):
        self.assertEqual(_without_updated_at({}), {})
        self.assertIsNone(_without_updated_at(None))


class SemanticallyEqualIgnoringUpdatedAtTests(unittest.TestCase):
    """Test _semantically_equal_ignoring_updated_at."""

    def test_equal_ignoring_updated_at(self):
        left = {"term": "test", "updatedAt": "old"}
        right = {"term": "test", "updatedAt": "new"}
        self.assertTrue(_semantically_equal_ignoring_updated_at(left, right))

    def test_not_equal(self):
        left = {"term": "test", "updatedAt": "old"}
        right = {"term": "different", "updatedAt": "new"}
        self.assertFalse(_semantically_equal_ignoring_updated_at(left, right))

    def test_with_nested_lists(self):
        left = [{"term": "a", "updatedAt": "t1"}]
        right = [{"term": "a", "updatedAt": "t2"}]
        self.assertTrue(_semantically_equal_ignoring_updated_at(left, right))

    def test_storage_is_ignored(self):
        left = {"term": "test", "storage": {"key": "val"}}
        right = {"term": "test"}
        self.assertTrue(_semantically_equal_ignoring_updated_at(left, right))


class PrioritizeEvidenceSourcesForSamplesTests(unittest.TestCase):
    """Test _prioritize_evidence_sources_for_samples — source ordering."""

    def test_empty_returns_empty(self):
        self.assertEqual(_prioritize_evidence_sources_for_samples([], []), [])

    def test_non_video_sources_before_video(self):
        sources = [
            {"sample": "B", "source": "vid"},
            {"sample": "A", "source": "user"},
        ]
        result = _prioritize_evidence_sources_for_samples(sources, ["A", "B"])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["sample"], "A")

    def test_caps_at_limit(self):
        sources = [{"sample": f"s{i}"} for i in range(10)]
        samples = [f"s{i}" for i in range(10)]
        result = _prioritize_evidence_sources_for_samples(sources, samples, limit=5)
        self.assertEqual(len(result), 5)

    def test_deduplicates_identical_sources(self):
        sources = [
            {"sample": "A", "source": "s1", "uid": "u1"},
            {"sample": "A", "source": "s1", "uid": "u1"},
        ]
        result = _prioritize_evidence_sources_for_samples(sources, ["A"], limit=8)
        self.assertEqual(len(result), 1)

    def test_samples_not_in_sample_order_are_appended(self):
        sources = [
            {"sample": "A", "source": "user"},
            {"sample": "Z", "source": "orphan"},
        ]
        result = _prioritize_evidence_sources_for_samples(sources, ["A"])
        self.assertEqual(len(result), 2)


class MergeKeywordEntryTests(unittest.TestCase):
    """Test _merge_keyword_entry — entry merging logic."""

    def test_no_existing_returns_incoming_with_now(self):
        incoming = {"term": "傻逼", "family": "attack"}
        result = _merge_keyword_entry(None, incoming, now="2024-01-01T00:00:00")
        self.assertEqual(result["term"], "傻逼")
        self.assertEqual(result["updatedAt"], "2024-01-01T00:00:00")

    def test_replaces_family_when_incoming_confidence_significantly_higher(self):
        existing = {"term": "test", "family": "attack", "confidence": 0.5}
        incoming = {"term": "test", "family": "absolutes", "confidence": 0.8}
        result = _merge_keyword_entry(existing, incoming, now="t")
        self.assertEqual(result["family"], "absolutes")

    def test_keeps_existing_family_when_confidence_gap_small(self):
        existing = {"term": "test", "family": "attack", "confidence": 0.7}
        incoming = {"term": "test", "family": "absolutes", "confidence": 0.8}
        result = _merge_keyword_entry(existing, incoming, now="t")
        self.assertEqual(result["family"], "attack")

    def test_merges_evidence_samples_deduplicated(self):
        existing = {"term": "test", "evidenceSamples": ["a", "b"]}
        incoming = {"term": "test", "evidenceSamples": ["b", "c"]}
        result = _merge_keyword_entry(existing, incoming, now="t")
        self.assertEqual(len(result["evidenceSamples"]), 3)
        for s in ("a", "b", "c"):
            self.assertIn(s, result["evidenceSamples"])

    def test_confidence_takes_max(self):
        existing = {"term": "test", "confidence": 0.3}
        incoming = {"term": "test", "confidence": 0.9}
        result = _merge_keyword_entry(existing, incoming, now="t")
        self.assertEqual(result["confidence"], 0.9)

    def test_incoming_updated_at_preserved_when_no_existing(self):
        incoming = {"term": "test", "updatedAt": "custom"}
        result = _merge_keyword_entry(None, incoming, now="")
        self.assertEqual(result["updatedAt"], "custom")

    def test_term_from_incoming(self):
        existing = {"term": "old"}
        incoming = {"term": "newterm"}
        result = _merge_keyword_entry(existing, incoming, now="t")
        self.assertEqual(result["term"], "newterm")


class EvalRuleConditionTests(unittest.TestCase):
    """Test _eval_rule_condition — rule condition evaluation."""

    def test_pattern_match(self):
        cond = {"pattern": r"test", "target": "clean_sample"}
        self.assertTrue(_eval_rule_condition(cond, "this is a test", "", ""))

    def test_pattern_no_match(self):
        cond = {"pattern": r"xyz", "target": "clean_sample"}
        self.assertFalse(_eval_rule_condition(cond, "this is a test", "", ""))

    def test_pattern_case_insensitive(self):
        cond = {"pattern": r"TEST", "caseInsensitive": True, "target": "clean_sample"}
        self.assertTrue(_eval_rule_condition(cond, "this is a test", "", ""))

    def test_type_equals(self):
        cond = {"type": "equals", "value": "hello"}
        self.assertTrue(_eval_rule_condition(cond, "hello", "", ""))
        self.assertFalse(_eval_rule_condition(cond, "world", "", ""))

    def test_type_equals_raw(self):
        cond = {"type": "equals_raw", "value": "Hello World"}
        self.assertTrue(_eval_rule_condition(cond, "hello world", "", "Hello World"))

    def test_type_includes(self):
        cond = {"type": "includes", "value": "test"}
        self.assertTrue(_eval_rule_condition(cond, "this is a test", "", ""))
        self.assertFalse(_eval_rule_condition(cond, "no match", "", ""))

    def test_type_not_includes(self):
        cond = {"type": "not_includes", "value": "bad"}
        self.assertTrue(_eval_rule_condition(cond, "good content", "", ""))
        self.assertFalse(_eval_rule_condition(cond, "bad content", "", ""))

    def test_type_term_in_sample(self):
        cond = {"type": "term_in_sample", "term": "hello"}
        self.assertTrue(_eval_rule_condition(cond, "hello world", "", ""))
        self.assertFalse(_eval_rule_condition(cond, "world", "", ""))

    def test_type_term_in_raw_sample(self):
        cond = {"type": "term_in_raw_sample", "term": "Hello"}
        self.assertTrue(_eval_rule_condition(cond, "hello", "", "Hello World"))
        self.assertFalse(_eval_rule_condition(cond, "hello", "", "world"))

    def test_raw_context_sample_target(self):
        cond = {"pattern": r"raw", "target": "raw_context_sample"}
        self.assertTrue(_eval_rule_condition(cond, "clean", "", "this is raw context"))

    def test_text_outside_emotes_target(self):
        cond = {"pattern": r"outside", "target": "text_outside_emotes"}
        result = _eval_rule_condition(cond, "", "", "text [doge] outside", "text  outside")
        self.assertTrue(result)

    def test_unknown_type_returns_false(self):
        cond = {"type": "unknown"}
        self.assertFalse(_eval_rule_condition(cond, "test", "", ""))

    def test_missing_target_falls_back_to_clean_sample(self):
        cond = {"pattern": r"test"}
        self.assertTrue(_eval_rule_condition(cond, "test", "", ""))


class IsAmbiguousBenignEvidenceSampleTests(unittest.TestCase):
    """Test _is_ambiguous_benign_evidence_sample — generic attack-family rules."""

    def test_empty_term_or_sample_returns_false(self):
        self.assertFalse(_is_ambiguous_benign_evidence_sample("", "attack", ""))

    def test_short_negated_attack_mention_in_attack_family(self):
        self.assertTrue(_is_ambiguous_benign_evidence_sample("傻逼", "attack", "没有傻逼"))

    def test_short_negated_not_in_attack_family_does_not_trigger(self):
        self.assertFalse(_is_ambiguous_benign_evidence_sample("顶", "cooperation", "没有顶"))

    def test_question_list_pattern_in_attack(self):
        sample = "不懂就问，这个、那个是什么意思？"
        self.assertTrue(_is_ambiguous_benign_evidence_sample("傻逼", "attack", sample))

    def test_question_list_with_attack_keyword_not_filtered(self):
        sample = "不懂就问，这个、那个是什么攻击？"
        self.assertFalse(_is_ambiguous_benign_evidence_sample("傻逼", "attack", sample))


class NormalizeKeywordEntriesTests(unittest.TestCase):
    """Test normalize_keyword_entries — full pipeline normalization."""

    def test_empty_list_returns_empty(self):
        self.assertEqual(normalize_keyword_entries([]), [])

    def test_none_returns_empty(self):
        self.assertEqual(normalize_keyword_entries(None), [])

    def test_minimal_attack_entry(self):
        entries = [
            {
                "term": "傻逼",
                "family": "attack",
                "meaning": "用来骂人的词",
                "confidence": 0.8,
            }
        ]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["term"], "傻逼")
        self.assertEqual(result[0]["family"], "attack")
        self.assertEqual(result[0]["meaning"], "用来骂人的词")
        self.assertEqual(result[0]["confidence"], 0.8)

    def test_mojibake_term_filtered(self):
        entries = [{"term": "锻abc123", "family": "attack", "meaning": "test"}]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 0)

    def test_term_too_short_filtered(self):
        entries = [{"term": "a", "family": "attack", "meaning": "test"}]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 0)

    def test_recovered_meaning_replaced(self):
        entries = [
            {
                "term": "傻逼",
                "family": "attack",
                "meaning": "Recovered term metadata after an interrupted local dictionary write",
                "confidence": 0.8,
            }
        ]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 1)
        self.assertNotIn("Recovered term metadata", result[0]["meaning"])
        self.assertIn("傻逼", result[0]["meaning"])

    def test_placeholder_meaning_filtered(self):
        entries = [{"term": "test", "family": "attack", "meaning": "中文含义"}]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 0)

    def test_cooperation_positive_risk(self):
        entries = [
            {
                "term": "支持",
                "family": "cooperation",
                "meaning": "表示赞同和支持",
                "confidence": 0.8,
            }
        ]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["risk"], "positive")

    def test_default_medium_risk_for_attack(self):
        entries = [
            {
                "term": "傻逼",
                "family": "attack",
                "meaning": "用来骂人",
                "confidence": 0.8,
            }
        ]
        result = normalize_keyword_entries(entries)
        self.assertEqual(result[0]["risk"], "medium")

    def test_noisy_evidence_filtered(self):
        entries = [
            {
                "term": "傻逼",
                "family": "attack",
                "meaning": "用来骂人",
                "confidence": 0.8,
                "evidenceSamples": ["异议！", "正常样本"],
            }
        ]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 1)
        self.assertNotIn("异议！", result[0].get("evidenceSamples", []))

    def test_non_dict_entry_skipped(self):
        entries = ["not a dict"]
        result = normalize_keyword_entries(entries)
        self.assertEqual(len(result), 0)


class KeywordEvidenceMatcherHelperTests(unittest.TestCase):
    """Test KeywordEvidenceMatcher instance methods."""

    def setUp(self):
        self.matcher = KeywordEvidenceMatcher()

    def test_evidence_needles_for_term(self):
        needles = self.matcher.evidence_needles_for_term("傻逼")
        self.assertIn("傻逼", needles)
        self.assertIsInstance(needles, list)

    def test_evidence_needles_with_aliases(self):
        needles = self.matcher.evidence_needles_for_term("问百度")
        self.assertIn("不会百度", needles)

    def test_evidence_needles_empty_term(self):
        self.assertEqual(self.matcher.evidence_needles_for_term(""), [])

    def test_normalize_entry_cleans_term_and_family(self):
        result = self.matcher._normalize_entry({"term": "  TestTerm  ", "family": "  sarcasm  "})
        self.assertEqual(result["term"], "testterm")
        self.assertEqual(result["family"], "sarcasm")

    def test_normalize_entry_defaults_family_to_attack(self):
        result = self.matcher._normalize_entry({"term": "test"})
        self.assertEqual(result["family"], "attack")

    def test_normalize_entry_defaults_meaning_to_empty(self):
        result = self.matcher._normalize_entry({"term": "test"})
        self.assertEqual(result["meaning"], "")

    def test_count_non_overlapping_needles(self):
        count = self.matcher._count_non_overlapping_needles("test test test", ["test"])
        self.assertEqual(count, 3)

    def test_count_non_overlapping_multiple_needles(self):
        count = self.matcher._count_non_overlapping_needles("abc test abc test", ["test", "abc"])
        self.assertEqual(count, 4)

    def test_count_non_overlapping_overlapping_handled(self):
        count = self.matcher._count_non_overlapping_needles("aaaa", ["aa"])
        self.assertEqual(count, 2)

    def test_count_non_overlapping_empty(self):
        self.assertEqual(self.matcher._count_non_overlapping_needles("", ["test"]), 0)
        self.assertEqual(self.matcher._count_non_overlapping_needles("test", []), 0)

    def test_normalize_evidence_sources_dedup(self):
        sources = [
            {"source": "src1", "uid": "u1", "sample": "sample1"},
            {"source": "src1", "uid": "u1", "sample": "sample1"},
        ]
        result = self.matcher._normalize_evidence_sources(sources)
        self.assertEqual(len(result), 1)

    def test_normalize_evidence_sources_empty_sample_skipped(self):
        sources = [{"source": "src1", "uid": "u1", "sample": ""}]
        result = self.matcher._normalize_evidence_sources(sources)
        self.assertEqual(len(result), 0)

    def test_normalize_evidence_sources_empty_input(self):
        self.assertEqual(self.matcher._normalize_evidence_sources([]), [])


class KeywordEvidenceContractComparatorTests(unittest.TestCase):
    """Test KeywordEvidenceContractComparator.compare."""

    def setUp(self):
        self.comparator = KeywordEvidenceContractComparator()

    def test_compare_matching_results(self):
        result = self.comparator.compare(
            {"ok": True, "mode": "entries", "count": 5, "entries": []},
            {"ok": True, "mode": "entries", "count": 5, "entries": []},
        )
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["mismatches"]), 0)

    def test_compare_detects_mismatch(self):
        result = self.comparator.compare(
            {"ok": True, "mode": "entries", "count": 5, "entries": []},
            {"ok": True, "mode": "entries", "count": 3, "entries": []},
        )
        self.assertFalse(result["ok"])
        self.assertEqual(len(result["mismatches"]), 1)
        self.assertEqual(result["mismatches"][0]["key"], "count")

    def test_compare_only_keys_in_js_result(self):
        result = self.comparator.compare(
            {"ok": True, "mode": "entries", "count": 5, "entries": []},
            {"ok": True},
        )
        self.assertTrue(result["ok"])

    def test_compare_none_handling(self):
        result = self.comparator.compare(None, None)
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["mismatches"]), 0)


if __name__ == "__main__":
    unittest.main()
