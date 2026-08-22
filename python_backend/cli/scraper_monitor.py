from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.scraper_monitor import ScraperMonitorCommandRequest

def build_parser() -> argparse.ArgumentParser:
    return ScraperMonitorCommandRequest.parser()


class ScraperMonitorCliRunner(ScraperMonitorCommandRequest):
    """CLI-compatible scraper monitor runner for JS/Python JSON progress contracts."""


def main(argv: list[str] | None = None) -> int:
    result = ScraperMonitorCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
