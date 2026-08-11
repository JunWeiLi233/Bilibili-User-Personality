"""Unit tests for python_backend.corpus.local_options.

Covers:
  - parse_corpus_paths: multi-delimiter path splitting (direct, previously
    only exercised indirectly via build_options).
  - LocalCorpusMineOptionsPlanner.build_options: argv + env option resolution,
    INCLUDING the clamp floor for explicit 0 (the JS/Python parity contract
    with mineLocalCorpusEvidence.js parseArgs — AGENTS.md §6). The clamp bug
    where ``--target-evidence=0`` collapsed to the default 3 (because
    ``_js_number_or_default`` treated 0.0 as falsy) is now fixed and pinned
    here so it cannot regress.
"""

from __future__ import annotations

import unittest

from python_backend.corpus.local_options import (
    LocalCorpusMineOptionsPlanner,
    _bounded,
    _js_number_or_default,
    parse_corpus_paths,
)


class TestParseCorpusPaths(unittest.TestCase):
    def test_splits_on_commas_semicolons_pipes_newlines(self):
        self.assertEqual(
            parse_corpus_paths("a.json,b.json;c.json|d.json\ne.json"),
            ["a.json", "b.json", "c.json", "d.json", "e.json"],
        )

    def test_trims_whitespace(self):
        self.assertEqual(parse_corpus_paths("  a.json  ,  b.json "), ["a.json", "b.json"])

    def test_drops_empty_items(self):
        self.assertEqual(parse_corpus_paths("a.json,,b.json,"), ["a.json", "b.json"])

    def test_returns_empty_for_null_empty_input(self):
        self.assertEqual(parse_corpus_paths(""), [])
        self.assertEqual(parse_corpus_paths(None), [])

    def test_coerces_non_string_input_to_string(self):
        self.assertEqual(parse_corpus_paths(123), ["123"])


class TestJsNumberOrDefault(unittest.TestCase):
    def test_returns_the_integer_value_for_valid_numbers(self):
        self.assertEqual(_js_number_or_default(5, 3), 5)
        self.assertEqual(_js_number_or_default("7", 3), 7)
        self.assertEqual(_js_number_or_default(2.9, 3), 2)  # int-truncated

    def test_returns_zero_for_explicit_zero_not_fallback(self):
        # Regression: previously `if number` treated 0.0 as falsy → fallback.
        self.assertEqual(_js_number_or_default(0, 3), 0)
        self.assertEqual(_js_number_or_default(0.0, 3), 0)
        self.assertEqual(_js_number_or_default("0", 3), 0)

    def test_returns_fallback_for_non_numeric_strings(self):
        self.assertEqual(_js_number_or_default("abc", 3), 3)
        self.assertEqual(_js_number_or_default("", 3), 3)

    def test_returns_fallback_for_none(self):
        self.assertEqual(_js_number_or_default(None, 3), 3)

    def test_returns_fallback_for_nan_and_inf(self):
        import math
        self.assertEqual(_js_number_or_default(float("nan"), 3), 3)
        self.assertEqual(_js_number_or_default(float("inf"), 3), 3)


class TestBounded(unittest.TestCase):
    def test_clamps_to_minimum_floor(self):
        # The key regression: 0 → clamped to floor 1 (not collapsed to fallback 3)
        self.assertEqual(_bounded(0, 3, 1, 20), 1)
        self.assertEqual(_bounded(-5, 3, 1, 20), 1)

    def test_clamps_to_maximum_ceiling(self):
        self.assertEqual(_bounded(999, 3, 1, 20), 20)

    def test_passes_through_in_range_values(self):
        self.assertEqual(_bounded(5, 3, 1, 20), 5)
        self.assertEqual(_bounded(10, 3, 1, 20), 10)

    def test_fallback_for_non_numeric_ignores_floor(self):
        # Non-numeric → fallback 3, which is in-range → returned as-is
        self.assertEqual(_bounded("abc", 3, 1, 20), 3)


class TestLocalCorpusMineOptionsPlanner(unittest.TestCase):
    def setUp(self):
        self.planner = LocalCorpusMineOptionsPlanner()

    def test_default_options(self):
        opts = self.planner.build_options(argv=[], env={})
        self.assertEqual(opts["targetEvidence"], 3)
        self.assertEqual(opts["maxSamplesPerTerm"], 3)
        self.assertTrue(opts["requireCommentBackedEvidence"])
        self.assertFalse(opts["write"])

    def test_target_evidence_zero_clamps_to_one_not_fallback(self):
        # Regression pin: matches JS mineLocalCorpusEvidence.js parseArgs after fix.
        opts = self.planner.build_options(argv=["--target-evidence=0"], env={})
        self.assertEqual(opts["targetEvidence"], 1)

    def test_target_evidence_above_ceiling_clamps_to_twenty(self):
        opts = self.planner.build_options(argv=["--target-evidence=999"], env={})
        self.assertEqual(opts["targetEvidence"], 20)

    def test_max_samples_zero_clamps_to_one(self):
        opts = self.planner.build_options(argv=["--max-samples-per-term=0"], env={})
        self.assertEqual(opts["maxSamplesPerTerm"], 1)

    def test_non_numeric_target_evidence_uses_fallback(self):
        opts = self.planner.build_options(argv=["--target-evidence=abc"], env={})
        self.assertEqual(opts["targetEvidence"], 3)

    def test_corpus_paths_from_env(self):
        opts = self.planner.build_options(argv=[], env={"LOCAL_BILIBILI_CORPUS_PATH": "x.json,y.json"})
        self.assertEqual(opts["corpusPaths"], ["x.json", "y.json"])

    def test_corpus_flag_overrides_env(self):
        opts = self.planner.build_options(
            argv=["--corpus=z.json"],
            env={"LOCAL_BILIBILI_CORPUS_PATH": "x.json"},
        )
        self.assertEqual(opts["corpusPaths"], ["z.json"])

    def test_write_flag(self):
        self.assertTrue(self.planner.build_options(argv=["--write"], env={})["write"])
        self.assertTrue(self.planner.build_options(argv=[], env={"LOCAL_CORPUS_WRITE": "1"})["write"])
        self.assertFalse(self.planner.build_options(argv=[], env={"LOCAL_CORPUS_WRITE": "0"})["write"])

    def test_no_comment_backed_flag(self):
        self.assertFalse(
            self.planner.build_options(argv=["--no-comment-backed"], env={})["requireCommentBackedEvidence"]
        )

    def test_build_plan_wraps_options(self):
        plan = self.planner.build_plan(argv=[], env={})
        self.assertTrue(plan["ok"])
        self.assertIn("options", plan)
        self.assertEqual(plan["options"]["targetEvidence"], 3)


if __name__ == "__main__":
    unittest.main()
