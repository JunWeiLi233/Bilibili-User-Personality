from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.dictionary_prune import DictionaryPruneSummaryCommandRequest, DictionaryPruneSummaryPayloadContractComparator as DictionaryPruneSummaryContractComparator, DictionaryPruneSummaryRunner


def build_parser() -> argparse.ArgumentParser:
    return DictionaryPruneSummaryCommandRequest([]).parser()


class DictionaryPruneSummaryCliRunner(DictionaryPruneSummaryCommandRequest):
    """Compatibility wrapper for the corpus-owned dictionary prune summary command."""


def main(argv: list[str] | None = None) -> int:
    result = DictionaryPruneSummaryCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
