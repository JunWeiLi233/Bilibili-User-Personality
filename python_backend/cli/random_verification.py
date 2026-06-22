from __future__ import annotations

import sys

from python_backend.analysis.verification import (
    RandomVerificationPayloadContractComparator as RandomVerificationContractComparator,
    RandomVerificationCommandRequest,
    RandomVerificationRequest,
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
            return RandomVerificationCommandRequest(self.corpus_or_argv).run()
        return RandomVerificationRequest(
            corpus_path=self.corpus_or_argv,
            dictionary_path=self.dictionary_path,
            sample_size=self.sample_size,
            seed=self.seed,
        ).run()

    @staticmethod
    def _parser():
        return RandomVerificationCommandRequest.parser()


class RandomVerificationCliRunner:
    """Dedicated argv-based random verification runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        return RandomVerificationCommandRequest(self.argv).run()


def main(argv: list[str] | None = None) -> int:
    result = RandomVerificationCliRunner(argv).run()
    sys.stdout.buffer.write(json_result_bytes(result))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
