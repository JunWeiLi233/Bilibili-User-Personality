from __future__ import annotations

import argparse
import json

from python_backend.corpus.contracts import ContractComparator


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate Python compatibility with JS JSON corpus/audit contracts.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--audit", default="server/data/keywordCoverageAudit.json")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    args = parser.parse_args(argv)
    result = ContractComparator(args.corpus, args.audit, args.dictionary).compare()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
