from __future__ import annotations

import argparse
import json

from python_backend.corpus.local import LocalCorpusFlattenPayloadContractComparator as LocalCorpusFlattenContractComparator, LocalCorpusFlattenRunner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Flatten local Bilibili/Tieba corpus JSON into JS-compatible comments.")
    parser.add_argument("--payload", default="", help="Alias for --input; JSON file to flatten.")
    parser.add_argument("--input", default="", help="Input JSON file to flatten.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local corpus flatten report to compare.")
    args = parser.parse_args(argv)
    input_path = args.payload or args.input
    if not input_path:
        parser.error("--input or --payload is required")
    if args.compare_js_report:
        result = LocalCorpusFlattenContractComparator(input_path, args.compare_js_report).compare()
    else:
        result = LocalCorpusFlattenRunner(input_path).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
