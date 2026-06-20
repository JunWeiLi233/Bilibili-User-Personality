from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.corpus.huggingface import HuggingFaceCorpusImportContractComparator, HuggingFaceCorpusImportPlanContractComparator, HuggingFaceCorpusImportRunner, HuggingFaceImportPlanner


class HuggingFaceCorpusImportPlanRunner:
    """Read a JS-compatible HuggingFace import option payload and emit a fetch plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        planner = HuggingFaceImportPlanner(default_output=str(payload.get("defaultOutput") or "server/data/huggingFaceKeywordCorpus.json"))
        return planner.build_plan(
            argv=payload.get("argv") if isinstance(payload.get("argv"), list) else [],
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
        )

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("HuggingFace import plan payload must be a JSON object.")
        return payload


def main() -> int:
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
    args = parser.parse_args()
    if args.plan_payload:
        if args.compare_js_report:
            result = HuggingFaceCorpusImportPlanContractComparator(args.plan_payload, args.compare_js_report).compare()
        else:
            result = HuggingFaceCorpusImportPlanRunner(args.plan_payload).run()
    elif not args.raw or not args.dataset or not args.file:
        parser.error("--raw, --dataset, and --file are required unless --plan-payload is provided.")
    elif args.compare_js_report:
        result = HuggingFaceCorpusImportContractComparator(
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
    else:
        result = HuggingFaceCorpusImportRunner(
            raw_path=args.raw,
            existing_path=args.existing,
            dataset=args.dataset,
            file=args.file,
            platform=args.platform,
            limit=args.limit,
            offset=args.offset,
            generated_at=args.generated_at or None,
        ).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
