from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


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
        payload = JsonContractReader().read_value(self.payload_path, {})
        return payload if isinstance(payload, dict) else {}


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
        return safe_read_json_object(self.js_report_path)


class VideoLinkDirectPlanRequest:
    """Scraper-layer request for direct-link plan JSON contract commands."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return VideoLinkDirectPlanContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return VideoLinkDirectPlanRunner(self.payload_path).run()


class VideoLinkDirectPlanCommandRequest:
    """Argv-backed scraper-layer request for direct-link routing plans."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a runVideoLinkDirect.js-compatible dry-run routing plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible direct-link plan report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return VideoLinkDirectPlanRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()
