from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import (
    VideoRelevanceCommandRequest,
    VideoRelevancePayloadContractComparator as VideoRelevanceContractComparator,
    VideoRelevancePayloadRunner as VideoRelevanceRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return VideoRelevanceCommandRequest.parser()


class VideoRelevanceCliRunner(VideoRelevanceCommandRequest):
    """CLI-compatible video relevance runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = VideoRelevanceCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
