from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.bilibili_probe import BilibiliProbePlanCommandRequest, BilibiliProbePlanPayloadContractComparator as BilibiliProbePlanContractComparator, BilibiliProbePlanRunner


def build_parser() -> argparse.ArgumentParser:
    return BilibiliProbePlanCommandRequest.parser()


class BilibiliProbePlanCliRunner(BilibiliProbePlanCommandRequest):
    """CLI-compatible Bilibili probe planner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = BilibiliProbePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
