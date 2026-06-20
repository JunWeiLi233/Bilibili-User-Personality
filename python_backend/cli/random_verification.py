from __future__ import annotations

import argparse
import sys

from python_backend.analysis.verification import (
    RandomVerificationPayloadContractComparator as RandomVerificationContractComparator,
    RandomVerificationRunner,
    json_result_bytes,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Python random verification over JS-compatible corpus and dictionary JSON.")
    parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
    parser.add_argument("--sample-size", type=int)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--compare-js-report", default="")
    args = parser.parse_args()
    if args.compare_js_report:
        result = RandomVerificationContractComparator(
            args.corpus,
            args.dictionary,
            args.compare_js_report,
            sample_size=args.sample_size,
            seed=args.seed,
        ).compare()
    else:
        result = RandomVerificationRunner(
            args.corpus,
            args.dictionary,
            sample_size=args.sample_size if args.sample_size is not None else 50,
            seed=args.seed if args.seed is not None else 1,
        ).run()
    sys.stdout.buffer.write(json_result_bytes(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
