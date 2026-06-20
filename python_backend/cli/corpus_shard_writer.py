from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.writer import CorpusShardWritePayloadContractComparator as CorpusShardWriteContractComparator, CorpusShardWriteRequest, CorpusShardWriteRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Write a split corpus from a JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to corpus write payload JSON.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible write report to compare.")
    return parser


class CorpusShardWriteCliRunner:
    """CLI-compatible corpus shard writer runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return CorpusShardWriteRequest(
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = CorpusShardWriteCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
