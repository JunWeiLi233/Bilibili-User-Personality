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
    build_target_video_object_evidence_text,
    build_video_context_text,
    comment_matches_needle_set,
    filter_comments_by_dictionary_needles,
    relevance_score_for_video,
    search_needles_for_relevance,
    sort_videos_by_relevance,
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


if __name__ == "__main__":
    unittest.main()
