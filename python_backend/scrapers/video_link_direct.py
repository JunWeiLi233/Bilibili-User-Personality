from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class VideoLinkDirectPlanSummary:
    """Shape direct-link dry-run plans into the JS/Python comparator contract."""

    RESULT_KEYS = ("mode", "input", "collect", "training")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class VideoLinkDirectPlanner:
    """Build a dry-run plan compatible with runVideoLinkDirect.js CLI routing."""

    def build_plan(self, argv: list[str]) -> dict[str, Any]:
        params = self._parse_args(argv)
        mode = self._mode(params)
        if not mode:
            return {
                "ok": False,
                "error": "missing-target",
                "usage": "runVideoLinkDirect requires --video-link, --favorite-link, or --uid.",
            }
        return {
            "ok": True,
            "mode": mode,
            "input": {
                "uid": params.get("uid", ""),
                "videoLink": params.get("videoLink", ""),
                "favoriteLink": params.get("favoriteLink", ""),
                "pages": params["pages"],
                "hasCookie": bool(params.get("bilibiliCookie")),
            },
            "collect": self._collect_plan(mode, params),
            "training": self._training_plan(mode, params),
        }

    def _parse_args(self, argv: list[str]) -> dict[str, Any]:
        params: dict[str, Any] = {"pages": 2}
        index = 0
        while index < len(argv):
            arg = str(argv[index] or "")
            if arg in ("--video-link", "-v") and index + 1 < len(argv):
                index += 1
                params["videoLink"] = str(argv[index])
            elif arg in ("--favorite-link", "-f") and index + 1 < len(argv):
                index += 1
                params["favoriteLink"] = str(argv[index])
            elif arg in ("--uid", "-u") and index + 1 < len(argv):
                index += 1
                params["uid"] = str(argv[index])
            elif arg in ("--cookie", "-c") and index + 1 < len(argv):
                index += 1
                params["bilibiliCookie"] = str(argv[index])
            elif arg in ("--pages", "-p") and index + 1 < len(argv):
                index += 1
                params["pages"] = self._js_number_or_default(argv[index], 2)
            index += 1
        return params

    def _mode(self, params: dict[str, Any]) -> str:
        if params.get("uid"):
            return "uid"
        if params.get("videoLink"):
            return "video"
        if params.get("favoriteLink"):
            return "favorite"
        return ""

    def _collect_plan(self, mode: str, params: dict[str, Any]) -> dict[str, Any]:
        if mode == "uid":
            return {
                "function": "analyzeUid",
                "pagesPerObject": params["pages"],
                "forwardsCookie": bool(params.get("bilibiliCookie")),
            }
        return {
            "function": "searchVideoKeywords",
            "pages": params["pages"],
            "forwardsCookie": bool(params.get("bilibiliCookie")),
        }

    def _training_plan(self, mode: str, params: dict[str, Any]) -> dict[str, Any]:
        if mode == "uid":
            uid = params.get("uid", "")
            return {"existingTermsOnly": True, "multiagent": True, "source": f"Bilibili UID {uid}", "uid": uid}
        return {
            "existingTermsOnly": True,
            "multiagent": True,
            "source": params.get("videoLink") or params.get("favoriteLink") or "Bilibili direct link",
            "uid": "",
        }

    def _js_number_or_default(self, value: Any, default: int) -> int:
        try:
            number = int(float(str(value)))
        except (TypeError, ValueError):
            return default
        return number or default


class VideoLinkDirectPlanRunner:
    """Read a JS-compatible direct-link payload and emit the dry-run routing plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = VideoLinkDirectPlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        argv = payload.get("argv") if isinstance(payload.get("argv"), list) else []
        return self.planner.build_plan([str(item) for item in argv])

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("Video direct-link plan payload must be a JSON object.")
        return payload


class VideoLinkDirectPlanContractComparator:
    """Compare Python direct-link plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = VideoLinkDirectPlanSummary()

    def compare(self) -> dict[str, Any]:
        python_result = VideoLinkDirectPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        mismatches = [
            {"key": key, "python": python_result.get(key), "js": js_result.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js_result and python_result.get(key) != js_result.get(key)
        ]
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_result),
            "js": self.summary.summarize(js_result),
        }

    def _read_js_report(self) -> dict[str, Any]:
        with self.js_report_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}
