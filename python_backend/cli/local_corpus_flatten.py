from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.corpus.local import LocalCorpusFlattener


class LocalCorpusFlattenRunner:
    """Flatten local corpus JSON into the shared comment contract."""

    def __init__(self, input_path: str | Path):
        self.input_path = Path(input_path)
        self.flattener = LocalCorpusFlattener()

    def run(self) -> dict[str, Any]:
        with self.input_path.open("r", encoding="utf-8-sig") as handle:
            raw = json.load(handle)
        comments = self.flattener.flatten(raw)
        return {
            "ok": True,
            "count": len(comments),
            "comments": comments,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description="Flatten local Bilibili/Tieba corpus JSON into JS-compatible comments.")
    parser.add_argument("--input", required=True, help="Input JSON file to flatten.")
    args = parser.parse_args()
    result = LocalCorpusFlattenRunner(args.input).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
