from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from python_backend.runtime.json_contracts import JsonContractReader, JsonResultBytesContract
from python_backend.scrapers.rate_limiter import RateLimitOptionsContract, RateLimitPolicy


class RateLimitOptionsRequest:
    """Build JS-compatible scraper pacing options from a JSON payload."""

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


class RateLimitOptionsCliRunner:
    """Argv-based rate-limit options contract runner."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return RateLimitOptionsRequest(args.payload, target=args.target or None).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build JS-compatible scraper rate-limit options from a JSON payload.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--target", default="")
        return parser


def main(argv: list[str] | None = None) -> int:
    result = RateLimitOptionsCliRunner(argv).run()
    return JsonResultBytesContract(result).run_text(sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
