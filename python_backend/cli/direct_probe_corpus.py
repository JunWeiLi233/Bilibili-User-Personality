from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.direct_probe import DirectProbeCorpusCommandRequest, DirectProbeCorpusJsonPayloadContractComparator, DirectProbeCorpusPayloadContractComparator as DirectProbeCorpusContractComparator, DirectProbeCorpusPayloadRunner, DirectProbeCorpusRunner


def build_parser() -> argparse.ArgumentParser:
    return DirectProbeCorpusCommandRequest.parser()


class DirectProbeCorpusCliRunner(DirectProbeCorpusCommandRequest):
    """CLI-compatible direct probe corpus update runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = DirectProbeCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
