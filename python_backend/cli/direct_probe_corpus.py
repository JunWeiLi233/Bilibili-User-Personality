from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.direct_probe import DirectProbeCorpusJsonPayloadContractComparator, DirectProbeCorpusPayloadContractComparator as DirectProbeCorpusContractComparator, DirectProbeCorpusPayloadRunner, DirectProbeCorpusRunner


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Build a JS-compatible Bilibili direct probe corpus update.")
    parser.add_argument("--payload", default="", help="Single JSON payload containing existing, comments, and run.")
    parser.add_argument("--existing", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--comments", default="", help="JSON list or object with a comments array.")
    parser.add_argument("--run", default="", help="Direct probe run JSON object.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct probe corpus report to compare.")
    args = parser.parse_args(argv)
    if args.payload and args.compare_js_report:
        result = DirectProbeCorpusJsonPayloadContractComparator(args.payload, args.compare_js_report).compare()
    elif args.payload:
        result = DirectProbeCorpusPayloadRunner(args.payload).run()
    elif args.compare_js_report:
        if not args.comments or not args.run:
            parser.error("--comments and --run are required unless --payload is provided")
        result = DirectProbeCorpusContractComparator(args.existing, args.comments, args.run, args.compare_js_report).compare()
    else:
        if not args.comments or not args.run:
            parser.error("--comments and --run are required unless --payload is provided")
        result = DirectProbeCorpusRunner(args.existing, args.comments, args.run).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
