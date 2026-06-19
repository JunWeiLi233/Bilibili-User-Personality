from __future__ import annotations

from typing import Any


def _parse_int(value: Any, fallback: int) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return fallback


class BatchBilibiliScrapePlanner:
    """Build a dry-run plan for batchScrapeBilibili.js UID range routing."""

    def build_plan(self, argv: list[Any] | None = None, progress: dict[str, Any] | None = None, database: dict[str, Any] | None = None) -> dict[str, Any]:
        argv = argv or []
        progress = progress or {}
        database = database or {}
        start_uid = 100000
        end_uid = 200000
        for raw in argv:
            arg = str(raw or "")
            if arg.startswith("--start="):
                start_uid = _parse_int(arg.split("=", 1)[1], start_uid)
            elif arg.startswith("--end="):
                end_uid = _parse_int(arg.split("=", 1)[1], end_uid)
        if start_uid <= 0:
            start_uid = 100000
        if end_uid <= 0:
            end_uid = 200000
        input_start = start_uid
        last_uid = _parse_int(progress.get("lastUid"), 0)
        resumed = last_uid >= start_uid
        if resumed:
            start_uid = last_uid + 1
        total = max(0, end_uid - start_uid + 1)
        users = database.get("users") if isinstance(database.get("users"), dict) else {}
        return {
            "ok": True,
            "input": {"startUid": input_start, "endUid": end_uid},
            "range": {"startUid": start_uid, "endUid": end_uid, "total": total},
            "resume": {"lastUid": last_uid, "resumed": resumed},
            "database": {"users": len(users)},
            "limits": {"maxVideos": 3, "maxComments": 50, "replyPages": 1},
            "progress": {
                "completed": _parse_int(progress.get("completed"), 0),
                "errors": len(progress.get("errors") if isinstance(progress.get("errors"), list) else []),
            },
        }
