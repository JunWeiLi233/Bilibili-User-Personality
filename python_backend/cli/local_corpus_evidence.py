from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.local import LocalCorpusEvidenceCommandRequest, LocalCorpusEvidenceJsonPayloadContractComparator, LocalCorpusEvidenceJsonPayloadRunner, LocalCorpusEvidencePayloadContractComparator as LocalCorpusEvidenceContractComparator, LocalCorpusEvidenceRunner


class LocalCorpusEvidenceCliRunner(LocalCorpusEvidenceCommandRequest):
    """CLI-compatible local corpus evidence runner for JSON contract checks."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    return LocalCorpusEvidenceCommandRequest(argv).parse_args()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = LocalCorpusEvidenceCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
