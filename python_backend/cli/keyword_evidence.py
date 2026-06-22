from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.keyword_evidence import (
    KeywordEvidenceCommandRequest,
    KeywordEvidencePayloadContractComparator as KeywordEvidenceContractComparator,
    KeywordEvidencePayloadRunner as KeywordEvidenceRunner,
)


class KeywordEvidenceCliRunner:
    """CLI-compatible keyword evidence runner for analyzer JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        return KeywordEvidenceCommandRequest(self.argv).run()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    return KeywordEvidenceCommandRequest(argv).parser().parse_args([str(item) for item in argv] if argv is not None else None)


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = KeywordEvidenceCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
