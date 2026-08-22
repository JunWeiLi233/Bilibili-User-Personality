from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.video_link_direct import VideoLinkDirectPlanCommandRequest, VideoLinkDirectPlanContractComparator, VideoLinkDirectPlanRunner


def build_parser() -> argparse.ArgumentParser:
    return VideoLinkDirectPlanCommandRequest.parser()


class VideoLinkDirectPlanCliRunner(VideoLinkDirectPlanCommandRequest):
    """CLI-compatible direct-link plan runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = VideoLinkDirectPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
