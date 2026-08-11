"""Unit tests for python_backend.analyzers.deepseek_router.

Mirrors the JS deepseekRouter tests so JS/Python parity (AGENTS.md §6) is
enforced for the centralized model/effort resolution. Pure functions only —
an explicit ``env`` dict is passed everywhere so the real os.environ is never
mutated.
"""

from __future__ import annotations

import unittest

from python_backend.analyzers.deepseek_router import (
    MODELS,
    V4_MODELS,
    downgrade_to_flash,
    resolve_model,
    resolve_reasoning_effort,
    select_best_model,
)


class TestResolveModel(unittest.TestCase):
    def test_explicit_model_wins_over_everything(self):
        env = {"DEEPSEEK_MODEL": "env-global", "BILIBILI_HARVEST_MODEL": "env-harvest"}
        self.assertEqual(resolve_model("harvest", model="caller-model", env=env), "caller-model")

    def test_task_specific_env_beats_global_env(self):
        env = {"DEEPSEEK_MODEL": "env-global", "BILIBILI_HARVEST_MODEL": "env-harvest"}
        self.assertEqual(resolve_model("harvest", env=env), "env-harvest")

    def test_annotate_task_uses_annotation_model_env(self):
        env = {"DEEPSEEK_MODEL": "env-global", "DEEPSEEK_ANNOTATION_MODEL": "env-annotate"}
        self.assertEqual(resolve_model("annotate", env=env), "env-annotate")

    def test_global_deepseek_model_applies_without_task_override(self):
        env = {"DEEPSEEK_MODEL": "env-global"}
        self.assertEqual(resolve_model("analyze", env=env), "env-global")
        self.assertEqual(resolve_model("harvest", env=env), "env-global")

    def test_pro_task_default_is_v4_pro(self):
        for task in ("think", "plan", "train", "generate", "reasoning"):
            with self.subTest(task=task):
                self.assertEqual(resolve_model(task, env={}), MODELS["V4_PRO"])

    def test_flash_task_and_unknown_default_is_v4_flash(self):
        for task in ("harvest", "analyze", "annotate", "coverage"):
            with self.subTest(task=task):
                self.assertEqual(resolve_model(task, env={}), MODELS["V4_FLASH"])
        self.assertEqual(resolve_model("totally-unknown-task", env={}), MODELS["V4_FLASH"])

    def test_defaults_task_to_analyze_when_none(self):
        self.assertEqual(resolve_model(env={}), MODELS["V4_FLASH"])

    def test_empty_task_specific_env_does_not_override(self):
        env = {"BILIBILI_HARVEST_MODEL": "", "DEEPSEEK_MODEL": "env-global"}
        self.assertEqual(resolve_model("harvest", env=env), "env-global")


class TestResolveReasoningEffort(unittest.TestCase):
    def test_explicit_effort_wins(self):
        env = {"BILIBILI_HARVEST_REASONING_EFFORT": "medium"}
        self.assertEqual(
            resolve_reasoning_effort("harvest", effort="low", env=env),
            "low",
        )

    def test_harvest_uses_harvest_effort_env(self):
        env = {"BILIBILI_HARVEST_REASONING_EFFORT": "low", "DEEPSEEK_REASONING_EFFORT": "high"}
        self.assertEqual(resolve_reasoning_effort("harvest", env=env), "low")

    def test_annotate_uses_annotation_effort_env(self):
        env = {"DEEPSEEK_ANNOTATION_EFFORT": "medium", "DEEPSEEK_REASONING_EFFORT": "high"}
        self.assertEqual(resolve_reasoning_effort("annotate", env=env), "medium")

    def test_global_effort_applies_for_other_tasks(self):
        env = {"DEEPSEEK_REASONING_EFFORT": "high"}
        self.assertEqual(resolve_reasoning_effort("analyze", env=env), "high")

    def test_pro_task_default_is_high(self):
        self.assertEqual(resolve_reasoning_effort("think", env={}), "high")
        self.assertEqual(resolve_reasoning_effort("generate", env={}), "high")

    def test_flash_task_default_is_max(self):
        self.assertEqual(resolve_reasoning_effort("analyze", env={}), "max")
        self.assertEqual(resolve_reasoning_effort("harvest", env={}), "max")

    def test_defaults_task_to_analyze_when_none(self):
        self.assertEqual(resolve_reasoning_effort(env={}), "max")


class TestSelectBestModel(unittest.TestCase):
    def test_returns_configured_when_available(self):
        self.assertEqual(
            select_best_model(MODELS["V4_PRO"], [MODELS["V4_FLASH"], MODELS["V4_PRO"]]),
            MODELS["V4_PRO"],
        )

    def test_falls_back_to_pro(self):
        self.assertEqual(
            select_best_model("custom-model", [MODELS["V4_PRO"], "other"]),
            MODELS["V4_PRO"],
        )

    def test_falls_back_to_flash(self):
        self.assertEqual(
            select_best_model("custom-model", [MODELS["V4_FLASH"], "other"]),
            MODELS["V4_FLASH"],
        )

    def test_returns_configured_when_nothing_recognized(self):
        self.assertEqual(select_best_model("custom-model", ["other1", "other2"]), "custom-model")

    def test_handles_empty_list(self):
        self.assertEqual(select_best_model("custom-model", []), "custom-model")


class TestDowngradeToFlash(unittest.TestCase):
    def test_always_returns_flash(self):
        self.assertEqual(downgrade_to_flash(MODELS["V4_PRO"]), MODELS["V4_FLASH"])
        self.assertEqual(downgrade_to_flash("anything"), MODELS["V4_FLASH"])
        self.assertEqual(downgrade_to_flash(""), MODELS["V4_FLASH"])


class TestConstants(unittest.TestCase):
    def test_models_holds_two_v4_names(self):
        self.assertEqual(MODELS["V4_FLASH"], "deepseek-v4-flash")
        self.assertEqual(MODELS["V4_PRO"], "deepseek-v4-pro")

    def test_v4_models_lists_both(self):
        self.assertEqual(V4_MODELS, ["deepseek-v4-flash", "deepseek-v4-pro"])


if __name__ == "__main__":
    unittest.main()
