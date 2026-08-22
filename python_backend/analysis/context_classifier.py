"""Lightweight comment scenario classifier for Chinese polysemy disambiguation.

Python contract for server/services/contextClassifier.js.
Classifies short Chinese social-media comments into one of 6 scenarios
using fast regex/heuristic rules. No ML, no embeddings — deterministic
and runs in microseconds.

Used by the context-weighted sense disambiguation layer (Phase 4) to bias
which sense of a polysemous term is more likely given the comment's tone.

Keep in sync with server/services/contextClassifier.js.
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
            # Existing
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
            # NEW: Blame and accusation patterns
            re.compile(r"[你他她它这那].{0,4}(?:垃圾|废物|脑残|智障|sb|SB|傻逼|傻叉)"),
            # Standalone insults
            re.compile(r"[真就是]?(?:傻|蠢|笨)(?:[逼叉瓜蛋子了]|[得要]?很|[得要]?命|透了|[得]?要?死)?"),
            re.compile(r"(?:^|[\s，。！？…、]|[这那就]是)(?:垃圾|废物|脑残|智障|傻逼|傻叉)"),
            # Authority blame
            re.compile(r"(?:策划|官方|运营|资本|节目组|程序员).{0,4}(?:傻|蠢|笨|垃圾|恶心|离谱|脑残|不要脸|偷懒|敷衍|划水|摸鱼)"),
            re.compile(r"(?:的错|的问题|害的|搞的|干的|弄的)[!！。？…]*$"),
            # Dismissive memes and mockery
            re.compile(r"[你他她]?.{0,2}(?:配吗|也配|就这|急了|绷不住了|孝了|典了)"),
            re.compile(r"(?:别[扯洗]|[在硬]?洗[地白了]?|硬洗|尬吹|无脑吹)"),
            re.compile(r"(?:甩锅|背锅|扣帽子|双标|道德绑架)"),
            # Exaggerated mockery
            re.compile(r"[你他她]?(?:真[有会]?意思|可真?行|挺会|好一个|好意思)"),
            re.compile(r"(?:[你他她]|这[也真]|[那也]?).{0,4}(?:不懂|不会|不能|不行|不好|不对|错了)"),
            # Coercion/force patterns
            re.compile(r"(?:逼[着迫]?|强迫|强制|硬[是要]?[逼要]?).{0,6}(?:氪[金]?|花钱|付费|充[值钱]|买|掏钱)"),
            # Blame attribution
            re.compile(r"(?:肯定|一定|明显|摆明了|分明|绝对|[这那]就).{0,6}(?:在|是).{0,6}(?:逼|骗|坑|害|搞|弄|偷懒|敷衍|划水|摸鱼)"),
            # Laziness/negligence
            re.compile(r"(?:偷懒|偷工减料|敷衍[了]?事|糊弄|应付|划水|摸鱼)"),
            re.compile(r"(?:瞎[搞改弄整写做说扯]|乱[搞改弄整写做说扯])"),
            # Hyperbolic mockery and slang (polysemy-02)
            re.compile(r"(?:割韭菜|智商税|骗钱[的]?玩意|忽悠人|圈钱|坑钱|坑爹)"),
            re.compile(r"(?:带节奏|水军|杠精|喷子|键盘侠|孝子[贤孙]?)"),
            re.compile(r"没[有]?.{0,6}(?:脑血栓|脑子|智商|脑[子子]?).{0,6}(?:想[不]?出|干[得]?出|做[得]?出)"),
            re.compile(r"(?:不配|也配)[^，。！？…]{0,4}(?:玩|做|说|评论|评价|当|当人)"),
            re.compile(r"(?:恶心[人]?|不要脸|没良心|没安好心|居心不良)"),
            re.compile(r"(?:脑子进水|脑子有[病坑问题]|没脑子|不长脑子|不长[点心眼]|缺心眼)"),
            re.compile(r"(?:骗[人子]|没诚意|没[点个]?诚意|忽[悠人]|唬[弄人])"),
            re.compile(r"为什么.{0,4}(?:没[人有]|就[没不]|还不|都不)"),
            # JS parity: universal denial & accusatory assertions (polysemy-03)
            re.compile(r"没有任何[一个]?"),
            re.compile(r"(?:^|[\s，。！？…、]|[你他她它这那])(?:一定|肯定|绝对|分明|明显|摆明了).{0,4}(?:是|在).{0,6}(?:没|不|骗|偷|懒|敷衍|划水|搞|弄)"),
        ],
        "weak": [
            # Existing
            re.compile(r"[你您][真可]?行"),
            re.compile(r"[真可]?牛[逼批啤]?"),
            re.compile(r"赢[麻嘛]了"),
            re.compile(r"不愧是你"),
            re.compile(r"你说得对"),  # often sarcastic in context
            re.compile(r"确实[是]?[的]?$"),
            # NEW: Mild negative assessments
            re.compile(r"(?:不太行|不太对|不太合理|不太合适|不怎么样|不咋地)"),
            re.compile(r"(?:差评|劝退|失望|无语|离谱|搞笑[呢吧]?)"),
            re.compile(r"(?:就硬|硬要|非要|偏要).{0,4}(?:是吧|吗|么)"),
            # Mild criticism with directed tone
            re.compile(r"[你他她这那]?(?:真是?|也太?|有点?太?)(?:菜|弱|坑|水|混|差|烂)"),
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
            re.compile(r"不是(?:没有|没).{0,6}"),  # JS parity: "不是没有道理" double-negation concession
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
            re.compile(r"太(?:绝|好|赞|神|妙)[了啦]?"),  # JS parity: 太绝了/太好了/太赞了
            re.compile(r"牛逼"),
            re.compile(r"(?<![不没])[真太]?[好棒赞](?![说得地话意思了])"),
            re.compile(r"[👍👏🔥💯]"),
            re.compile(r"支持"),
            re.compile(r"加油"),
            re.compile(r"666"),
        ],
        "weak": [
            re.compile(r"不错"),
            re.compile(r"可以[啊呀呢哈哦]"),  # JS parity: requires positive qualifier
            re.compile(r"经典"),  # JS parity: 经典 used positively
            re.compile(r"爱了"),
            re.compile(r"喜欢"),
            re.compile(r"学到了"),
            re.compile(r"感谢"),
            re.compile(r"谢谢"),
            re.compile(r"试试看"),  # JS parity: encouraging suggestion
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
            re.compile(r"去死[了]?算[了]?"),  # JS parity: self-harm context
            re.compile(r"[活生].{0,4}没意[思义]"),  # JS parity: nihilistic self-talk
            re.compile(r"不想[活活]了"),  # JS parity: suicidal ideation as intensifier
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

# ── Helper: negation scope detection ──

NEGATION_SCOPES = [
    re.compile(r"不(?:是|会|能|可以|行|对|好|懂|知道|明白|理解|同意|赞成|支持)[^，。！？…]{0,8}"),
    re.compile(r"没(?:有|什么|啥|多|那么|这么)[^，。！？…]{0,8}"),
]


def _has_negation_scope(text: str) -> bool:
    """Check if the text contains any negation scope (不是/没有)."""
    for pattern in NEGATION_SCOPES:
        if pattern.search(text):
            return True
    return False


# ── Helper: self-directed detection ──

SELF_DIRECTED_PATTERNS = [
    re.compile(r"笑死[我自]|笑死个人|笑死自己"),
    re.compile(r"笑死了[^，。！？…]{0,4}(?:好|有|太|真|很)"),
    re.compile(r"我.{0,4}急了|我急了"),
    re.compile(r"我.{0,4}就这[？?]"),
    re.compile(r"[我自].{0,4}(?:菜[了得]?|垃圾|废物)[！!。，,？?]?$"),
    re.compile(r"我就[是会]?[一个]?(?:菜|垃圾|废物)"),
    re.compile(r"[我自].{0,6}(?:就这|也[这样]|经常|老是这样)"),
]


def _is_self_directed(text: str) -> bool:
    """Check if taunting signals are self-directed (laughing at oneself, etc.)."""
    for pattern in SELF_DIRECTED_PATTERNS:
        if pattern.search(text):
            return True
    return False


# ── Helper: yes/no question detection ──

YES_NO_QUESTION = re.compile(r"是不是.{0,10}(?:[？?吗啊]|怎么|什么)")


def _is_yes_no_question(text: str) -> bool:
    """Check if text is a yes/no question (不是 used interrogatively)."""
    return bool(YES_NO_QUESTION.search(text))


# ── Helper: standalone laughter ──


def _is_pure_laughter(text: str) -> bool:
    """Check if text is pure laughter with no substantive words."""
    import re as _re
    stripped = _re.sub(r"[哈呵嘻嘿嘿呵呵啊呀哦喽~！!？?…。，,\s]", "", text)
    return len(stripped) == 0


# ── public API ──


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

    # ── Step 2.5: Self-directed suppression ──
    if _is_self_directed(clean):
        scores["taunting"] = max(0, scores["taunting"] - 3)
        scores["self_deprecation"] += 2

    # ── Step 2.6: Yes/no question detection ──
    if _is_yes_no_question(clean):
        scores["argument"] = max(0, scores["argument"] - 3)
        scores["neutral_info"] += 1

    # ── Step 2.7: Standalone laughter suppression ──
    if _is_pure_laughter(clean) and scores["taunting"] > 0:
        scores["taunting"] = scores["taunting"] // 2  # floor division
        scores["neutral_info"] += 1

    # ── Step 3: Negation-aware reduction ──
    if _has_negation_scope(clean):
        scores["praise"] = scores["praise"] // 2
        scores["argument"] = scores["argument"] // 2

    # ── Step 3.2: Comparative negation (没有X那么/这么) ──
    # JS parity: "这个没有那个好用" — comparative, not praise.
    # Zero out praise and argument when a comparative 没有 pattern is present.
    if re.search(r"没有.{0,8}(?:那么|这么|那样|这样|那个|这个)", clean):
        scores["praise"] = 0
        scores["argument"] = 0

    # ── Step 3.3: Laughter + positive context override ──
    # JS parity: when 哈哈哈/笑死 co-occurs with explicit positive signals
    # (好活, 太绝了, 太有才了, etc.), the laughter is genuine amusement, not mockery.
    if re.search(r"(?:哈哈哈+|笑死[我了]?)", clean) and re.search(
        r"(?:好活|太绝了|太有才了|当赏|厉害|牛逼|太[强棒牛]了|[👍👏🔥💯])", clean
    ) and scores.get("praise", 0) >= 3:
        scores["praise"] = scores["praise"] + 2
        scores["taunting"] = scores["taunting"] // 2

    # ── Step 4: Cross-scenario suppression ──
    if scores["taunting"] >= 3:
        scores["praise"] = scores["praise"] // 2
    if scores["taunting"] >= 4 and scores["argument"] >= 2:
        scores["argument"] = max(0, scores["argument"] - 2)

    # ── Step 5: Argument-vs-taunting tiebreaker ──
    if (scores["taunting"] > 0 and scores["argument"] > 0
            and abs(scores["taunting"] - scores["argument"]) <= 2):
        scores["argument"] -= 1

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
