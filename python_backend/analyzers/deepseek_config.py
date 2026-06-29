from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek_router import MODELS, V4_MODELS, select_best_model
from python_backend.runtime.json_contracts import JsonContractReader, JsonResultBytesContract, safe_read_json_object


# Backward-compat alias for code that imports DEEPSEEK_V4_MODELS from this module
DEEPSEEK_V4_MODELS = V4_MODELS
REASONING_EFFORTS = {"low", "medium", "high", "xhigh", "max"}


class DeepSeekConfigStatusBuilder:
    """Build the JS-compatible DeepSeek config/status payload without live network calls."""

    def __init__(
        self,
        *,
        env: dict[str, Any] | None = None,
        models: list[Any] | None = None,
        model_list_error: str | None = None,
    ):
        self.env = env if isinstance(env, dict) else {}
        self.models = models
        self.model_list_error = str(model_list_error or "")

    def build(self) -> dict[str, Any]:
        base_url = str(self.env.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/")
        configured_model = str(self.env.get("DEEPSEEK_MODEL") or MODELS["V4_PRO"])
        configured_effort = str(self.env.get("DEEPSEEK_REASONING_EFFORT") or "max").strip().lower()
        reasoning_effort = configured_effort if configured_effort in REASONING_EFFORTS else "max"
        api_key = str(self.env.get("DEEPSEEK_API_KEY") or "")

        if not api_key:
            return {
                "ok": False,
                "provider": "deepseek",
                "baseUrl": base_url,
                "model": configured_model,
                "reasoningEffort": reasoning_effort,
                "available": False,
                "keyConfigured": False,
                "models": list(V4_MODELS),
                "error": "DEEPSEEK_API_KEY is not configured.",
            }

        if self.model_list_error:
            return {
                "ok": True,
                "provider": "deepseek",
                "baseUrl": base_url,
                "model": configured_model,
                "configuredModel": configured_model,
                "reasoningEffort": reasoning_effort,
                "available": True,
                "keyConfigured": True,
                "models": list(V4_MODELS),
                "warning": f"Could not list models: {self.model_list_error}",
            }

        models = [str(model) for model in (self.models or []) if str(model or "")]
        model = select_best_model(configured_model, models)
        return {
            "ok": True,
            "provider": "deepseek",
            "baseUrl": base_url,
            "model": model,
            "configuredModel": configured_model,
            "reasoningEffort": reasoning_effort,
            "available": bool(model),
            "keyConfigured": True,
            "models": models,
        }


class DeepSeekConfigSummary:
    """Shape DeepSeek config payloads into the JS/Python comparator contract."""

    RESULT_KEYS = (
        "ok",
        "provider",
        "baseUrl",
        "model",
        "configuredModel",
        "reasoningEffort",
        "available",
        "keyConfigured",
        "models",
        "error",
        "warning",
    )

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result[key] for key in self.RESULT_KEYS if key in result}


class DeepSeekConfigContractComparator:
    """Compare DeepSeek config/status payloads using stable JS-compatible keys."""

    def __init__(self, summary: DeepSeekConfigSummary | None = None):
        self.summary = summary or DeepSeekConfigSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python = self.summary.summarize(python_result)
        js = self.summary.summarize(js_result)
        mismatches = [
            {"key": key, "python": python.get(key), "js": js.get(key)}
            for key in self.summary.RESULT_KEYS
            if key in js and python.get(key) != js.get(key)
        ]
        return {"ok": not mismatches, "mismatches": mismatches, "python": python, "js": js}


class DeepSeekConfigRunner:
    """Run DeepSeek config/status JSON contract fixtures from a payload file."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)

    def run(self) -> dict[str, Any]:
        payload = JsonContractReader().read_value(self.payload_path, {})
        payload = payload if isinstance(payload, dict) else {}
        return DeepSeekConfigStatusBuilder(
            env=payload.get("env") if isinstance(payload.get("env"), dict) else {},
            models=payload.get("models") if isinstance(payload.get("models"), list) else None,
            model_list_error=payload.get("modelListError"),
        ).build()


class DeepSeekConfigPayloadContractComparator:
    """Compare Python config/status output against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.comparator = DeepSeekConfigContractComparator()

    def compare(self) -> dict[str, Any]:
        return self.comparator.compare(DeepSeekConfigRunner(self.payload_path).run(), safe_read_json_object(self.js_report_path))


class DeepSeekConfigRequest:
    """Analyzer-layer request object for DeepSeek config/status JSON contracts."""

    def __init__(self, payload_path: str | Path, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return DeepSeekConfigPayloadContractComparator(self.payload_path, self.compare_js_report_path).compare()
        return DeepSeekConfigRunner(self.payload_path).run()


class DeepSeekConfigCommandRequest:
    """Argv parser for DeepSeek config/status JSON contract commands."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekConfigRequest(args.payload, compare_js_report_path=args.compare_js_report or None).run()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build a JS-compatible DeepSeek config/status payload.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="")
        return parser


def main(argv: list[str] | None = None) -> int:
    result = DeepSeekConfigCommandRequest(argv).run()
    JsonResultBytesContract(result).run_text(sys.stdout)
    return 0
