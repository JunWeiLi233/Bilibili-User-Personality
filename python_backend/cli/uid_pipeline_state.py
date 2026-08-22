from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.uid_pipeline import UidPipelineStateCommandRequest, UidPipelineStatePayloadContractComparator as UidPipelineStateContractComparator, UidPipelineStateRunner


def build_parser() -> argparse.ArgumentParser:
    return UidPipelineStateCommandRequest.parser()


class UidPipelineStateCliRunner(UidPipelineStateCommandRequest):
    """CLI-compatible UID pipeline state runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = UidPipelineStateCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
