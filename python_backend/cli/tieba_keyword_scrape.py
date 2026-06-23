from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.tieba_keyword import TiebaKeywordScrapeFixtureRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible Tieba keyword scrape result from fixture HTML.")
    parser.add_argument("--payload", required=True)
    return parser


class TiebaKeywordScrapeCliRunner:
    """CLI-compatible runner for file-backed Tieba keyword scrape fixtures."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args(self.argv)
        return TiebaKeywordScrapeFixtureRunner(args.payload).run()


def main(argv: list[str] | None = None) -> int:
    result = TiebaKeywordScrapeCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
