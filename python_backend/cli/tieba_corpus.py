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


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a JS-compatible Tieba corpus update from JSON contracts.")
    parser.add_argument("--existing", default="server/data/tiebaKeywordCorpus.json")
    parser.add_argument("--run", required=True, help="Path to a Tieba scrape run JSON object.")
    parser.add_argument("--generated-at", default="")
    args = parser.parse_args()
    result = TiebaCorpusUpdateRunner(args.existing, args.run, generated_at=args.generated_at or None).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
