from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local_options import LocalCorpusMinePlanCommandRequest, LocalCorpusMinePlanContractComparator, LocalCorpusMinePlanRunner


def build_parser() -> argparse.ArgumentParser:
    return LocalCorpusMinePlanCommandRequest([]).parser()


class LocalCorpusMinePlanCliRunner:
    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        return LocalCorpusMinePlanCommandRequest(self.argv).run()


def main(argv: list[str] | None = None) -> int:
    result = LocalCorpusMinePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
