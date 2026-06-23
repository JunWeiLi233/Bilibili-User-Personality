from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.direct_probe import DirectProbeCommandArgvRequest


def build_parser() -> argparse.ArgumentParser:
    return DirectProbeCommandArgvRequest.parser()


class DirectProbeCommandCliRunner:
    """CLI-compatible direct-probe command runner for fixture and bridge validation."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict[str, object]:
        return DirectProbeCommandArgvRequest(self.argv).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = DirectProbeCommandCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
