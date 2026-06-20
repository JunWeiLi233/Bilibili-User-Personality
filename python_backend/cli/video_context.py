from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.video_filter import VideoContextBuilder, VideoContextSummary


class VideoContextRunner:
    """Build video context/evidence text and diagnostics from a JSON contract."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.builder = VideoContextBuilder()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        videos = self._list_value(payload.get("videos"))
        discovered_videos = self._list_value(payload.get("discoveredVideos"))
        discovery_context_videos = self._list_value(payload.get("discoveryContextVideos"))
        comments = self._list_value(payload.get("comments"))
        search_queries = self._list_value(payload.get("searchQueries") or payload.get("searchQuery"))
        target_existing_terms = self._list_value(
            payload.get("targetExistingTerms") or payload.get("targetExistingTerm") or payload.get("targetTerms") or payload.get("targetTerm")
        )
        training_text = payload.get("trainingText") or ""
        keyword_training = payload.get("keywordTraining") if isinstance(payload.get("keywordTraining"), dict) else None
        context_videos = self.builder.video_context_sources(videos, discovery_context_videos if discovery_context_videos else discovered_videos)
        return {
            "ok": True,
            "videoContextText": self.builder.build_video_context_text(context_videos),
            "videoObjectEvidenceText": self.builder.build_target_video_object_evidence_text(context_videos, search_queries, target_existing_terms),
            "contextSourceUrls": self.builder.video_context_source_urls(context_videos),
            "diagnostics": self.builder.build_collection_diagnostics(
                discovered_videos=discovered_videos,
                discovery_context_videos=discovery_context_videos,
                videos=videos,
                comments=comments,
                training_text=training_text,
                target_existing_terms=target_existing_terms,
                keyword_training=keyword_training,
            ),
        }

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    def _list_value(self, value: Any) -> list[Any]:
        if isinstance(value, list):
            return value
        if value is None:
            return []
        return [value]


class VideoContextContractComparator:
    """Compare Python video context output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoContextSummary()

    def compare(self) -> dict[str, Any]:
        python_result = VideoContextRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = self._top_level_mismatches(python_result, js_result)
        mismatches.extend(self._diagnostic_mismatches(python_result, js_result))
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _top_level_mismatches(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> list[dict[str, Any]]:
        return [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]

    def _diagnostic_mismatches(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> list[dict[str, Any]]:
        python_diagnostics = python_result.get("diagnostics") if isinstance(python_result.get("diagnostics"), dict) else {}
        js_diagnostics = js_result.get("diagnostics") if isinstance(js_result.get("diagnostics"), dict) else {}
        return [
            {"key": f"diagnostics.{key}", "python": python_diagnostics.get(key), "js": js_value}
            for key, js_value in js_diagnostics.items()
            if python_diagnostics.get(key) != js_value
        ]

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Build Bilibili video context/evidence diagnostics from JSON.")
    parser.add_argument("--payload", required=True, help="JSON payload with videos, comments, search queries, and target terms.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible video context report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = VideoContextContractComparator(args.payload, args.compare_js_report).compare()
    else:
        result = VideoContextRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
