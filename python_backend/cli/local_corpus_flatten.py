from __future__ import annotations

import argparse
import json

from python_backend.corpus.local import LocalCorpusFlattenCommandRequest, LocalCorpusFlattenPayloadContractComparator as LocalCorpusFlattenContractComparator, LocalCorpusFlattenRunner


class LocalCorpusFlattenCliRunner(LocalCorpusFlattenCommandRequest):
    """CLI-compatible local corpus flatten runner for JSON contract checks."""


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    return LocalCorpusFlattenCommandRequest.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    result = LocalCorpusFlattenCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
