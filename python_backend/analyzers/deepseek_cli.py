from __future__ import annotations

import argparse
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from python_backend.analyzers.deepseek import DeepSeekAnalysisNormalizer, DeepSeekAnalyzerClient
from python_backend.runtime.json_contracts import JsonContractReader, safe_read_json_object


class DeepSeekAnalyzeCliPlanner:
    """Build a dry-run plan for analyzeDeepSeekComments.js CLI input routing."""

    def build_plan(self, argv: list[Any], *, stdin_is_tty: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        file_path = ""
        show_help = False
        index = 0
        while index < len(argv):
            arg = str(argv[index] or "")
            if arg in ("--help", "-h"):
                show_help = True
            elif arg in ("--multiagent", "--multi-agent"):
                payload["multiagent"] = True
            elif arg.startswith("--text="):
                payload["text"] = arg[len("--text=") :]
            elif arg == "--text":
                payload["text"] = str(argv[index + 1] or "") if index + 1 < len(argv) else ""
                index += 1
            elif arg.startswith("--file="):
                file_path = arg[len("--file=") :]
            elif arg == "--file":
                file_path = str(argv[index + 1] or "") if index + 1 < len(argv) else ""
                index += 1
            elif arg.startswith("--uid="):
                payload["uid"] = arg[len("--uid=") :]
            elif arg == "--uid":
                payload["uid"] = str(argv[index + 1] or "") if index + 1 < len(argv) else ""
                index += 1
            elif arg.startswith("--name="):
                payload["name"] = arg[len("--name=") :]
            elif arg == "--name":
                payload["name"] = str(argv[index + 1] or "") if index + 1 < len(argv) else ""
                index += 1
            elif not arg.startswith("-"):
                payload["text"] = " ".join(item for item in (str(payload.get("text") or ""), arg) if item)
            index += 1
        reads_stdin = not show_help and not file_path and not payload.get("text") and not stdin_is_tty
        source = "help" if show_help else "file" if file_path else "stdin" if reads_stdin else "argv"
        return {
            "ok": True,
            "payload": payload,
            "input": {
                "source": source,
                "file": file_path,
                "readsStdin": reads_stdin,
                "showHelp": show_help,
            },
        }


class DeepSeekAnalyzeCliPlanSummary:
    """Shape DeepSeek analyze CLI plans into the JS/Python comparator contract."""

    RESULT_KEYS = ("payload", "input")

    def summarize(self, result: dict[str, Any] | None = None) -> dict[str, Any]:
        result = result if isinstance(result, dict) else {}
        return {key: result.get(key) for key in self.RESULT_KEYS if key in result}


class DeepSeekAnalyzeCliPlanContractComparator:
    """Compare DeepSeek analyze CLI plans using the JS/Python JSON contract."""

    def __init__(self, summary: DeepSeekAnalyzeCliPlanSummary | None = None):
        self.summary = summary or DeepSeekAnalyzeCliPlanSummary()

    def compare(self, python_result: dict[str, Any] | None, js_result: dict[str, Any] | None) -> dict[str, Any]:
        python_result = python_result if isinstance(python_result, dict) else {}
        js_result = js_result if isinstance(js_result, dict) else {}
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


class DeepSeekAnalyzeCliPlanRunner:
    """Read a JS-compatible deepseek:analyze CLI payload and emit its input plan."""

    def __init__(self, payload_path: str | Path):
        self.payload_path = Path(payload_path)
        self.planner = DeepSeekAnalyzeCliPlanner()

    def run(self) -> dict[str, Any]:
        payload = self._read_payload()
        argv = payload.get("argv") if isinstance(payload.get("argv"), list) else []
        stdin_is_tty = bool(payload.get("stdinIsTTY", True))
        return self.planner.build_plan(argv, stdin_is_tty=stdin_is_tty)

    def _read_payload(self) -> dict[str, Any]:
        return JsonContractReader().read_object(self.payload_path)


class DeepSeekAnalyzeCliPayloadPlanContractComparator:
    """Compare file-backed DeepSeek analyze CLI input plans against saved JS-compatible JSON."""

    def __init__(self, payload_path: str | Path, js_report_path: str | Path):
        self.payload_path = Path(payload_path)
        self.js_report_path = Path(js_report_path)
        self.summary = DeepSeekAnalyzeCliPlanSummary()
        self.comparator = DeepSeekAnalyzeCliPlanContractComparator(self.summary)

    def compare(self) -> dict[str, Any]:
        python_result = DeepSeekAnalyzeCliPlanRunner(self.payload_path).run()
        js_result = self._read_js_report()
        return self.comparator.compare(python_result, js_result)

    def _read_js_report(self) -> dict[str, Any]:
        return safe_read_json_object(self.js_report_path)


class DeepSeekAnalyzeCliPlanRequest:
    """Analyzer-layer request for DeepSeek analyze CLI plan contract commands."""

    def __init__(self, payload_path: str | Path, *, compare_js_report_path: str | Path | None = None):
        self.payload_path = Path(payload_path)
        self.compare_js_report_path = Path(compare_js_report_path) if compare_js_report_path else None

    def run(self) -> dict[str, Any]:
        if self.compare_js_report_path:
            return DeepSeekAnalyzeCliPayloadPlanContractComparator(
                self.payload_path,
                self.compare_js_report_path,
            ).compare()
        return DeepSeekAnalyzeCliPlanRunner(self.payload_path).run()


class DeepSeekAnalyzeCliPlanCommandRequest:
    """Parse CLI argv for analyzeDeepSeekComments plan contracts in the analyzer layer."""

    def __init__(self, argv: list[Any] | None = None):
        self.argv = argv

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Build an analyzeDeepSeekComments.js-compatible CLI input plan.")
        parser.add_argument("--payload", required=True)
        parser.add_argument("--compare-js-report", default="", help="Optional JS-compatible CLI parse report to compare.")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args([str(item) for item in self.argv] if self.argv is not None else None)
        return DeepSeekAnalyzeCliPlanRequest(
            args.payload,
            compare_js_report_path=args.compare_js_report or None,
        ).run()


class DeepSeekAnalyzeRuntime:
    """Execute the Python DeepSeek analyze chat runtime through an injectable transport."""

    def __init__(self, *, env: dict[str, Any] | None = None, transport: Any = None):
        self.env = dict(os.environ) if env is None else dict(env)
        self.transport = transport or self._http_transport
        self.client = DeepSeekAnalyzerClient()
        self.normalizer = DeepSeekAnalysisNormalizer()

    def run(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        request = self.client.build_request_from_payload(payload)
        config = self._config(request)
        if not config["apiKey"]:
            return {
                "ok": False,
                "provider": "deepseek",
                "model": config["model"],
                "reasoningEffort": config["reasoningEffort"],
                "error": "DEEPSEEK_API_KEY is not configured.",
            }
        if request.multiagent:
            return self._run_multiagent(payload, request, config)
        retried_compact_prompt = False
        request_body = self.client.build_chat_request(request)
        try:
            parsed = self.transport(request_body, config)
        except SyntaxError:
            retried_compact_prompt = True
            try:
                parsed = self.transport(self.client.build_chat_request(request, compact=True), config)
            except Exception as error:  # pragma: no cover - exercised through command-level failures.
                return {
                    "ok": False,
                    "provider": "deepseek",
                    "model": config["model"],
                    "reasoningEffort": config["reasoningEffort"],
                    "error": str(error),
                }
        except Exception as error:  # pragma: no cover - exercised through command-level failures.
            return {
                "ok": False,
                "provider": "deepseek",
                "model": config["model"],
                "reasoningEffort": config["reasoningEffort"],
                "error": str(error),
            }
        result = self.normalizer.normalize(
            source_payload=payload,
            analysis_payload=parsed,
            provider="deepseek",
            model=config["model"],
            reasoning_effort=config["reasoningEffort"],
            raw=self._json_text(parsed),
            retried_compact_prompt=retried_compact_prompt,
        )
        result["runtime"] = {"mode": "live_chat", "requestCount": 2 if retried_compact_prompt else 1, "multiagent": request.multiagent}
        return result

    def _run_multiagent(self, payload: dict[str, Any], request: Any, config: dict[str, str]) -> dict[str, Any]:
        try:
            agent_results, request_count, merged = self._run_multiagent_chat(request, config, compact=False)
            retried_compact_prompt = False
        except SyntaxError:
            retried_compact_prompt = True
            try:
                agent_results, request_count, merged = self._run_multiagent_chat(request, config, compact=True)
                request_count += 1
            except Exception as error:  # pragma: no cover - exercised through command-level failures.
                return {
                    "ok": False,
                    "provider": "deepseek",
                    "model": config["model"],
                    "reasoningEffort": config["reasoningEffort"],
                    "error": str(error),
                }
        except Exception as error:  # pragma: no cover - exercised through command-level failures.
            return {
                "ok": False,
                "provider": "deepseek",
                "model": config["model"],
                "reasoningEffort": config["reasoningEffort"],
                "error": str(error),
            }
        result = self.normalizer.normalize(
            source_payload=payload,
            analysis_payload=merged,
            provider="deepseek",
            model=config["model"],
            reasoning_effort=config["reasoningEffort"],
            raw=self._json_text(merged),
            retried_compact_prompt=retried_compact_prompt,
            multiagent={"agentCount": len(agent_results), "agents": agent_results},
        )
        result["runtime"] = {
            "mode": "live_multiagent",
            "requestCount": request_count,
            "multiagent": True,
        }
        return result

    def _run_multiagent_chat(self, request: Any, config: dict[str, str], *, compact: bool) -> tuple[list[dict[str, Any]], int, dict[str, Any]]:
        agent_results: list[dict[str, Any]] = []
        request_bodies = self.client.build_request_plan(request, compact=compact)
        for index, request_body in enumerate(request_bodies):
            parsed = self.transport(request_body, config)
            agent = self.client.MULTIAGENTS[index] if index < len(self.client.MULTIAGENTS) else {}
            agent_results.append(
                {
                    "id": agent.get("id", f"agent-{index + 1}"),
                    "name": agent.get("name", f"agent-{index + 1}"),
                    "ok": isinstance(parsed, dict) and not parsed.get("error"),
                    "parsed": parsed,
                }
            )
        merged = self.transport(self.client.build_merge_request(request, agent_results, compact=compact), config)
        return agent_results, len(request_bodies) + 1, merged

    def _config(self, request: Any) -> dict[str, str]:
        return {
            "baseUrl": str(self.env.get("DEEPSEEK_BASE_URL") or "https://api.deepseek.com").rstrip("/"),
            "apiKey": str(self.env.get("DEEPSEEK_API_KEY") or ""),
            "model": str(self.env.get("DEEPSEEK_MODEL") or request.model or "deepseek-v4-flash"),
            "reasoningEffort": str(self.env.get("DEEPSEEK_REASONING_EFFORT") or request.effort or "max").strip().lower() or "max",
        }

    def _http_transport(self, request_body: dict[str, Any], config: dict[str, str]) -> dict[str, Any]:
        data = self._json_text(request_body).encode("utf-8")
        request = urllib.request.Request(
            f"{config['baseUrl']}/chat/completions",
            data=data,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {config['apiKey']}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = JsonContractReader().read_text_value(response.read().decode("utf-8"), {})
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")[:200]
            raise RuntimeError(f"DeepSeek analyze failed with HTTP {error.code}: {body}") from error
        content = (
            payload.get("choices", [{}])[0].get("message", {}).get("content")
            if isinstance(payload.get("choices"), list)
            else ""
        )
        parsed = JsonContractReader().read_text_value(content, {})
        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def _json_text(value: Any) -> str:
        import json

        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class DeepSeekLiveValidationGate:
    """Report whether the live DeepSeek analyzer command gate can be validated."""

    def __init__(self, *, env: dict[str, Any] | None = None, transport: Any = None):
        self.env = dict(os.environ) if env is None else dict(env)
        self.runtime = DeepSeekAnalyzeRuntime(env=self.env, transport=transport)

    def run(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload if isinstance(payload, dict) else {}
        if not str(self.env.get("DEEPSEEK_API_KEY") or ""):
            return {
                "ok": True,
                "provider": "deepseek",
                "gate": "live_api_command",
                "status": "skipped",
                "reason": "DEEPSEEK_API_KEY is not configured.",
                "requires": ["DEEPSEEK_API_KEY"],
            }
        result = self.runtime.run(payload)
        return {
            "ok": bool(result.get("ok")),
            "provider": "deepseek",
            "gate": "live_api_command",
            "status": "covered" if result.get("ok") else "failed",
            "result": result,
        }


class DeepSeekAnalyzeCommandRequest:
    """Run Python-owned analyzeDeepSeekComments-compatible command modes."""

    def __init__(
        self,
        argv: list[Any] | None = None,
        *,
        stdin_text: str = "",
        stdin_is_tty: bool | None = None,
        env: dict[str, Any] | None = None,
        runtime_factory: Any = None,
    ):
        self.argv = [str(item) for item in argv] if argv is not None else None
        self.stdin_text = str(stdin_text or "")
        self.stdin_is_tty = bool(stdin_is_tty) if stdin_is_tty is not None else not bool(self.stdin_text)
        self.env = dict(os.environ) if env is None else dict(env)
        self.runtime_factory = runtime_factory or DeepSeekAnalyzeRuntime
        self.normalizer = DeepSeekAnalysisNormalizer()

    @staticmethod
    def parser() -> argparse.ArgumentParser:
        parser = argparse.ArgumentParser(description="Analyze comments with the Python DeepSeek analyzer command contract.")
        parser.add_argument("--plan-json", action="store_true", help="Emit the CLI input plan JSON contract without analyzing.")
        parser.add_argument("--live-validation-gate", action="store_true", help="Emit the live DeepSeek API validation-gate JSON contract.")
        parser.add_argument("--python-plan", action="store_true", help=argparse.SUPPRESS)
        parser.add_argument("--js-plan", action="store_true", help=argparse.SUPPRESS)
        parser.add_argument("--python-runtime", action="store_true", help=argparse.SUPPRESS)
        parser.add_argument("--js-runtime", action="store_true", help=argparse.SUPPRESS)
        parser.add_argument("--python-fixture", action="store_true", help=argparse.SUPPRESS)
        parser.add_argument("--js-fixture", action="store_true", help=argparse.SUPPRESS)
        parser.add_argument("--text", default="")
        parser.add_argument("--file", default="")
        parser.add_argument("--uid", default="")
        parser.add_argument("--name", default="")
        parser.add_argument("--multiagent", "--multi-agent", action="store_true", dest="multiagent")
        parser.add_argument("--fixture-analysis", default="")
        parser.add_argument("--mock-chat-analysis", default="", help="Read a local analysis JSON after building the chat request contract.")
        parser.add_argument("text_fragments", nargs="*")
        return parser

    def run(self) -> dict[str, Any]:
        args = self.parser().parse_args(self._normalize_argv(self.argv))
        legacy_selector = self._legacy_js_selector(args)
        if args.plan_json:
            return self._with_legacy_selector_compatibility(
                DeepSeekAnalyzeCliPlanner().build_plan(self._normalize_argv(self.argv) or [], stdin_is_tty=self.stdin_is_tty),
                legacy_selector,
            )
        payload = self._payload(args)
        payload_error = payload.pop("_error", None)
        if isinstance(payload_error, dict):
            return self._with_legacy_selector_compatibility(payload_error, legacy_selector)
        if args.live_validation_gate:
            return self._with_legacy_selector_compatibility(DeepSeekLiveValidationGate(env=self.env).run(payload), legacy_selector)
        if args.mock_chat_analysis:
            return self._with_legacy_selector_compatibility(self._run_mock_chat(payload, args.mock_chat_analysis), legacy_selector)
        if args.fixture_analysis:
            analysis = JsonContractReader().read_object(args.fixture_analysis)
            return self._with_legacy_selector_compatibility(
                self.normalizer.normalize(
                    source_payload=payload,
                    analysis_payload=analysis,
                    provider="deepseek",
                    model="deepseek-v4-flash",
                    reasoning_effort="max",
                    raw=self._json_text(analysis),
                ),
                legacy_selector,
            )
        return self._with_legacy_selector_compatibility({**self.runtime_factory(env=self.env).run(payload)}, legacy_selector)

    @staticmethod
    def _legacy_js_selector(args: argparse.Namespace) -> str:
        if bool(getattr(args, "js_plan", False)):
            return "js_plan"
        if bool(getattr(args, "js_fixture", False)):
            return "js_fixture"
        if bool(getattr(args, "js_runtime", False)):
            return "js_runtime"
        return ""

    @staticmethod
    def _with_legacy_selector_compatibility(result: dict[str, Any], selector: str) -> dict[str, Any]:
        if not selector:
            return result
        return {
            **result,
            "compatibility": {
                "legacyJsSelector": selector,
                "behavior": "ignored_python_equivalent",
                "reason": "Python command cannot execute legacy JS fallback internals; the equivalent Python contract path was used.",
            },
        }

    def _run_mock_chat(self, payload: dict[str, Any], analysis_path: str | Path) -> dict[str, Any]:
        client = DeepSeekAnalyzerClient()
        request = client.build_request_from_payload(payload)
        requests = client.build_request_plan(request)
        analysis = JsonContractReader().read_object(analysis_path)
        result = self.normalizer.normalize(
            source_payload=payload,
            analysis_payload=analysis,
            provider="deepseek",
            model=request.model,
            reasoning_effort=request.effort,
            raw=self._json_text(analysis.get("parsed") if isinstance(analysis.get("parsed"), dict) else analysis),
        )
        result["runtime"] = {
            "mode": "mock_chat",
            "requestCount": len(requests),
            "multiagent": request.multiagent,
        }
        if request.multiagent:
            result["multiagent"] = {
                "enabled": True,
                "mergeAgent": "quality-merge",
                "agents": [
                    {"id": str(agent.get("id") or ""), "name": str(agent.get("name") or ""), "ok": True}
                    for agent in client.MULTIAGENTS
                ],
            }
        return result

    def _payload(self, args: argparse.Namespace) -> dict[str, Any]:
        payload: dict[str, Any] = {}
        text = str(args.text or "")
        positional_text = " ".join(str(item) for item in getattr(args, "text_fragments", []) if str(item))
        if positional_text:
            text = " ".join(item for item in (text, positional_text) if item)
        if args.file:
            try:
                text = Path(args.file).read_text(encoding="utf-8-sig")
            except OSError:
                payload["_error"] = {
                    "ok": False,
                    "provider": "deepseek",
                    "error": f"Could not read input file: {args.file}",
                }
                return payload
        if not args.file and not text and self.stdin_text:
            text = self.stdin_text
        if text:
            payload["text"] = text
        if args.uid:
            payload["uid"] = str(args.uid)
        if args.name:
            payload["name"] = str(args.name)
        if args.multiagent:
            payload["multiagent"] = True
        return payload

    @staticmethod
    def _normalize_argv(argv: list[str] | None) -> list[str] | None:
        if argv is None:
            return None
        normalized: list[str] = []
        index = 0
        value_options = {"--text", "--file", "--uid", "--name", "--fixture-analysis", "--mock-chat-analysis"}
        while index < len(argv):
            arg = str(argv[index])
            if arg in value_options and index + 1 < len(argv):
                normalized.extend([arg, str(argv[index + 1])])
                index += 2
                continue
            normalized.append("--multiagent" if arg == "--multi-agent" else arg)
            index += 1
        return normalized

    @staticmethod
    def _json_text(value: Any) -> str:
        import json

        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
