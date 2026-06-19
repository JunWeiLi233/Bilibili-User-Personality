from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.corpus.huggingface import HuggingFaceCorpusImporter


class HuggingFaceCorpusImportRunner:
    """Run a local HuggingFace/Kaggle corpus import against JSON contracts."""

    def __init__(
        self,
        raw_path: str | Path,
        existing_path: str | Path,
        dataset: str,
        file: str,
        platform: str,
        limit: int = 500,
        offset: int = 0,
        generated_at: str | None = None,
    ):
        self.raw_path = Path(raw_path)
        self.existing_path = Path(existing_path)
        self.dataset = dataset
        self.file = file
        self.platform = platform
        self.limit = limit
        self.offset = offset
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.importer = HuggingFaceCorpusImporter()

    def run(self) -> dict[str, Any]:
        raw = self.raw_path.read_text(encoding="utf-8-sig")
        existing = self._read_existing()
        source = {
            "dataset": self.dataset,
            "file": self.file,
            "platform": self.platform,
            "limit": self.limit,
            "offset": self.offset,
        }
        rows = self.importer.parse_rows(raw, source)
        run = {
            "at": self.generated_at,
            "sources": [source],
            "results": [{**source, "ok": True, "rows": len(rows)}],
        }
        update = self.importer.build_update(existing, rows, run, self.generated_at)
        return {
            "ok": True,
            "importedRows": len(rows),
            **update,
        }

    def _read_existing(self) -> dict[str, Any]:
        if not self.existing_path.exists():
            return {"version": 1, "updatedAt": None, "runs": [], "comments": []}
        with self.existing_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {"version": 1, "updatedAt": None, "runs": [], "comments": []}


class HuggingFaceCorpusImportContractComparator:
    """Compare Python HuggingFace/Kaggle corpus imports against saved JS-compatible JSON."""

    RESULT_KEYS = ("importedRows", "changed", "addedComments", "corpus")
    SUMMARY_KEYS = ("importedRows", "changed", "addedComments")

    def __init__(
        self,
        raw_path: str | Path,
        existing_path: str | Path,
        dataset: str,
        file: str,
        platform: str,
        js_report_path: str | Path,
        limit: int = 500,
        offset: int = 0,
        generated_at: str | None = None,
    ):
        self.raw_path = Path(raw_path)
        self.existing_path = Path(existing_path)
        self.dataset = dataset
        self.file = file
        self.platform = platform
        self.js_report_path = Path(js_report_path)
        self.limit = limit
        self.offset = offset
        self.generated_at = generated_at

    def compare(self) -> dict[str, Any]:
        python_result = HuggingFaceCorpusImportRunner(
            raw_path=self.raw_path,
            existing_path=self.existing_path,
            dataset=self.dataset,
            file=self.file,
            platform=self.platform,
            limit=self.limit,
            offset=self.offset,
            generated_at=self.generated_at,
        ).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": {"summary": self._summary(python_result)},
            "js": {"summary": self._summary(js_result)},
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.SUMMARY_KEYS if key in result}


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse a local HuggingFace/Kaggle corpus file into the JS-compatible corpus contract.")
    parser.add_argument("--raw", required=True, help="Path to downloaded JSON/JSONL/CSV source rows.")
    parser.add_argument("--existing", default="server/data/huggingFaceKeywordCorpus.json", help="Existing corpus JSON manifest.")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--file", required=True)
    parser.add_argument("--platform", default="huggingface")
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible HuggingFace/Kaggle import report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
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
