from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local_options import LocalCorpusMinePlanCommandRequest, LocalCorpusMinePlanContractComparator, LocalCorpusMinePlanRunner


def build_parser() -> argparse.ArgumentParser:
    return LocalCorpusMinePlanCommandRequest([]).parser()


class LocalCorpusMinePlanCliRunner(LocalCorpusMinePlanCommandRequest):
    """CLI-compatible local corpus mining plan runner for JSON contract checks."""


def main(argv: list[str] | None = None) -> int:
    result = LocalCorpusMinePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
