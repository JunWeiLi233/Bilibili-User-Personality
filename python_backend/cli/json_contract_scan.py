from __future__ import annotations

import argparse
import json
import sys

from python_backend.runtime.json_contract_scan import JsonContractScanCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return JsonContractScanCommandRequest.parser()


class JsonContractScanCliRunner(JsonContractScanCommandRequest):
    """CLI-compatible JSON contract scanner runner."""


def main(argv: list[str] | None = None) -> int:
    result = JsonContractScanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
