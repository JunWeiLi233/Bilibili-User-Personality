from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, JsonResultBytesContract, safe_read_json_object
from python_backend.scrapers.rate_limiter import RateLimitOptionsContract, RateLimitPolicy


class RateLimitOptionsRequest:
    """Build JS-compatible scraper pacing options from a JSON payload."""

    def __init__(self, payload_path: str | Path, target: str | None = None, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.target = target
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return RateLimitOptionsPayloadContractComparator(
                self.payload_path,
                self.compare_js_report_path,
                target=self.target,
            ).compare()
        return RateLimitOptionsRunner(self.payload_path, target=self.target).run()


class RateLimitOptionsRunner:
    """Run the rate-limit options JSON compatibility contract."""

    def __init__(self, payload_path: str | Path, target: str | None = None):
        self.payload_path = Path(payload_path)
        self.target = target

    def run(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        payload = payload if isinstance(payload, dict) else {}
        target = str(self.target or payload.get("target") or payload.get("source") or "").strip().lower().replace("_", "-")
        policy = RateLimitPolicy.from_payload(payload)
        return {
            "ok": True,
            "mode": "rate-limit-options",
            "target": target,
            "options": RateLimitOptionsContract(policy).options_for(target),
        }


class RateLimitOptionsSummary:
    """Shape rate-limit option results into the JS/Python comparator summary contract."""

    RESULT_KEYS = ("mode", "target", "options")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class RateLimitOptionsContractComparator:
    """Compare rate-limit option results using the JS/Python summary contract."""

    def __init__(self, summary: RateLimitOptionsSummary | None = None):
        self.summary = summary or RateLimitOptionsSummary()

    def compare(self, python_result: dict[str, Any], js_result: dict[str, Any]) -> dict[str, Any]:
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


class RateLimitOptionsPayloadContractComparator:
    """Compare Python rate-limit options against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path, target: str | None = None):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.target = target
        self.comparator = RateLimitOptionsContractComparator()

    def compare(self) -> dict[str, Any]:
        python_result = RateLimitOptionsRunner(self.payload_path, target=self.target).run()
        js_result = safe_read_json_object(self.js_report_path)
        return self.comparator.compare(python_result, js_result)


class RateLimitOptionsCliRunner:
    """Argv-based rate-limit options contract runner."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return RateLimitOptionsRequest(
            args.payload,
            target=args.target or None,
            compare_js_report_path=args.compare_js_report or None,
        ).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build JS-compatible scraper rate-limit options from a JSON payload.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--target", default="")
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible rate-limit option report to compare.")
        return parser


def main(argv: list[str] | None = None) -> int:
    result = RateLimitOptionsCliRunner(argv).run()
    return JsonResultBytesContract(result).run_text(sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
