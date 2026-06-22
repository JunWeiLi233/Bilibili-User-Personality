from __future__ import annotations

import argparse
import json

from python_backend.corpus.huggingface import HuggingFaceCorpusImportCommandRequest, HuggingFaceCorpusImportContractComparator, HuggingFaceCorpusImportPlanContractComparator, HuggingFaceCorpusImportPlanRunner, HuggingFaceCorpusImportRunner


def build_parser() -> argparse.ArgumentParser:
    return HuggingFaceCorpusImportCommandRequest.parser()


class HuggingFaceCorpusCliRunner(HuggingFaceCorpusImportCommandRequest):
    """CLI-compatible HuggingFace/Kaggle corpus import runner for JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = HuggingFaceCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
