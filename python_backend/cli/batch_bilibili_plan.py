from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_bilibili import BatchBilibiliPlanCommandRequest, BatchBilibiliPlanPayloadContractComparator as BatchBilibiliPlanContractComparator, BatchBilibiliPlanRunner


def build_parser() -> argparse.ArgumentParser:
    return BatchBilibiliPlanCommandRequest.parser()


class BatchBilibiliPlanCliRunner(BatchBilibiliPlanCommandRequest):
    """CLI-compatible batch Bilibili plan runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = BatchBilibiliPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
