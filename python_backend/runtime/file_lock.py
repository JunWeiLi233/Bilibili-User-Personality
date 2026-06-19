from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


class FileLockStateSummary:
    """Shape file-lock state reports into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("owner", "state")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        source = result if isinstance(result, dict) else {}
        return {key: source.get(key) for key in self.RESULT_KEYS if key in source}


class FileLockStateInspector:
    """Read JS file-lock owner.json state without acquiring or removing the lock."""

    def __init__(
        self,
        lock_path: str | Path,
        *,
        stale_ms: int = 60000,
        now_ms: Callable[[], int] | None = None,
        process_alive: Callable[[int], bool] | None = None,
    ):
        self.lock_path = Path(lock_path)
        self.stale_ms = int(stale_ms) if int(stale_ms or 0) > 0 else 60000
        self.now_ms = now_ms or self._now_ms
        self.process_alive = process_alive or self._process_alive

    def inspect(self) -> dict[str, Any]:
        owner = self._read_owner()
        exists = self.lock_path.exists()
        has_owner = isinstance(owner, dict)
        stale_by_age = self._stale_by_age(owner) if has_owner else False
        stale_by_pid = self._stale_by_pid(owner) if has_owner else False
        stale = bool(stale_by_age or stale_by_pid)
        return {
            "ok": True,
            "lockPath": str(self.lock_path),
            "owner": self._owner_summary(owner) if has_owner else None,
            "state": {
                "exists": exists,
                "hasOwner": has_owner,
                "staleByAge": stale_by_age,
                "staleByPid": stale_by_pid,
                "stale": stale,
                "shouldRemove": bool(exists and stale),
            },
        }

    def _read_owner(self) -> dict[str, Any] | None:
        owner_path = self.lock_path / "owner.json"
        if not owner_path.exists():
            return None
        try:
            with owner_path.open("r", encoding="utf-8-sig") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    def _owner_summary(self, owner: dict[str, Any] | None) -> dict[str, Any]:
        return {
            "pid": owner.get("pid") if isinstance(owner, dict) else None,
            "startedAt": owner.get("startedAt") if isinstance(owner, dict) else None,
            "command": owner.get("command") if isinstance(owner, dict) else None,
        }

    def _stale_by_age(self, owner: dict[str, Any] | None) -> bool:
        started_ms = self._parse_time_ms(str(owner.get("startedAt") or "")) if isinstance(owner, dict) else None
        if started_ms is None:
            return False
        return self.now_ms() - started_ms > self.stale_ms

    def _stale_by_pid(self, owner: dict[str, Any] | None) -> bool:
        if not isinstance(owner, dict):
            return False
        try:
            pid = int(owner.get("pid"))
        except (TypeError, ValueError):
            return False
        if pid <= 0:
            return False
        return not self.process_alive(pid)

    def _parse_time_ms(self, value: str) -> int | None:
        if not value:
            return None
        normalized = value.replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return int(parsed.timestamp() * 1000)

    def _now_ms(self) -> int:
        return int(datetime.now(timezone.utc).timestamp() * 1000)

    def _process_alive(self, pid: int) -> bool:
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True
