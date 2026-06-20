from __future__ import annotations

import argparse
import json

from python_backend.corpus.tieba import TiebaCorpusJsonPayloadContractComparator, TiebaCorpusPayloadRunner, TiebaCorpusUpdateContractComparator, TiebaCorpusUpdateRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build a JS-compatible Tieba corpus update from JSON contracts.")
    parser.add_argument("--payload", default="", help="Single JSON payload containing existing, run, and optional generatedAt.")
    parser.add_argument("--existing", default="server/data/tiebaKeywordCorpus.json")
    parser.add_argument("--run", default="", help="Path to a Tieba scrape run JSON object.")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba corpus update report to compare.")
    return parser


class TiebaCorpusCliRunner:
    """CLI-compatible Tieba corpus update runner for JS/Python JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        parser = build_parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.payload and args.compare_js_report:
            return TiebaCorpusJsonPayloadContractComparator(args.payload, args.compare_js_report).compare()
        if args.payload:
            return TiebaCorpusPayloadRunner(args.payload).run()
        if args.compare_js_report:
            if not args.run:
                parser.error("--run is required unless --payload is provided")
            return TiebaCorpusUpdateContractComparator(
                args.existing,
                args.run,
                args.compare_js_report,
                generated_at=args.generated_at or None,
            ).compare()
        if not args.run:
            parser.error("--run is required unless --payload is provided")
        return TiebaCorpusUpdateRunner(args.existing, args.run, generated_at=args.generated_at or None).run()


def main(argv: list[str] | None = None) -> int:
    result = TiebaCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
