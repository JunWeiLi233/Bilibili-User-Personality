from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analysis.video_filter import VideoRelevanceFilter


class VideoRelevanceRunner:
    """Run JS-compatible video relevance ranking/filtering from a JSON contract."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.relevance = VideoRelevanceFilter()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        videos = payload.get("videos") if isinstance(payload.get("videos"), list) else []
        search_queries = self._list_value(payload.get("searchQueries") or payload.get("searchQuery"))
        target_existing_terms = self._list_value(
            payload.get("targetExistingTerms") or payload.get("targetExistingTerm") or payload.get("targetTerms") or payload.get("targetTerm")
        )
        operation = str(payload.get("operation") or "sort").strip().lower()
        needles = self.relevance.search_needles_for_relevance(search_queries, target_existing_terms)
        if operation == "filter":
            result_videos = self.relevance.filter_relevant_videos(videos, search_queries, target_existing_terms)
        elif operation == "score":
            scores = [
                {"video": video, "score": self.relevance.relevance_score_for_video(video if isinstance(video, dict) else {}, needles)}
                for video in videos
            ]
            return {"ok": True, "operation": operation, "needles": needles, "scores": scores}
        else:
            operation = "sort"
            result_videos = self.relevance.sort_videos_by_relevance(videos, search_queries, target_existing_terms)
        return {"ok": True, "operation": operation, "needles": needles, "videos": result_videos}

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


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Rank or filter Bilibili video objects by JS-compatible relevance rules.")
    parser.add_argument("--payload", required=True, help="JSON object with videos, searchQueries, targetExistingTerms, and operation.")
    args = parser.parse_args()
    result = VideoRelevanceRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
