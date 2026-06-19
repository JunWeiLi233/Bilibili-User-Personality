from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from python_backend.analyzers.keyword_evidence import KeywordEvidenceMatcher


class KeywordEvidenceRunner:
    """Run keyword evidence matching from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.matcher = KeywordEvidenceMatcher()

    def run(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path, {})
        text = payload.get("text") or ""
        source = payload.get("source") or ""
        uid = payload.get("uid") or ""
        mode = str(payload.get("mode") or "entries").strip().lower()
        if mode == "dictionary":
            entries = self.matcher.find_dictionary_entries_with_text_evidence(
                payload.get("dictionary") if isinstance(payload.get("dictionary"), dict) else {},
                text,
                source=source,
                uid=uid,
                exclude_terms=payload.get("excludeTerms") if isinstance(payload.get("excludeTerms"), list) else [],
            )
        else:
            entries = self.matcher.filter_entries_by_evidence(
                payload.get("entries") if isinstance(payload.get("entries"), list) else [],
                text,
                source=source,
                uid=uid,
            )
            mode = "entries"
        return {"ok": True, "mode": mode, "count": len(entries), "entries": entries}

    def _read_json(self, path: Path, fallback: Any) -> Any:
        if not path.exists():
            return fallback
        with path.open("r", encoding="utf-8-sig") as handle:
            return json.load(handle)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Match keyword dictionary entries against direct text evidence.")
    parser.add_argument("--payload", required=True, help="JSON payload with entries or dictionary plus text.")
    args = parser.parse_args()
    result = KeywordEvidenceRunner(args.payload).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
