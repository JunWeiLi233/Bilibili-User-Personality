from __future__ import annotations

import argparse
import json
import sys

from python_backend.analysis.comment_coverage import CommentCoverageCommandRequest, CommentCoveragePayloadContractComparator as CommentCoverageContractComparator, CommentCoverageRunner


def build_parser() -> argparse.ArgumentParser:
    return CommentCoverageCommandRequest.parser()


class CommentCoverageCliRunner:
    """CLI-compatible comment coverage runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        return CommentCoverageCommandRequest(self.argv).run()


def main(argv: list[str] | None = None) -> int:
    result = CommentCoverageCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
