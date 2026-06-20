from __future__ import annotations

from typing import Any


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
