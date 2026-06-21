from __future__ import annotations

import argparse
import json

from python_backend.corpus.local import LocalCorpusFlattenPayloadContractComparator as LocalCorpusFlattenContractComparator, LocalCorpusFlattenRequest, LocalCorpusFlattenRunner


class LocalCorpusFlattenCliRunner:
    """CLI-compatible local corpus flatten runner for JSON contract checks."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        args = parse_args(self.argv)
        input_path = args.payload or args.input
        return LocalCorpusFlattenRequest(
            input_path=input_path,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Flatten local Bilibili/Tieba corpus JSON into JS-compatible comments.")
    parser.add_argument("--payload", default="", help="Alias for --input; JSON file to flatten.")
    parser.add_argument("--input", default="", help="Input JSON file to flatten.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local corpus flatten report to compare.")
    args = parser.parse_args([str(item) for item in argv] if argv is not None else None)
    input_path = args.payload or args.input
    if not input_path:
        parser.error("--input or --payload is required")
    return args


def main(argv: list[str] | None = None) -> int:
    result = LocalCorpusFlattenCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
