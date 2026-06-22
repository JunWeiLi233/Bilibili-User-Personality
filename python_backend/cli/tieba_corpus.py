from __future__ import annotations

import argparse
import json

from python_backend.corpus.tieba import TiebaCorpusCommandRequest, TiebaCorpusJsonPayloadContractComparator, TiebaCorpusPayloadRunner, TiebaCorpusUpdateContractComparator, TiebaCorpusUpdateRunner


def build_parser() -> argparse.ArgumentParser:
    return TiebaCorpusCommandRequest.parser()


class TiebaCorpusCliRunner(TiebaCorpusCommandRequest):
    """CLI-compatible Tieba corpus update runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = TiebaCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
