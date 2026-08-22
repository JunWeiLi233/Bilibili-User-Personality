"""JS/Python comparison test: video comment filter functions.

Runs the JS implementations via subprocess and asserts Python output matches exactly.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from python_backend.analysis.video_comment_filter import (
    build_collection_diagnostics,
    build_target_video_object_evidence_text,
    build_video_context_text,
    comment_matches_needle_set,
    dictionary_entry_needles,
    dictionary_needle_set,
    discovery_queries_for_search,
    env_flag,
    filter_comments_by_dictionary_needles,
    filter_relevant_videos,
    is_blocked_discovery_warning,
    parse_set,
    relevance_score_for_video,
    resolve_search_video_keywords_config,
    round_robin_unique,
    search_needles_for_relevance,
    sort_videos_by_relevance,
    target_evidence_count,
    target_text_hits_for_diagnostics,
    video_context_source_urls,
    video_context_sources,
)

JS_MODULE = Path(__file__).resolve().parent.parent.parent / "server" / "services" / "videoKeywordSearch.js"


def _run_js(function_name: str, args_json: str) -> dict:
    """Run a JS function from videoKeywordSearch.js with JSON args and return parsed output."""
    script = f"""
import {{{function_name}}} from '{JS_MODULE.as_uri()}';
const args = JSON.parse(process.argv[2]);
const result = {function_name}(...args);
console.log(JSON.stringify({{ok: true, result}}));
"""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".mjs", delete=False, encoding="utf-8") as f:
        f.write(script)
        temp_path = f.name

    try:
        proc = subprocess.run(
            ["node", "--no-warnings", temp_path, args_json],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=15,
            cwd=str(Path(__file__).resolve().parent.parent.parent),
        )
        if proc.returncode != 0:
            return {"ok": False, "error": proc.stderr.strip(), "stdout": proc.stdout.strip()}
        try:
            return json.loads(proc.stdout.strip().split("\n")[-1])
        except json.JSONDecodeError:
            return {"ok": False, "error": f"invalid JSON: {proc.stdout.strip()}", "stderr": proc.stderr.strip()}
    finally:
        Path(temp_path).unlink(missing_ok=True)


def _js_result(function_name: str, *args):
    """Run JS function and return the result value, or raise on error."""
    result = _run_js(function_name, json.dumps(list(args)))
    if not result.get("ok"):
        raise RuntimeError(f"JS {function_name} failed: {result}")
    return result["result"]


class VideoFilterComparisonTests(unittest.TestCase):
    """Assert Python output matches JS output for each exported function."""

    def test_comment_matches_needle_set_matches_js(self):
        needles = ["网盘见", "中国宝宝体质"]
        cases = [
            ("哈哈哈 网盘见！", needles, True),
            ("完全无关的评论", needles, False),
            ("", needles, False),
            ("网盘见", [], False),
        ]
        for message, needle_list, _expected in cases:
            with self.subTest(message=message, needles=needle_list):
                py = comment_matches_needle_set(message, set(needle_list))
                js = _js_result("commentMatchesNeedleSet", message, list(needle_list))
                self.assertEqual(py, js)

    def test_filter_comments_by_dictionary_needles_matches_js(self):
        comments = [
            {"rpid": "1", "message": "网盘见，懂的都懂"},
            {"rpid": "2", "message": "路过随便看看"},
            {"rpid": "3", "message": "这不就是典型的中国宝宝体质"},
        ]
        py = filter_comments_by_dictionary_needles(comments, {"网盘见"}, ["中国宝宝体质"])
        js = _js_result("filterCommentsByDictionaryNeedles", comments, ["网盘见"], ["中国宝宝体质"])
        self.assertEqual(py["applied"], js["applied"])
        self.assertEqual(py["matched"], js["matched"])
        self.assertEqual([c["rpid"] for c in py["comments"]], [c["rpid"] for c in js["comments"]])

    def test_relevance_score_for_video_matches_js(self):
        video = {"title": "Test Title", "desc": "Description text"}
        py = relevance_score_for_video(video, ["test", "title", "nomatch"])
        js = _js_result("relevanceScoreForVideo", video, ["test", "title", "nomatch"])
        self.assertEqual(py, js)

    def test_build_video_context_text_matches_js(self):
        videos = [
            {"title": "Video One", "desc": "Description one"},
            {"title": "Video Two"},
        ]
        py = build_video_context_text(videos)
        js = _js_result("buildVideoContextText", videos)
        self.assertEqual(py, js)

    def test_target_text_hits_for_diagnostics_matches_js(self):
        py = target_text_hits_for_diagnostics(
            "网盘见网盘见测试内容中国宝宝体质", ["网盘见", "中国宝宝体质", "不存在的"]
        )
        js = _js_result("targetTextHitsForDiagnostics", "网盘见网盘见测试内容中国宝宝体质", ["网盘见", "中国宝宝体质", "不存在的"])
        self.assertEqual(len(py), len(js))
        for p, j in zip(py, js):
            self.assertEqual(p["term"], j["term"])
            self.assertEqual(p["count"], j["count"])

    def test_video_context_sources_matches_js(self):
        v1 = {"bvid": "BV1", "sourceUrl": "url1", "title": "T1"}
        v2 = {"bvid": "BV2", "sourceUrl": "url2", "title": "T2"}
        py = video_context_sources([v1], [v1, v2])
        js = _js_result("videoContextSources", [v1], [v1, v2])
        self.assertEqual(len(py), len(js))

    def test_video_context_source_urls_matches_js(self):
        v1 = {"bvid": "BV1", "sourceUrl": "url1"}
        v2 = {"bvid": "BV2", "sourceUrl": "url2"}
        py = video_context_source_urls([v1], [v2])
        js = _js_result("videoContextSourceUrls", [v1], [v2])
        self.assertEqual(py, js)

    def test_search_needles_for_relevance_matches_js(self):
        py = search_needles_for_relevance(["hello world"], ["hello"])
        js = _js_result("searchNeedlesForRelevance", ["hello world"], ["hello"])
        self.assertEqual(len(py), len(js))
        self.assertIn("hello", py)

    def test_sort_videos_by_relevance_matches_js(self):
        v1 = {"title": "Hello World", "desc": ""}
        v2 = {"title": "Nothing", "desc": ""}
        py = sort_videos_by_relevance([v1, v2], ["hello"], ["hello"])
        js = _js_result("sortVideosByRelevance", [v1, v2], ["hello"], ["hello"])
        self.assertEqual(len(py), len(js))
        self.assertEqual(py[0]["title"], js[0]["title"])

    def test_build_target_video_object_evidence_text_matches_js(self):
        v1 = {"title": "Hello World", "desc": ""}
        py = build_target_video_object_evidence_text([v1], ["hello"], ["hello"])
        js = _js_result("buildTargetVideoObjectEvidenceText", [v1], ["hello"], ["hello"])
        self.assertEqual(py, js)

    def test_build_collection_diagnostics_matches_js(self):
        py = build_collection_diagnostics(
            discovered_videos=[{"bvid": "BV1"}],
            videos=[{"bvid": "BV2"}],
            comments=[{"rpid": "1"}],
            training_text="test content",
            target_existing_terms=["test"],
            keyword_training={"entries": [{"term": "accepted"}], "evidenceRejected": 2},
        )
        js = _js_result("buildCollectionDiagnostics", {
            "discoveredVideos": [{"bvid": "BV1"}],
            "videos": [{"bvid": "BV2"}],
            "comments": [{"rpid": "1"}],
            "trainingText": "test content",
            "targetExistingTerms": ["test"],
            "keywordTraining": {"entries": [{"term": "accepted"}], "evidenceRejected": 2},
        })
        self.assertEqual(py["discoveredVideos"], js["discoveredVideos"])
        self.assertEqual(py["scannedVideos"], js["scannedVideos"])
        self.assertEqual(py["commentsCollected"], js["commentsCollected"])
        self.assertEqual(py["evidenceRejected"], js["evidenceRejected"])

    def test_filter_relevant_videos_matches_js(self):
        v1 = {"title": "hello world", "desc": ""}
        v2 = {"title": "nothing", "desc": ""}
        py = filter_relevant_videos([v1, v2], ["hello"], ["hello"])
        js = _js_result("filterRelevantVideos", [v1, v2], ["hello"], ["hello"])
        self.assertEqual(len(py), len(js))
        if py:
            self.assertEqual(py[0]["title"], js[0]["title"])


    # — Tests for newly ported helper functions —

    def test_parse_set_parses_comma_list(self):
        result = parse_set("a, b, c")
        self.assertEqual(result, {"a", "b", "c"})

    def test_parse_set_parses_array(self):
        result = parse_set(["x", "y"])
        self.assertEqual(result, {"x", "y"})

    def test_parse_set_empty(self):
        self.assertEqual(parse_set(""), set())
        self.assertEqual(parse_set([]), set())

    def test_env_flag_true_values(self):
        for v in ["1", "true", "yes", "on", "TRUE", "YES"]:
            with self.subTest(value=v):
                self.assertTrue(env_flag(v))

    def test_env_flag_false_values(self):
        for v in [None, "", "0", "false", "no", "off"]:
            with self.subTest(value=v):
                self.assertFalse(env_flag(v))

    def test_env_flag_fallback(self):
        self.assertTrue(env_flag(None, fallback=True))
        self.assertFalse(env_flag("", fallback=False))

    def test_round_robin_unique_interleaves_groups(self):
        g1 = [{"bvid": "BV1"}, {"bvid": "BV2"}]
        g2 = [{"bvid": "BV3"}]
        result = round_robin_unique([g1, g2], 10, key_fn=lambda v: v["bvid"])
        self.assertEqual([v["bvid"] for v in result], ["BV1", "BV3", "BV2"])

    def test_round_robin_unique_respects_limit(self):
        g1 = [{"bvid": "BV1"}, {"bvid": "BV2"}]
        g2 = [{"bvid": "BV3"}, {"bvid": "BV4"}]
        result = round_robin_unique([g1, g2], 2, key_fn=lambda v: v["bvid"])
        self.assertEqual(len(result), 2)
        self.assertEqual([v["bvid"] for v in result], ["BV1", "BV3"])

    def test_round_robin_unique_deduplicates(self):
        g1 = [{"bvid": "BV1"}]
        g2 = [{"bvid": "BV1"}, {"bvid": "BV2"}]
        result = round_robin_unique([g1, g2], 10, key_fn=lambda v: v["bvid"])
        self.assertEqual([v["bvid"] for v in result], ["BV1", "BV2"])

    def test_is_blocked_discovery_warning_matches_http_blocks(self):
        self.assertTrue(is_blocked_discovery_warning("HTTP 403 Forbidden"))
        self.assertTrue(is_blocked_discovery_warning("got HTTP 412"))
        self.assertTrue(is_blocked_discovery_warning("HTTP 429 Too Many Requests"))

    def test_is_blocked_discovery_warning_no_match(self):
        self.assertFalse(is_blocked_discovery_warning("timeout"))
        self.assertFalse(is_blocked_discovery_warning("HTTP 200 OK"))
        self.assertFalse(is_blocked_discovery_warning(""))

    def test_discovery_queries_for_search_strips_generic_tokens(self):
        result = discovery_queries_for_search(
            ["时政 热评 评论区", "国际政治 热评 评论区"],
            ["问百度"],
        )
        self.assertTrue(len(result) > 0)
        for query in result:
            self.assertNotIn("评论区", query.split())

    def test_discovery_queries_for_search_empty_targets(self):
        queries = ["hello world", "test query"]
        result = discovery_queries_for_search(queries, [])
        self.assertEqual(result, queries)

    def test_dictionary_entry_needles_extracts_term_aliases_examples(self):
        entry = {"term": "测试词", "aliases": ["别名1"], "examples": ["例子1"]}
        result = dictionary_entry_needles(entry)
        self.assertIn("测试词", result)
        self.assertIn("别名1", result)
        self.assertIn("例子1", result)

    def test_dictionary_entry_needles_none(self):
        self.assertEqual(dictionary_entry_needles(None), [])

    def test_dictionary_needle_set_builds_from_dictionary(self):
        d = {"entries": [{"term": "hello"}, {"term": "world", "aliases": ["earth"]}]}
        result = dictionary_needle_set(d)
        self.assertIn("hello", result)
        self.assertIn("world", result)
        self.assertIn("earth", result)

    def test_dictionary_needle_set_empty(self):
        self.assertEqual(dictionary_needle_set(None), set())
        self.assertEqual(dictionary_needle_set({}), set())

    def test_target_evidence_count_from_fields(self):
        self.assertEqual(target_evidence_count({"evidenceCount": 5}), 5)
        self.assertEqual(target_evidence_count({"coverageEvidenceCount": 3}), 3)
        self.assertEqual(target_evidence_count({"evidence": ["a", "b", "c"]}), 3)
        self.assertEqual(target_evidence_count(None), 0)

    def test_resolve_search_video_keywords_config_defaults(self):
        config = resolve_search_video_keywords_config({}, {}, {})
        self.assertIn("videoLinks", config)
        self.assertIn("discoveryMode", config)
        self.assertEqual(config["discoveryMode"], "controversial")
        self.assertIn("discoveryLimit", config)
        self.assertGreaterEqual(config["discoveryLimit"], 1)

    def test_resolve_search_video_keywords_config_explicit_video_links(self):
        config = resolve_search_video_keywords_config(
            {"videoLinks": ["BV123", "BV456"]}, {}, {}
        )
        self.assertEqual(config["videoLinks"], ["BV123", "BV456"])

    def test_resolve_search_video_keywords_config_search_mode(self):
        config = resolve_search_video_keywords_config(
            {"discoveryMode": "search"}, {}, {}
        )
        self.assertEqual(config["discoveryMode"], "search")

    def test_resolve_search_video_keywords_config_existing_terms(self):
        config = resolve_search_video_keywords_config(
            {"existingTermsOnly": True, "targetExistingTerms": ["test"]}, {}, {}
        )
        self.assertTrue(config["existingTermsOnly"])
        self.assertEqual(config["targetExistingTerms"], ["test"])

    def test_resolve_search_video_keywords_config_deps_override(self):
        config = resolve_search_video_keywords_config(
            {},
            {"defaultSearchQueries": ["deps query"], "existingTermsOnly": True},
            {},
        )
        self.assertEqual(config["searchQueries"], ["deps query"])
        self.assertTrue(config["existingTermsOnly"])

    def test_resolve_search_video_keywords_config_env_override(self):
        config = resolve_search_video_keywords_config(
            {}, {},
            {"BILIBILI_VIDEO_DISCOVERY_MODE": "popular", "BILIBILI_HARVEST_EXISTING_TERMS_ONLY": "1"},
        )
        self.assertEqual(config["discoveryMode"], "popular")
        self.assertTrue(config["existingTermsOnly"])

    def test_resolve_search_video_keywords_config_exclude_bvids(self):
        config = resolve_search_video_keywords_config(
            {"excludeBvids": ["BV1", "BV2"]}, {}, {}
        )
        self.assertEqual(config["excludeBvids"], {"BV1", "BV2"})

if __name__ == "__main__":
    unittest.main()
