from __future__ import annotations

import argparse
import json
import sys

from python_backend.scrapers.tieba_html import (
    TiebaHtmlParseCommandRequest,
    TiebaHtmlParsePayloadContractComparator as TiebaHtmlParseContractComparator,
    TiebaHtmlParseRunner,
)


def build_parser() -> argparse.ArgumentParser:
    return TiebaHtmlParseCommandRequest.parser()


class TiebaHtmlParseCliRunner(TiebaHtmlParseCommandRequest):
    """CLI-compatible Tieba HTML parser runner for JS/Python JSON contracts."""


def main(argv: list[str] | None = None) -> int:
    result = TiebaHtmlParseCliRunner(argv).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
