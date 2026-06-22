from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.bilibili_crawler import BilibiliCrawlerCommandRequest, BilibiliCrawlerPayloadContractComparator as BilibiliCrawlerContractComparator, BilibiliCrawlerRunner


def build_parser() -> argparse.ArgumentParser:
    return BilibiliCrawlerCommandRequest.parser()


class BilibiliCrawlerCliRunner(BilibiliCrawlerCommandRequest):
    """CLI-compatible Bilibili crawler helper runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = BilibiliCrawlerCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
