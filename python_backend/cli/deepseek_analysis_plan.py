from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek import DeepSeekAnalyzerClient, DeepSeekAnalysisPlanSummary


class DeepSeekAnalysisPlanRunner:
    """Emit Python-built DeepSeek analyzer request plans for JS orchestration."""

    def __init__(self, payload_path: str | Path, compact: bool = False):
        self.payload_path = Path(payload_path)
        self.compact = compact
        self.client = DeepSeekAnalyzerClient()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        request = self.client.build_request_from_payload(payload)
        requests = self.client.build_request_plan(request, compact=self.compact)
        if request.multiagent:
            return {
                "ok": True,
                "mode": "multiagent",
                "requests": requests,
                "merge": {
                    "mergeAgent": "quality-merge",
                    "requestTemplate": self.client.build_merge_request(request, [], compact=self.compact),
                },
            }
        return {
            "ok": True,
            "mode": "single",
            "requests": requests,
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        if not isinstance(payload, dict):
            raise ValueError("DeepSeek analysis payload must be a JSON object.")
        return payload


class DeepSeekAnalysisPlanContractComparator:
    """Compare Python-built DeepSeek request plans against saved JS-compatible plans."""

    def __init__(self, payload_path: str | Path, js_plan_path: str | Path, compact: bool = False):
        self.payload_path = Path(payload_path)
        self.js_plan_path = Path(js_plan_path)
        self.compact = compact
        self.summary = DeepSeekAnalysisPlanSummary()

    def compare(self) -> dict[str, Any]:
        python_plan = DeepSeekAnalysisPlanRunner(self.payload_path, compact=self.compact).run()
        js_plan = self._read_js_plan()
        mismatches = self._mismatches(python_plan, js_plan)
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": self.summary.summarize(python_plan),
            "js": self.summary.summarize(js_plan),
        }

    def _read_js_plan(self) -> dict[str, Any]:
        with self.js_plan_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}

    def _mismatches(self, python_plan: dict[str, Any], js_plan: dict[str, Any]) -> list[dict[str, Any]]:
        mismatches: list[dict[str, Any]] = []
        if "mode" in js_plan and python_plan.get("mode") != js_plan.get("mode"):
            mismatches.append({"key": "mode", "python": python_plan.get("mode"), "js": js_plan.get("mode")})
        python_requests = python_plan.get("requests") if isinstance(python_plan.get("requests"), list) else []
        js_requests = js_plan.get("requests") if isinstance(js_plan.get("requests"), list) else []
        if "requests" in js_plan and len(python_requests) != len(js_requests):
            mismatches.append({"key": "requestCount", "python": len(python_requests), "js": len(js_requests)})
        for index, (python_request, js_request) in enumerate(zip(python_requests, js_requests)):
            if not isinstance(python_request, dict) or not isinstance(js_request, dict):
                continue
            for key in self.summary.REQUEST_KEYS:
                if key in js_request and python_request.get(key) != js_request.get(key):
                    mismatches.append({"key": f"requests[{index}].{key}", "python": python_request.get(key), "js": js_request.get(key)})
        return mismatches


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a Python-owned DeepSeek analyzer request plan from a JS-compatible JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to a JSON payload containing text/comments and optional keywordHints.")
    parser.add_argument("--compact", action="store_true", help="Build the compact retry prompt variant.")
    parser.add_argument("--compare-js-plan", default="", help="Optional JS-compatible DeepSeek plan JSON to compare.")
    args = parser.parse_args()
    if args.compare_js_plan:
        result = DeepSeekAnalysisPlanContractComparator(args.payload, args.compare_js_plan, compact=args.compact).compare()
    else:
        result = DeepSeekAnalysisPlanRunner(args.payload, compact=args.compact).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
