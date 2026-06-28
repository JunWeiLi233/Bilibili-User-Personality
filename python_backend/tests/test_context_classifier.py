"""Tests for context_classifier.py — keep in sync with JS contextClassifier.test.js."""

import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from analysis.context_classifier import (
    SCENARIOS,
    classify_scenario,
    scenario_score,
    scenario_match_bonus,
)


class TestScenarios(unittest.TestCase):
    """Scenario taxonomy tests."""

    def test_scenarios_length(self):
        self.assertEqual(len(SCENARIOS), 6)

    def test_scenarios_contains_all(self):
        for s in ["taunting", "argument", "praise", "neutral_info", "reassurance", "self_deprecation"]:
            self.assertIn(s, SCENARIOS)


class TestClassifyScenario(unittest.TestCase):
    """classify_scenario core tests."""

    def test_empty_text_returns_neutral(self):
        result = classify_scenario("")
        self.assertEqual(result["scenario"], "neutral_info")
        self.assertEqual(result["confidence"], 0)

    def test_detects_taunting(self):
        result = classify_scenario("你急了哈哈哈笑死我了")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["confidence"], 0)
        self.assertGreater(result["scores"]["taunting"], result["scores"]["neutral_info"])

    def test_detects_argument(self):
        result = classify_scenario("你的说法并非事实，没有证据支持")
        self.assertEqual(result["scenario"], "argument")
        self.assertGreater(result["scores"]["argument"], 0)

    def test_detects_praise(self):
        result = classify_scenario("太强了！操作真厉害👍")
        self.assertEqual(result["scenario"], "praise")
        self.assertGreater(result["scores"]["praise"], 0)

    def test_detects_reassurance(self):
        result = classify_scenario("别急，慢慢来，没事的")
        self.assertEqual(result["scenario"], "reassurance")
        self.assertGreater(result["scores"]["reassurance"], 0)

    def test_detects_self_deprecation(self):
        result = classify_scenario("我太菜了，就是个萌新")
        self.assertEqual(result["scenario"], "self_deprecation")
        self.assertGreater(result["scores"]["self_deprecation"], 0)

    def test_neutral_info_for_plain_statements(self):
        result = classify_scenario("这个视频讲的是如何配置服务器")
        self.assertEqual(result["scenario"], "neutral_info")

    def test_picks_strongest_signal(self):
        # "哈哈哈" (taunting strong=3) vs "不错" (praise weak=1)
        result = classify_scenario("哈哈哈不错")
        self.assertEqual(result["scenario"], "taunting")

    def test_confidence_range(self):
        empty = classify_scenario("")
        self.assertEqual(empty["confidence"], 0)

        clear = classify_scenario("你急了哈哈哈笑死我了")
        self.assertGreater(clear["confidence"], 0)
        self.assertLessEqual(clear["confidence"], 1)


class TestScenarioScore(unittest.TestCase):
    """scenario_score tests."""

    def test_returns_confidence_when_match(self):
        text = "太强了牛啊！"
        score = scenario_score(text, "praise")
        self.assertGreater(score, 0)

    def test_returns_zero_when_no_match(self):
        score = scenario_score("太强了牛啊！", "taunting")
        self.assertEqual(score, 0)


class TestScenarioMatchBonus(unittest.TestCase):
    """scenario_match_bonus tests."""

    def test_null_scenario_returns_zero(self):
        self.assertEqual(scenario_match_bonus("你急了哈哈哈", None), 0.0)

    def test_matching_scenario_positive(self):
        bonus = scenario_match_bonus("你急了哈哈哈笑死我了", "taunting")
        self.assertGreater(bonus, 0)
        self.assertLessEqual(bonus, 0.08)

    def test_non_matching_scenario_returns_zero(self):
        bonus = scenario_match_bonus("太强了牛啊", "taunting")
        self.assertEqual(bonus, 0.0)


# ── Step 1: Expanded taunting lexicon ──

