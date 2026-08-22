"""
Centralized DeepSeek model router — single source of truth for model selection.

Task-based routing:
  think / plan / train / complex / generate / reasoning → deepseek-v4-pro
  analyze / implement / harvest / light / annotate / eval / coverage → deepseek-v4-flash

Override chain (highest priority first):
  1. Explicit model passed by caller
  2. Task-specific env var (e.g. BILIBILI_HARVEST_MODEL for harvest tasks)
  3. DEEPSEEK_MODEL env var
  4. Task-category default (pro / flash)

Usage:
  from python_backend.analyzers.deepseek_router import resolve_model, MODELS, V4_MODELS
  model = resolve_model("harvest")
"""

from __future__ import annotations

import os
from typing import Any

# ── Model constants ──────────────────────────────────────────────────────────

MODELS = {
    "V4_FLASH": "deepseek-v4-flash",
    "V4_PRO": "deepseek-v4-pro",
}

V4_MODELS = [MODELS["V4_FLASH"], MODELS["V4_PRO"]]

# ── Task categories ──────────────────────────────────────────────────────────

_PRO_TASKS = frozenset({
    "think",
    "plan",
    "train",
    "complex",
    "generate",
    "reasoning",
})

_FLASH_TASKS = frozenset({
    "analyze",
    "implement",
    "harvest",
    "light",
    "annotate",
    "eval",
    "coverage",
    "disambiguate",
    "relation",
    "classify",
})

# ── Task-specific env overrides ──────────────────────────────────────────────

_TASK_ENV_OVERRIDES = {
    "harvest": "BILIBILI_HARVEST_MODEL",
    "annotate": "DEEPSEEK_ANNOTATION_MODEL",
}


def resolve_model(task: str = "analyze", model: str | None = None, env: dict[str, Any] | None = None) -> str:
    """Resolve the DeepSeek model for a given task category.

    Args:
        task: Task category (harvest, annotate, generate, train, etc.)
        model: Explicit model override (highest priority)
        env: Environment dict (defaults to os.environ)

    Returns:
        The resolved model name
    """
    # 1. Explicit caller override
    if model:
        return model

    resolved_env = dict(os.environ) if env is None else dict(env)

    # 2. Task-specific env var
    task_env_var = _TASK_ENV_OVERRIDES.get(task)
    if task_env_var:
        value = resolved_env.get(task_env_var)
        if value:
            return value

    # 3. Global DEEPSEEK_MODEL env var
    global_model = resolved_env.get("DEEPSEEK_MODEL")
    if global_model:
        return global_model

    # 4. Task-category default
    if task in _PRO_TASKS:
        return MODELS["V4_PRO"]
    return MODELS["V4_FLASH"]


def resolve_reasoning_effort(
    task: str = "analyze",
    effort: str | None = None,
    env: dict[str, Any] | None = None,
) -> str:
    """Resolve the reasoning effort for a given task.

    Args:
        task: Task category
        effort: Explicit effort override
        env: Environment dict (defaults to os.environ)

    Returns:
        'max', 'high', 'medium', or 'low'
    """
    if effort:
        return effort

    resolved_env = dict(os.environ) if env is None else dict(env)

    # Task-specific effort env var
    if task == "harvest":
        value = resolved_env.get("BILIBILI_HARVEST_REASONING_EFFORT")
        if value:
            return value
    if task == "annotate":
        value = resolved_env.get("DEEPSEEK_ANNOTATION_EFFORT")
        if value:
            return value

    # Global effort env var
    global_effort = resolved_env.get("DEEPSEEK_REASONING_EFFORT")
    if global_effort:
        return global_effort

    # Pro tasks default to high reasoning, flash tasks to max
    if task in _PRO_TASKS:
        return "high"
    return "max"


def select_best_model(configured_model: str, available_models: list[str]) -> str:
    """Select the best available model from a list, preferring the configured model.

    Used by config/status endpoints that have a live model list from the API.
    """
    if configured_model in available_models:
        return configured_model
    if MODELS["V4_PRO"] in available_models:
        return MODELS["V4_PRO"]
    if MODELS["V4_FLASH"] in available_models:
        return MODELS["V4_FLASH"]
    return configured_model


def downgrade_to_flash(_current_model: str = "") -> str:
    """Downgrade pro → flash for tasks that don't need reasoning."""
    return MODELS["V4_FLASH"]
