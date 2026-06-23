from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from typing import Any


class JsonContractReader:
    """Read optional JS/Python JSON contract artifacts without aborting comparisons."""

    def __init__(self, default_object: dict[str, Any] | None = None):
        self.default_object = deepcopy(default_object) if isinstance(default_object, dict) else {}

    def read_object(self, path: str | Path) -> dict[str, Any]:
        json_path = Path(path)
        if not json_path.exists():
            return self._default()
        try:
            with json_path.open("r", encoding="utf-8-sig") as handle:
                payload = json.load(handle)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return self._default()
        return payload if isinstance(payload, dict) else self._default()

    def _default(self) -> dict[str, Any]:
        return deepcopy(self.default_object)


def safe_read_json_object(path: str | Path) -> dict[str, Any]:
    """Compatibility wrapper for existing contract comparators."""

    return JsonContractReader().read_object(path)