class TestExpandedTaunting(unittest.TestCase):
    """Tests for expanded taunting signal patterns."""

    def test_blame_insult_x_laji(self):
        result = classify_scenario("就是程序员垃圾，没什么好说的")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["scores"]["taunting"], result["scores"]["argument"])

    def test_authority_blame_cehua(self):
        result = classify_scenario("都是策划的错，这种垃圾活动")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["scores"]["taunting"], result["scores"]["praise"])

    def test_dismissive_meme_jiuzhe(self):
        result = classify_scenario("就这也配拿出来说？")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["scores"]["taunting"], 0)

    def test_mockery_haoyisi(self):
        result = classify_scenario("你好意思说别人？")
        self.assertEqual(result["scenario"], "taunting")

    def test_accusation_shuaiguo(self):
        result = classify_scenario("为什么你每次都这么菜还喜欢甩锅")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["scores"]["taunting"], result["scores"]["praise"])

    def test_mild_negative_butaixing(self):
        result = classify_scenario("这个改动不太行，劝退了")
        self.assertGreater(result["scores"]["taunting"], 0)

    def test_exaggerated_mockery_tinghui(self):
        result = classify_scenario("你挺会甩锅的啊")
        self.assertEqual(result["scenario"], "taunting")

    def test_xidi_patterns(self):
        result = classify_scenario("别洗了，这波操作就是垃圾")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreaterEqual(result["scores"]["taunting"], 3)


# ── Step 2: Cross-scenario suppression ──

class TestCrossScenarioSuppression(unittest.TestCase):
    """Tests for cross-scenario suppression logic."""

    def test_strong_taunting_halves_praise(self):
        result = classify_scenario("这次更新肯定是在逼玩家氪金，策划垃圾")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["scores"]["taunting"], 0)

    def test_strong_taunting_weak_argument_taunting_wins(self):
        result = classify_scenario("不是傻就是蠢，你自己选一个")
        self.assertEqual(result["scenario"], "taunting")
        self.assertGreater(result["scores"]["taunting"], result["scores"]["argument"])

    def test_pure_argument_with_evidence_still_wins(self):
        result = classify_scenario("根据数据来看，这个结论缺乏逻辑支持")
        self.assertEqual(result["scenario"], "argument")
        self.assertGreater(result["scores"]["argument"], result["scores"]["taunting"])


# ── Step 3: Negation pre-filter ──

class TestNegationPreFilter(unittest.TestCase):
    """Tests for negation-aware scoring."""

    def test_bushi_positive_word_no_praise(self):
        result = classify_scenario("不是他傻，是策划真的有问题")
        self.assertEqual(result["scenario"], "taunting")

    def test_meiyou_scope_reduces_argument(self):
        result = classify_scenario("没有什么证据能支持这个说法")
        self.assertLessEqual(result["scores"]["argument"], 2)

    def test_budong_mockery_not_argument(self):
        result = classify_scenario("你根本不懂游戏机制")
        self.assertEqual(result["scenario"], "taunting")


# ── Step 4: Argument-vs-taunting tiebreaker ──

class TestTiebreaker(unittest.TestCase):
    """Tests for argument-vs-taunting tiebreaker."""

    def test_close_scores_taunting_wins(self):
        result = classify_scenario("但是因为你这波操作也挺搞笑")
        self.assertGreater(result["scores"]["taunting"], 0)
        self.assertGreater(result["scores"]["argument"], 0)
        self.assertEqual(result["scenario"], "taunting")


# ── Eval regression tests ──

class TestEvalRegression(unittest.TestCase):
    """Regression tests from plan examples."""

    def test_bushi_sha_jiushi_chun(self):
        result = classify_scenario("不是傻就是蠢，你自己选一个")
        self.assertEqual(result["scenario"], "taunting")

    def test_bug_programmer_toulan(self):
        result = classify_scenario("这个bug一定是程序员偷懒导致的")
        self.assertEqual(result["scenario"], "taunting")

    def test_xiaosi_lijie_nengli(self):
        result = classify_scenario("笑死，你这理解能力也就这样了")
        self.assertEqual(result["scenario"], "taunting")

    def test_gengxin_bi_kegin(self):
        result = classify_scenario("这次更新肯定是在逼玩家氪金")
        self.assertEqual(result["scenario"], "taunting")

    def test_weishenme_cai_shuaiguo(self):
        result = classify_scenario("为什么你每次都这么菜还喜欢甩锅")
        self.assertEqual(result["scenario"], "taunting")

    def test_chengxuyuan_laji(self):
        result = classify_scenario("就是程序员垃圾，没什么好说的")
        self.assertEqual(result["scenario"], "taunting")

    def test_cehua_cuo_laji(self):
        result = classify_scenario("都是策划的错，这种垃圾活动")
        self.assertEqual(result["scenario"], "taunting")


if __name__ == "__main__":
    unittest.main()
