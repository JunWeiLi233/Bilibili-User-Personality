from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.video_filter import VideoContextCommandRequest, VideoContextContractComparator, VideoContextRunner


def build_parser() -> argparse.ArgumentParser:
    return VideoContextCommandRequest.parser()


class VideoContextCliRunner(VideoContextCommandRequest):
    """CLI-compatible video context runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = VideoContextCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
