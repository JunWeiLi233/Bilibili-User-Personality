from __future__ import annotations

import argparse
import json
import sys

from python_backend.corpus.direct_probe import DirectProbeCorpusJsonPayloadContractComparator, DirectProbeCorpusPayloadContractComparator as DirectProbeCorpusContractComparator, DirectProbeCorpusPayloadRunner, DirectProbeCorpusRequest, DirectProbeCorpusRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible Bilibili direct probe corpus update.")
    parser.add_argument("--payload", default="", help="Single JSON payload containing existing, comments, and run.")
    parser.add_argument("--existing", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--comments", default="", help="JSON list or object with a comments array.")
    parser.add_argument("--run", default="", help="Direct probe run JSON object.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct probe corpus report to compare.")
    return parser


class DirectProbeCorpusCliRunner:
    """CLI-compatible direct probe corpus update runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        parser = build_parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if not args.payload and (not args.comments or not args.run):
            parser.error("--comments and --run are required unless --payload is provided")
        return DirectProbeCorpusRequest(
            existing_path=args.existing,
            comments_path=args.comments,
            run_path=args.run,
            payload_path=args.payload,
            compare_js_report_path=args.compare_js_report,
        ).run()


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    result = DirectProbeCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
