from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import (
    VideoCommentFilterCommandRequest,
    VideoCommentFilterPayloadContractComparator as VideoCommentFilterContractComparator,
    VideoCommentFilterPayloadRunner as VideoCommentFilterRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return VideoCommentFilterCommandRequest.parser()


class VideoCommentFilterCliRunner(VideoCommentFilterCommandRequest):
    """CLI-compatible comment filter runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = VideoCommentFilterCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
