from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder, DirectProbeCorpusSummary


class DirectProbeCorpusRunner:
    """Build a direct Bilibili probe corpus update from JSON contract files."""

    def __init__(self, existing_path: str | Path, comments_path: str | Path, run_path: str | Path):
        self.existing_path = Path(existing_path)
        self.comments_path = Path(comments_path)
        self.run_path = Path(run_path)
        self.builder = DirectProbeCorpusBuilder()

    def run(self) -> dict[str, Any]:
        existing = self._read_json_object(self.existing_path, {"version": 1, "comments": [], "runs": []})
        comments_payload = self._read_json(self.comments_path, [])
        comments = comments_payload.get("comments") if isinstance(comments_payload, dict) else comments_payload
        run = self._read_json_object(self.run_path, {})
        return self.builder.build_probe_corpus_result(existing, comments if isinstance(comments, list) else [], run)

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        payload = self._read_json(path, fallback)
        return payload if isinstance(payload, dict) else fallback


class DirectProbeCorpusContractComparator:
    """Compare Python direct-probe corpus updates against saved JS-compatible JSON."""

    def __init__(self, existing_path: str | Path, comments_path: str | Path, run_path: str | Path, js_report_path: str | Path):
        self.existing_path = Path(existing_path)
        self.comments_path = Path(comments_path)
        self.run_path = Path(run_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DirectProbeCorpusSummary()

    def compare(self) -> dict[str, Any]:
        python_result = DirectProbeCorpusRunner(self.existing_path, self.comments_path, self.run_path).run()
        js_result = self._read_js_report()
        python_summary = self.summary.summarize(python_result)
        js_summary = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python_summary.get(key), "js": js_summary.get(key)}
            for key in self.summary.SUMMARY_KEYS
            if key in js_summary and python_summary.get(key) != js_summary.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_summary,
            "js": js_summary,
        }

    def _read_js_report(self) -> dict[str, Any]:
        if not self.js_report_path.exists():
            return {}
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Build a JS-compatible Bilibili direct probe corpus update.")
    parser.add_argument("--existing", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--comments", required=True, help="JSON list or object with a comments array.")
    parser.add_argument("--run", required=True, help="Direct probe run JSON object.")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct probe corpus report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = DirectProbeCorpusContractComparator(args.existing, args.comments, args.run, args.compare_js_report).compare()
    else:
        result = DirectProbeCorpusRunner(args.existing, args.comments, args.run).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
