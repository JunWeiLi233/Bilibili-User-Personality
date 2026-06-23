from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from python_backend.corpus.direct_probe import DirectProbeCommandRunner
from python_backend.runtime.json_contracts import JsonContractReader


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run a JSON-contract direct Bilibili evidence probe command.")
    parser.add_argument("--payload", required=True, help="Direct probe command payload JSON file.")
    return parser


class DirectProbeCommandCliRunner:
    """CLI-compatible direct-probe command runner for fixture and bridge validation."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv
        self.reader = JsonContractReader()

    def run(self) -> dict[str, object]:
        args = build_parser().parse_args(self.argv)
        payload = self.reader.read_value(Path(args.payload), {})
        return DirectProbeCommandRunner(payload if isinstance(payload, dict) else {}).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = DirectProbeCommandCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
