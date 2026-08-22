from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.batch_uid_scrape import (
    BatchScraperLauncherCommandRequest,
    BatchScraperLauncherPayloadContractComparator as BatchScraperLauncherContractComparator,
    BatchScraperLauncherPlanRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return BatchScraperLauncherCommandRequest.parser()


class BatchScraperLauncherCliRunner(BatchScraperLauncherCommandRequest):
    """CLI-compatible batch scraper launcher runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = BatchScraperLauncherCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
