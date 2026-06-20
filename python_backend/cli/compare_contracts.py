from __future__ import annotations

import argparse
import json

from python_backend.corpus.contracts import ContractComparator


class CompareContractsRunner:
    """CLI-compatible JS/Python contract comparator runner."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = build_parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return ContractComparator(args.corpus, args.audit, args.dictionary).compare()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate Python compatibility with JS JSON corpus/audit contracts.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    return parser


def main(argv: list[str] | None = None) -> int:
    result = CompareContractsRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
