from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_discovery import UidDiscoveryPlanCommandRequest, UidDiscoveryPlanPayloadContractComparator as UidDiscoveryPlanContractComparator, UidDiscoveryPlanRunner


def build_parser() -> argparse.ArgumentParser:
    return UidDiscoveryPlanCommandRequest.parser()


class UidDiscoveryPlanCliRunner(UidDiscoveryPlanCommandRequest):
    """CLI-compatible UID discovery planner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = UidDiscoveryPlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
