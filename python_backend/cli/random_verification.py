from __future__ import annotations

import argparse
import sys

from python_backend.analysis.verification import (
    RandomVerificationPayloadRunner,
    RandomVerificationPayloadContractComparator as RandomVerificationContractComparator,
    RandomVerificationRunner as AnalysisRandomVerificationRunner,
    json_result_bytes,
)


class RandomVerificationRunner:
    """CLI-compatible random verification runner with path and JSON-payload modes."""

    def __init__(self, corpus_or_argv, dictionary_path=None, sample_size: int = 50, seed: int = 1):
        self.corpus_or_argv = corpus_or_argv
        self.dictionary_path = dictionary_path
        self.sample_size = sample_size
        self.seed = seed

    def run(self) -> dict:
        if isinstance(self.corpus_or_argv, list):
            args = self._parser().parse_args([str(item) for item in self.corpus_or_argv])
            if args.payload:
                return RandomVerificationPayloadRunner(args.payload).run()
            return AnalysisRandomVerificationRunner(
                args.corpus,
                args.dictionary,
                sample_size=args.sample_size if args.sample_size is not None else 50,
                seed=args.seed if args.seed is not None else 1,
            ).run()
        return AnalysisRandomVerificationRunner(
            self.corpus_or_argv,
            self.dictionary_path,
            sample_size=self.sample_size,
            seed=self.seed,
        ).run()

    @staticmethod
    def _parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Run Python random verification over JS-compatible corpus and dictionary JSON.")
        parser.add_argument("--payload", default="")
        parser.add_argument("--corpus", default="server/data/bilibiliDirectProbeCorpus.json")
        parser.add_argument("--dictionary", default="server/data/deepseekKeywordDictionary.json")
        parser.add_argument("--sample-size", type=int)
        parser.add_argument("--seed", type=int)
        parser.add_argument("--compare-js-report", default="")
        return parser


def main(argv: list[str] | None = None) -> int:
    parser = RandomVerificationRunner._parser()
    args = parser.parse_args(argv)
    if args.payload:
        result = RandomVerificationPayloadRunner(args.payload).run()
    elif args.compare_js_report:
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
