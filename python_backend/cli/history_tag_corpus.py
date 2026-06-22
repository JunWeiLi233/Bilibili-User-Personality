from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.history_tags import (
    HistoryTagCorpusCommandRequest,
    HistoryTagCorpusPayloadContractComparator as HistoryTagCorpusContractComparator,
    HistoryTagCorpusRunner,
    HistoryTagCorpusShardWritePayloadContractComparator as HistoryTagCorpusShardWriteContractComparator,
    HistoryTagCorpusShardWriteRunner,
    HistoryTagScrapePlanPayloadContractComparator as HistoryTagScrapePlanContractComparator,
    HistoryTagScrapePlanRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return HistoryTagCorpusCommandRequest.parser()


class HistoryTagCorpusCliRunner(HistoryTagCorpusCommandRequest):
    """CLI-compatible history-tag corpus runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = HistoryTagCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
