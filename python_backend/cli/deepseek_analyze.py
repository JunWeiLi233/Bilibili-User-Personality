from __future__ import annotations

import argparse
import json
import sys

from python_backend.analyzers.deepseek_cli import DeepSeekAnalyzeCommandRequest


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekAnalyzeCommandRequest.parser()


class DeepSeekAnalyzeCliRunner(DeepSeekAnalyzeCommandRequest):
    """CLI-compatible Python DeepSeek analyze command runner."""


def should_read_stdin(argv: list[str] | None = None) -> bool:
    args = list(sys.argv[1:] if argv is None else argv)
    if any(arg in ("--help", "-h") for arg in args):
        return False
    if "--plan-json" in args:
        return False
    for index, arg in enumerate(args):
        if arg.startswith("--text=") or arg.startswith("--file="):
            return False
        if arg in ("--text", "--file") and index + 1 < len(args):
            return False
    return not sys.stdin.isatty()


def main(argv: list[str] | None = None) -> int:
    stdin_is_tty = sys.stdin.isatty()
    stdin_text = sys.stdin.read() if should_read_stdin(argv) else ""
    result = DeepSeekAnalyzeCliRunner(argv, stdin_text=stdin_text, stdin_is_tty=stdin_is_tty).run()
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
