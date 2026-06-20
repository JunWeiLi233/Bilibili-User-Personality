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
