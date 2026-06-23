from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class JsonContractReader:
    """Read optional JS/Python JSON contract artifacts without aborting comparisons."""

    def read_object(self, path: str | Path) -> dict[str, Any]:
        json_path = Path(path)
        if not json_path.exists():
            return {}
        try:
            with json_path.open("r", encoding="utf-8-sig") as handle:
                payload = json.load(handle)
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}


def safe_read_json_object(path: str | Path) -> dict[str, Any]:
    """Compatibility wrapper for existing contract comparators."""

    return JsonContractReader().read_object(path)
