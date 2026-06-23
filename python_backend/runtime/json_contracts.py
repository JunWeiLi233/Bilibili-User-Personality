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
        payload = self.read_value(path, self.default_object)
        return payload if isinstance(payload, dict) else self._default()

    def read_value(self, path: str | Path, default_value: Any) -> Any:
        json_path = Path(path)
        if not json_path.exists():
            return deepcopy(default_value)
        try:
            with json_path.open("r", encoding="utf-8-sig") as handle:
                return json.load(handle)
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return deepcopy(default_value)

    def read_text_value(self, text: Any, default_value: Any) -> Any:
        content = str(text or "").strip()
        if not content:
            return deepcopy(default_value)
        try:
            return json.loads(content)
        except (TypeError, ValueError, json.JSONDecodeError):
            return deepcopy(default_value)

    def decode_string_literal_content(self, text: Any, fallback: Any = "") -> Any:
        escaped = str(text or "")
        try:
            return json.loads(f'"{escaped}"')
        except (TypeError, ValueError, json.JSONDecodeError):
            return deepcopy(fallback)

    def _default(self) -> dict[str, Any]:
        return deepcopy(self.default_object)


class JsonResultBytesContract:
    """Serialize CLI JSON results using the shared JS/Python compatibility format."""

    def __init__(self, result: Any):
        self.result = result

    def to_bytes(self) -> bytes:
        return (json.dumps(self.result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    def to_text(self) -> str:
        return self.to_bytes().decode("utf-8")

    def write_text(self, stream: Any) -> int:
        return stream.write(self.to_text())

    def write_bytes(self, stream: Any) -> int:
        return stream.write(self.to_bytes())

    def exit_code(self) -> int:
        return 0 if isinstance(self.result, dict) and self.result.get("ok") is True else 1

    def run_text(self, stream: Any) -> int:
        self.write_text(stream)
        return self.exit_code()

    def run_bytes(self, stream: Any) -> int:
        self.write_bytes(stream)
        return self.exit_code()


def safe_read_json_object(path: str | Path) -> dict[str, Any]:
    """Compatibility wrapper for existing contract comparators."""

    return JsonContractReader().read_object(path)
