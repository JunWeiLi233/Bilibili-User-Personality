from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.corpus.direct_probe import DirectProbeCorpusBuilder


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
        return {"ok": True, "corpus": self.builder.build_probe_corpus(existing, comments if isinstance(comments, list) else [], run)}

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)

    def _read_json_object(self, path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
        payload = self._read_json(path, fallback)
        return payload if isinstance(payload, dict) else fallback


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Build a JS-compatible Bilibili direct probe corpus update.")
    parser.add_argument("--existing", default="server/data/bilibiliDirectProbeCorpus.json")
    parser.add_argument("--comments", required=True, help="JSON list or object with a comments array.")
    parser.add_argument("--run", required=True, help="Direct probe run JSON object.")
    args = parser.parse_args()
    result = DirectProbeCorpusRunner(args.existing, args.comments, args.run).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
