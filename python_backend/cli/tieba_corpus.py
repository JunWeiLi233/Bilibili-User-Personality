from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from python_backend.corpus.tieba import TiebaCorpusUpdater


class TiebaCorpusUpdateRunner:
    """Run a Tieba corpus update from existing corpus and scrape-run JSON files."""

    def __init__(self, existing_path: str | Path, run_path: str | Path, generated_at: str | None = None):
        self.existing_path = Path(existing_path)
        self.run_path = Path(run_path)
        self.generated_at = generated_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.updater = TiebaCorpusUpdater()

    def run(self) -> dict[str, Any]:
        existing = self._read_json(self.existing_path, {"version": 1, "updatedAt": None, "runs": [], "comments": []})
        run = self._read_json(self.run_path, {})
        return {"ok": True, **self.updater.build_update(existing, run, self.generated_at)}

    def _read_json(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else fallback


class TiebaCorpusUpdateContractComparator:
    """Compare Python Tieba corpus updates against saved JS-compatible JSON."""

    RESULT_KEYS = ("changed", "newComments", "corpus")

    def __init__(
        self,
        existing_path: str | Path,
        run_path: str | Path,
        js_report_path: str | Path,
        generated_at: str | None = None,
    ):
        self.existing_path = Path(existing_path)
        self.run_path = Path(run_path)
        self.js_report_path = Path(js_report_path)
        self.generated_at = generated_at

    def compare(self) -> dict[str, Any]:
        python_result = TiebaCorpusUpdateRunner(self.existing_path, self.run_path, generated_at=self.generated_at).run()
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
    parser = argparse.ArgumentParser(description="Build a JS-compatible Tieba corpus update from JSON contracts.")
    parser.add_argument("--existing", default="server/data/tiebaKeywordCorpus.json")
    parser.add_argument("--run", required=True, help="Path to a Tieba scrape run JSON object.")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible Tieba corpus update report to compare.")
    args = parser.parse_args()
    if args.compare_js_report:
        result = TiebaCorpusUpdateContractComparator(
            args.existing,
            args.run,
            args.compare_js_report,
            generated_at=args.generated_at or None,
        ).compare()
    else:
        result = TiebaCorpusUpdateRunner(args.existing, args.run, generated_at=args.generated_at or None).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
