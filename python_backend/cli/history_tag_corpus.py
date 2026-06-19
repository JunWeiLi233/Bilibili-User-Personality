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


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Merge JS-compatible Bilibili history tag corpus JSON.")
    parser.add_argument("--current", default="server/data/bilibiliHistoryTagCorpus.json")
    parser.add_argument("--update", required=True, help="History-tag scrape update JSON object.")
    parser.add_argument("--generated-at", default="")
    args = parser.parse_args()
    result = HistoryTagCorpusRunner(args.current, args.update, generated_at=args.generated_at or None).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
