from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local_options import LocalCorpusMineCommandRequest, LocalCorpusMineRunner


class LocalCorpusMineCliRunner(LocalCorpusMineCommandRequest):
    """CLI-compatible local corpus evidence mining runner."""


def build_parser() -> argparse.ArgumentParser:
    return LocalCorpusMineCommandRequest.parser()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = LocalCorpusMineCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
