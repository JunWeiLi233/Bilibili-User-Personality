from __future__ import annotations

import argparse

from python_backend.analyzers.deepseek_config import DeepSeekConfigCommandRequest, main as deepseek_config_main


def build_parser() -> argparse.ArgumentParser:
    return DeepSeekConfigCommandRequest.parser()


class DeepSeekConfigCliRunner(DeepSeekConfigCommandRequest):
    """CLI-compatible DeepSeek config/status contract runner."""


def main(argv: list[str] | None = None) -> int:
    return deepseek_config_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
