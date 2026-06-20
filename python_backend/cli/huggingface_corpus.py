from __future__ import annotations

import argparse
import json

from python_backend.corpus.huggingface import HuggingFaceCorpusImportContractComparator, HuggingFaceCorpusImportPlanContractComparator, HuggingFaceCorpusImportPlanRunner, HuggingFaceCorpusImportRunner


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Parse a local HuggingFace/Kaggle corpus file into the JS-compatible corpus contract.")
    parser.add_argument("--plan-payload", default="", help="Path to a JS-compatible import option payload for dry-run fetch planning.")
    parser.add_argument("--raw", default="", help="Path to downloaded JSON/JSONL/CSV source rows.")
    parser.add_argument("--existing", default="server/data/huggingFaceKeywordCorpus.json", help="Existing corpus JSON manifest.")
    parser.add_argument("--dataset", default="")
    parser.add_argument("--file", default="")
    parser.add_argument("--platform", default="huggingface")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible HuggingFace/Kaggle import report to compare.")
    return parser


class HuggingFaceCorpusCliRunner:
    """CLI-compatible HuggingFace/Kaggle corpus import runner for JSON contracts."""

    def __init__(self, argv: list[str] | None = None):
        self.argv = argv

    def run(self) -> dict:
        parser = build_parser()
        args = parser.parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        if args.plan_payload:
            if args.compare_js_report:
                return HuggingFaceCorpusImportPlanContractComparator(args.plan_payload, args.compare_js_report).compare()
            return HuggingFaceCorpusImportPlanRunner(args.plan_payload).run()
        if not args.raw or not args.dataset or not args.file:
            parser.error("--raw, --dataset, and --file are required unless --plan-payload is provided.")
        if args.compare_js_report:
            return HuggingFaceCorpusImportContractComparator(
                raw_path=args.raw,
                existing_path=args.existing,
                dataset=args.dataset,
                file=args.file,
                platform=args.platform,
                limit=args.limit,
                offset=args.offset,
                js_report_path=args.compare_js_report,
                generated_at=args.generated_at or None,
            ).compare()
        return HuggingFaceCorpusImportRunner(
            raw_path=args.raw,
            existing_path=args.existing,
            dataset=args.dataset,
            file=args.file,
            platform=args.platform,
            limit=args.limit,
            offset=args.offset,
            generated_at=args.generated_at or None,
        ).run()


def main(argv: list[str] | None = None) -> int:
    result = HuggingFaceCorpusCliRunner(argv).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
