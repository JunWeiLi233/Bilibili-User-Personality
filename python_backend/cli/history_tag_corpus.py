from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.history_tags import HistoryTagCorpusManager


class HistoryTagCorpusRunner:
    """Merge Bilibili history-tag corpus JSON contracts."""

    def __init__(self, current_path: str | Path, update_path: str | Path, generated_at: str | None = None):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path)
        self.manager = HistoryTagCorpusManager(generated_at=generated_at)

    def run(self) -> dict[str, Any]:
        current = self._read_json_object(self.current_path, {"version": 1, "updatedAt": None, "tags": [], "videos": [], "runs": []})
        update = self._read_json_object(self.update_path, {"tags": [], "videos": [], "runs": []})
        corpus = self.manager.merge(current, update)
        return {"ok": True, "corpus": corpus, "tags": len(corpus["tags"]), "videos": len(corpus["videos"]), "runs": len(corpus["runs"])}

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class HistoryTagCorpusContractComparator:
    """Compare Python history-tag corpus merges against saved JS-compatible JSON."""

    RESULT_KEYS = ("corpus", "tags", "videos", "runs")

    def __init__(
        self,
        current_path: str | Path,
        update_path: str | Path,
        js_report_path: str | Path,
        generated_at: str | None = None,
    ):
        self.current_path = Path(current_path)
        self.update_path = Path(update_path)
        self.js_report_path = Path(js_report_path)
        self.generated_at = generated_at

    def compare(self) -> dict[str, Any]:
        python_result = HistoryTagCorpusRunner(self.current_path, self.update_path, generated_at=self.generated_at).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self._summary(python_result),
            "js": self._summary(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _summary(self, result: dict[str, Any]) -> dict[str, Any]:
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Merge JS-compatible Bilibili history tag corpus JSON.")
    parser.add_argument("--current", default="server/data/bilibiliHistoryTagCorpus.json")
    parser.add_argument("--update", required=True, help="History-tag scrape update JSON object.")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible history-tag corpus report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = HistoryTagCorpusContractComparator(
            args.current,
            args.update,
            args.compare_js_report,
            generated_at=args.generated_at or None,
        ).compare()
    else:
        result = HistoryTagCorpusRunner(args.current, args.update, generated_at=args.generated_at or None).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
