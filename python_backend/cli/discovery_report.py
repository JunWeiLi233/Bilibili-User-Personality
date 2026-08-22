from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.discovery_report import VideoKeywordDiscoveryReportCommandRequest, VideoKeywordDiscoveryReportPayloadContractComparator as VideoKeywordDiscoveryReportContractComparator, VideoKeywordDiscoveryReportRunner


def build_parser() -> argparse.ArgumentParser:
    return VideoKeywordDiscoveryReportCommandRequest.parser()


class VideoKeywordDiscoveryReportCliRunner(VideoKeywordDiscoveryReportCommandRequest):
    """CLI-compatible discovery report runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = VideoKeywordDiscoveryReportCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
