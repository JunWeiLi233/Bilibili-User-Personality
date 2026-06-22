from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.dictionary_prune import ExhaustedTermsPrunePlanCommandRequest, ExhaustedTermsPrunePlanPayloadContractComparator as ExhaustedTermsPrunePlanContractComparator, ExhaustedTermsPrunePlanRunner


def build_parser() -> argparse.ArgumentParser:
    return ExhaustedTermsPrunePlanCommandRequest.parser()


class ExhaustedTermsPrunePlanCliRunner(ExhaustedTermsPrunePlanCommandRequest):
    """Compatibility wrapper for the corpus-owned exhausted-term prune command."""


def main(argv: list[str] | None = None) -> int:
    result = ExhaustedTermsPrunePlanCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
