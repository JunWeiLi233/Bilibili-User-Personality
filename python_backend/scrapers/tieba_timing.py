from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _js_number(value: Any) -> float:
    if value is None or value == "":
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


class TiebaScrapeTiming:
    """Compute Tieba scraper timing budgets using the JS scrape-run contract."""

    def compute_hard_stop_ms(self, options: dict[str, Any] | None = None) -> int:
        options = options or {}
        max_queries = max(1, _js_number(options.get("maxQueries")) or 1)
        overall_timeout_ms = max(0, _js_number(options.get("overallTimeoutMs")) or 0)
        block_cooldown_ms = max(0, _js_number(options.get("blockCooldownMs")) or 0)
        hard_stop = max((overall_timeout_ms + block_cooldown_ms) * max_queries + 10000, overall_timeout_ms + 10000)
        return int(hard_stop)


class TiebaTimingRunner:
    """Compute Tieba scrape timing budgets from a JSON payload."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.timing = TiebaScrapeTiming()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        return {
            "ok": True,
            "hardStopMs": self.timing.compute_hard_stop_ms(payload),
        }

    def _read_payload(self) -> dict[str, Any]:
        with self.payload_path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class TiebaTimingContractComparator:
    """Compare Python Tieba timing budgets against a saved JS-compatible result."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.timing = TiebaScrapeTiming()

    def compare(self) -> dict[str, Any]:
        payload = self._read_json(self.payload_path)
        python_result = {"hardStopMs": self.timing.compute_hard_stop_ms(payload)}
        js_result = self._read_json(self.js_report_path)
        mismatches = []
        if "hardStopMs" in js_result and python_result["hardStopMs"] != js_result.get("hardStopMs"):
            mismatches.append({"key": "hardStopMs", "python": python_result["hardStopMs"], "js": js_result.get("hardStopMs")})
        return {
            "ok": not mismatches,
            "mismatches": mismatches,
            "python": python_result,
            "js": {"hardStopMs": js_result.get("hardStopMs")},
        }

    def _read_json(self, path: Path) -> dict[str, Any]:
        with path.open("r", encoding="utf-8-sig") as handle:
            payload = json.load(handle)
        return payload if isinstance(payload, dict) else {}


class TiebaTimingRequest:
    """Scraper-layer request object for Tieba timing JSON contract modes."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return TiebaTimingContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return TiebaTimingRunner(self.payload_path).run()
