"""Lightweight comment scenario classifier for Chinese polysemy disambiguation.

Python contract for server/services/contextClassifier.js.
Classifies short Chinese social-media comments into one of 6 scenarios
using fast regex/heuristic rules. No ML, no embeddings — deterministic
and runs in microseconds.

Used by the context-weighted sense disambiguation layer (Phase 4) to bias
which sense of a polysemous term is more likely given the comment's tone.
"""

import re

SCENARIOS = [
    "taunting",
    "argument",
    "praise",
    "neutral_info",
    "reassurance",
    "self_deprecation",
]

# ── scenario signal lexicons ──

SIGNALS = {
    "taunting": {
        "strong": [
            re.compile(r"哈哈哈+"),
            re.compile(r"笑死[我了]?"),
            re.compile(r"乐死"),
            re.compile(r"典中典"),
            re.compile(r"急了急了"),
            re.compile(r"破防了"),
            re.compile(r"不会吧不会吧"),
            re.compile(r"就这\?"),
            re.compile(r"不会真的?有人"),
            re.compile(r"[🤣😂😅😏🙃]"),
        ],
        "weak": [
            re.compile(r"[你您][真可]?行"),
            re.compile(r"[真可]?牛[逼批啤]?"),
            re.compile(r"赢[麻嘛]了"),
            re.compile(r"不愧是你"),
            re.compile(r"你说得对"),  # often sarcastic in context
            re.compile(r"确实[是]?[的]?$"),
        ],
    },
    "argument": {
        "strong": [
            re.compile(r"证据"),
            re.compile(r"数据"),
            re.compile(r"来源"),
            re.compile(r"事实"),
            re.compile(r"逻辑"),
            re.compile(r"反驳"),
            re.compile(r"你[错誤]了"),
            re.compile(r"[并絕]非"),
            re.compile(r"不是[这那]?[样么]?"),
            re.compile(r"请[问請]"),
        ],
        "weak": [
            re.compile(r"因为"),
            re.compile(r"所以"),
            re.compile(r"但是"),
            re.compile(r"然而"),
            re.compile(r"根据"),
            re.compile(r"[认为為][为為]"),
            re.compile(r"实际上"),
            re.compile(r"客观上"),
        ],
    },
    "praise": {
        "strong": [
            re.compile(r"[强牛][啊呀]?$", re.MULTILINE),
            re.compile(r"厉害"),
            re.compile(r"太[强棒牛]了"),
            re.compile(r"牛逼"),
            re.compile(r"[真太]?[好棒赞]"),
            re.compile(r"[👍👏🔥💯]"),
            re.compile(r"支持"),
            re.compile(r"加油"),
            re.compile(r"666"),
        ],
        "weak": [
            re.compile(r"不错"),
            re.compile(r"可以[啊呀]?"),
            re.compile(r"爱了"),
            re.compile(r"喜欢"),
            re.compile(r"学到了"),
            re.compile(r"感谢"),
            re.compile(r"谢谢"),
        ],
    },
    "reassurance": {
        "strong": [
            re.compile(r"别[急慌担心]"),
            re.compile(r"慢慢[来]?"),
            re.compile(r"不[急赶]"),
            re.compile(r"没[事关]系?"),
            re.compile(r"冷静"),
            re.compile(r"放心"),
            re.compile(r"马上[就到]"),
            re.compile(r"等[一等会]"),
        ],
        "weak": [
            re.compile(r"可以的"),
            re.compile(r"没事"),
            re.compile(r"还好"),
            re.compile(r"正常"),
            re.compile(r"理解"),
            re.compile(r"确实[会能]"),
        ],
    },
    "self_deprecation": {
        "strong": [
            re.compile(r"我[也真]?[是菜垃圾废弱]"),
            re.compile(r"[我咱][就也]是[一个]?菜"),
            re.compile(r"我自己[都]?[菜垃圾]"),
            re.compile(r"菜[是就][我真]"),
            re.compile(r"[我真]?太菜了"),
            re.compile(r"[我]?不行"),
            re.compile(r"我[不]?配"),
        ],
        "weak": [
            re.compile(r"我[还也]?[需还]要?学"),
            re.compile(r"萌新"),
            re.compile(r"新手"),
            re.compile(r"小白"),
            re.compile(r"我不懂"),
            re.compile(r"我[只就]会"),
        ],
    },
    "neutral_info": {
        "strong": [
            re.compile(r"^https?://"),
            re.compile(r"[bB][vV]\w{8,}"),
            re.compile(r"[aA][vV]\d+"),
            re.compile(r"第[一二三四五六七八九十\d]+[集期课章]"),
        ],
        "weak": [
            re.compile(r"这个[是就]"),
            re.compile(r"[这那]是"),
            re.compile(r"叫做"),
            re.compile(r"定义"),
            re.compile(r"指的是"),
            re.compile(r"根据.*?规定"),
        ],
    },
}


def classify_scenario(text: str) -> dict:
    """Classify a comment into the most likely scenario.

    Args:
        text: comment text

    Returns:
        dict with keys: scenario (str), confidence (float 0..1), scores (dict)
    """
    clean = str(text or "").strip()
    if not clean:
        return {"scenario": "neutral_info", "confidence": 0, "scores": {}}

    scores = {}
    for scenario in SCENARIOS:
        sig = SIGNALS.get(scenario, {"strong": [], "weak": []})
        score = 0

        for pattern in sig.get("strong", []):
            if pattern.search(clean):
                score += 3
        for pattern in sig.get("weak", []):
            if pattern.search(clean):
                score += 1

        scores[scenario] = score

    # Pick the scenario with the highest score
    best_scenario = "neutral_info"
    best_score = scores.get("neutral_info", 0)

    for scenario, score in scores.items():
        if score > best_score:
            best_score = score
            best_scenario = scenario

    # Confidence: 0 if no signals, scales with signal density
    total_score = sum(scores.values())
    confidence = (
        min(1.0, best_score / max(total_score, 1)) if total_score > 0 else 0
    )

    return {
        "scenario": best_scenario,
        "confidence": round(confidence, 2),
        "scores": scores,
    }


def scenario_score(text: str, scenario: str) -> float:
    """Score how well a comment matches a specific scenario.

    Args:
        text: comment text
        scenario: one of the SCENARIOS values

    Returns:
        0..1 confidence for the given scenario
    """
    result = classify_scenario(text)
    if result["scenario"] == scenario:
        return result["confidence"]
    return 0.0


def scenario_match_bonus(comment_text: str, sense_scenario: str | None) -> float:
    """Get the scenario score boost for a sense's scenario match.

    Used by disambiguation: if the comment's classified scenario matches
    the sense's declared scenario, return a bonus (0..0.08).

    Args:
        comment_text: the comment text
        sense_scenario: from sense.scenario

    Returns:
        bonus multiplier (0 to 0.08)
    """
    if not sense_scenario:
        return 0.0
    result = classify_scenario(comment_text)
    if result["scenario"] == sense_scenario and result["confidence"] > 0:
        return 0.08 * result["confidence"]
    return 0.0
