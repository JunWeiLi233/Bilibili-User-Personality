from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek import AnalyzerRequest, DeepSeekAnalyzerClient


class DeepSeekAnalysisPlanRunner:
    """Emit Python-built DeepSeek analyzer request plans for JS orchestration."""

    def __init__(self, payload_path: str | Path, compact: bool = False):
        self.payload_path = Path(payload_path)
        self.compact = compact
        self.client = DeepSeekAnalyzerClient()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        request = self._request_from_payload(payload)
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

    def _request_from_payload(self, payload: dict[str, Any]) -> AnalyzerRequest:
        comments = self._comments_from_payload(payload)
        return AnalyzerRequest(
            comments=comments,
            keyword_hints=list(payload.get("keywordHints") or payload.get("keyword_hints") or []),
            uid=str(payload.get("uid") or "unknown"),
            name=str(payload.get("name") or "unknown"),
            model=str(payload.get("model") or "deepseek-v4-flash"),
            effort=str(payload.get("reasoningEffort") or payload.get("reasoning_effort") or payload.get("effort") or "max"),
            multiagent=bool(payload.get("multiagent") or payload.get("multiAgent")),
        )

    def _comments_from_payload(self, payload: dict[str, Any]) -> list[str]:
        if isinstance(payload.get("comments"), list):
            return [str(item) for item in payload["comments"] if str(item).strip()]
        text = str(payload.get("text") or payload.get("fullText") or "").strip()
        return [text] if text else []


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a Python-owned DeepSeek analyzer request plan from a JS-compatible JSON payload.")
    parser.add_argument("--payload", required=True, help="Path to a JSON payload containing text/comments and optional keywordHints.")
    parser.add_argument("--compact", action="store_true", help="Build the compact retry prompt variant.")
    args = parser.parse_args()
    result = DeepSeekAnalysisPlanRunner(args.payload, compact=args.compact).run()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
