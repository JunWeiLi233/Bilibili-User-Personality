from __future__ import annotations

import argparse
import json

from python_backend.corpus.local import LocalCorpusFlattenPayloadContractComparator as LocalCorpusFlattenContractComparator, LocalCorpusFlattenRunner

def main() -> int:
    parser = argparse.ArgumentParser(description="Flatten local Bilibili/Tieba corpus JSON into JS-compatible comments.")
    parser.add_argument("--input", required=True, help="Input JSON file to flatten.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible local corpus flatten report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = LocalCorpusFlattenContractComparator(args.input, args.compare_js_report).compare()
    else:
        result = LocalCorpusFlattenRunner(args.input).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
