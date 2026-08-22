/**
 * DEPRECATED — JS path retired 2026-06-27.
 * Replaced by python_backend/analysis/context_classifier.py
 * and python_backend/cli/context_classifier.py (npm run python:context-classifier).
 * Parity verified via compareContextClassifier.js — 10 fixtures, 0 mismatches.
 * Kept for reference and migration-audit traceability only.
 *
 * Lightweight comment scenario classifier for Chinese polysemy disambiguation.
 *
 * Classifies short Chinese social-media comments into one of 6 scenarios
 * using fast regex/heuristic rules.  No ML, no embeddings — deterministic
 * and runs in microseconds.
 *
 * Used by the context-weighted sense disambiguation layer (Phase 4) to bias
 * which sense of a polysemous term is more likely given the comment's tone.
 */

export const SCENARIOS = [
  'taunting',
  'argument',
  'praise',
  'neutral_info',
  'reassurance',
  'self_deprecation',
];

// ── scenario signal lexicons ──

const SIGNALS = {
  taunting: {
    strong: [
      // Existing
      /哈哈哈+/u,
      /笑死[我了]?/u,
      /乐死/u,
      /典中典/u,
      /急了急了/u,
      /破防了/u,
      /不会吧不会吧/u,
      /就这\?/u,
      /不会真的?有人/u,
      /🤣|😂|😅|😏|🙃/u,
      // NEW: Blame and accusation patterns
      /[你他她它这那].{0,4}(?:垃圾|废物|脑残|智障|sb|SB|傻逼|傻叉)/u,
      // Standalone insults (傻/蠢/笨 +垃圾 etc. — almost always insults in Bilibili)
      /[真就是]?(?:傻|蠢|笨)(?:[逼叉瓜蛋子了]|[得要]?很|[得要]?命|透了|[得]?要?死)?/u,
      /(?:^|[\s，。！？…、]|[这那就]是)(?:垃圾|废物|脑残|智障|傻逼|傻叉)/u,
      /(?:策划|官方|运营|资本|节目组|程序员).{0,4}(?:傻|蠢|笨|垃圾|恶心|离谱|脑残|不要脸|偷懒|敷衍|划水|摸鱼)/u,
      /(?:的错|的问题|害的|搞的|干的|弄的)[!！。？…]*$/u,
      // NEW: Dismissive memes and mockery
      /[你他她]?.{0,2}(?:配吗|也配|就这|急了|绷不住了|孝了|典了)/u,
      /(?:别[扯洗]|[在硬]?洗[地白了]?|硬洗|尬吹|无脑吹)/u,
      /(?:甩锅|背锅|扣帽子|双标|道德绑架)/u,
      // NEW: Exaggerated mockery (removed end-of-string anchor to catch mid-sentence)
      /[你他她]?(?:真[有会]?意思|可真?行|挺会|好一个|好意思)/u,
      /(?:[你他她]|这[也真]|[那也]?).{0,4}(?:不懂|不会|不能|不行|不好|不对|错了)/u,
      // NEW: Coercion/force patterns
      /(?:逼[着迫]?|强迫|强制|硬[是要]?[逼要]?).{0,6}(?:氪[金]?|花钱|付费|充[值钱]|买|掏钱)/u,
      // NEW: Blame attribution ("肯定是X的错/问题")
      /(?:肯定|一定|明显|摆明了|分明|绝对|[这那]就).{0,6}(?:在|是).{0,6}(?:逼|骗|坑|害|搞|弄|偷懒|敷衍|划水|摸鱼)/u,
      // NEW: Laziness/negligence blame
      /(?:偷懒|偷工减料|敷衍[了]?事|糊弄|应付|划水|摸鱼)/u,
      /(?:瞎[搞改弄整写做说扯]|乱[搞改弄整写做说扯])/u,
      // NEW: Hyperbolic mockery and slang (polysemy-02)
      /(?:割韭菜|智商税|骗钱[的]?玩意|忽悠人|圈钱|坑钱|坑爹)/u,
      /(?:带节奏|水军|杠精|喷子|键盘侠|孝子[贤孙]?)/u,
      /没[有]?.{0,6}(?:脑血栓|脑子|智商|脑[子子]?).{0,6}(?:想[不]?出|干[得]?出|做[得]?出)/u,
      /(?:不配|也配)[^，。！？…]{0,4}(?:玩|做|说|评论|评价|当|当人)/u,
      /(?:恶心[人]?|不要脸|没良心|没安好心|居心不良)/u,
      /(?:脑子进水|脑子有[病坑问题]|没脑子|不长脑子|不长[点心眼]|缺心眼)/u,
      /(?:骗[人子]|没诚意|没[点个]?诚意|忽[悠人]|唬[弄人])/u,
      /为什么.{0,4}(?:没[人有]|就[没不]|还不|都不)/u,  // rhetorical "为什么没人/就没人"
      // NEW: Universal quantifier denial & accusatory assertions (polysemy-03)
      /没有任何[一个]?/u,  // "没有任何一个玩家会觉得" — universal denial, absolute stance
      /(?:^|[\s，。！？…、]|[你他她它这那])(?:一定|肯定|绝对|分明|明显|摆明了).{0,4}(?:是|在).{0,6}(?:没|不|骗|偷|懒|敷衍|划水|搞|弄)/u,  // accusatory "你一定是没玩过"
    ],
    weak: [
      // Existing
      /[你您][真可]?行/u,
      /[真可]?牛[逼批啤]?/u,
      /赢[麻嘛]了/u,
      /不愧是你/u,
      /你说得对/u,  // often sarcastic in context
      /确实[是]?[的]?$/u,
      // NEW: Mild negative assessments
      /(?:不太行|不太对|不太合理|不太合适|不怎么样|不咋地)/u,
      /(?:差评|劝退|失望|无语|离谱|搞笑[呢吧]?)/u,
      /(?:就硬|硬要|非要|偏要).{0,4}(?:是吧|吗|么)/u,
      // NEW: Mild criticism with directed tone
      /[你他她这那]?(?:真是?|也太?|有点?太?)(?:菜|弱|坑|水|混|差|烂)/u,
    ],
  },

  argument: {
    strong: [
      /证据/u,
      /数据/u,
      /来源/u,
      /事实/u,
      /逻辑/u,
      /反驳/u,
      /你[错誤]了/u,
      /[并絕]非/u,
      /不是(?:[这那][样么]?)/u,  // requires 这/那 after 不是 — avoids matching plain "不是很懂"
      /请[问請]/u,
      /不是(?:没有|没).{0,6}/u,  // "不是没有道理" — double-negation concession, argumentative structure
    ],
    weak: [
      /因为/u,
      /所以/u,
      /但是/u,
      /然而/u,
      /根据/u,
      /[认为為][为為]/u,
      /实际上/u,
      /客观上/u,
    ],
  },

  praise: {
    strong: [
      /[强牛][啊呀]?$/um,
      /厉害/u,
      /太[强棒牛]了/u,
      /太(?:绝|好|赞|神|妙)[了啦]?/u,  // "太绝了/太好了/太赞了" — common Bilibili praise
      /牛逼/u,
      /(?<![不没])[真太]?[好棒赞](?![说得地话意思了])/u,
      /[👍👏🔥💯]/u,
      /支持/u,
      /加油/u,
      /666/u,
    ],
    weak: [
      /不错/u,
      /可以[啊呀呢哈哦]/u,  // requires positive qualifier — standalone "可以" is too ambiguous
      /经典/u,  // "经典" used positively — distinct from meme "典"
      /爱了/u,
      /喜欢/u,
      /学到了/u,
      /感谢/u,
      /谢谢/u,
      /试试看/u,  // "试试看吧" — encouraging suggestion, supportive tone
    ],
  },

  reassurance: {
    strong: [
      /别[急慌担心]/u,
      /慢慢[来]?/u,
      /不[急赶]/u,
      /没[事关]系?/u,
      /冷静/u,
      /放心/u,
      /马上[就到]/u,
      /等[一等会]/u,
    ],
    weak: [
      /可以的/u,
      /没事/u,
      /还好/u,
      /正常/u,
      /理解/u,
      /确实[会能]/u,
    ],
  },

  self_deprecation: {
    strong: [
      /我[也真]?[是菜垃圾废弱]/u,
      /[我咱][就也]是[一个]?菜/u,
      /我自己[都]?[菜垃圾]/u,
      /菜[是就][我真]/u,
      /[我真]?太菜了/u,
      /[我]?不行/u,
      /我[不]?配/u,
      /去死[了]?算[了]?/u,  // "去死了算了" — literal self-harm context, self-directed negativity
      /[活生].{0,4}没意[思义]/u,  // "活着也没意思" — nihilistic self-talk
      /不想[活活]了/u,  // "不想活了" suicidal ideation as intensifier
    ],
    weak: [
      /我[还也]?[需还]要?学/u,
      /萌新/u,
      /新手/u,
      /小白/u,
      /我不懂/u,
      /我[只就]会/u,
    ],
  },

  neutral_info: {
    strong: [
      /^https?:\/\//u,
      /[bB][vV]\w{8,}/u,
      /[aA][vV]\d+/u,
      /第[一二三四五六七八九十\d]+[集期课章]/u,
    ],
    weak: [
      /这个[是就]/u,
      /[这那]是/u,
      /叫做/u,
      /定义/u,
      /指的是/u,
      /根据.*?规定/u,
    ],
  },
};

// ── Step 3 helper: Chinese negation pre-filter ──

const NEGATION_SCOPES = [
  /不(?:是|会|能|可以|行|对|好|懂|知道|明白|理解|同意|赞成|支持)[^，。！？…]{0,8}/gu,
  /没(?:有|什么|啥|多|那么|这么)[^，。！？…]{0,8}/gu,
];

/**
 * Check if the text contains any negation scope that could falsely boost
 * positive-signal scores (praise, argument).
 */
function hasNegationScope(text) {
  for (const re of NEGATION_SCOPES) {
    const copy = new RegExp(re.source, 'gu');
    if (copy.test(text)) return true;
  }
  return false;
}

// ── Step 3.5 helper: Self-directed detection ──

const SELF_DIRECTED_PATTERNS = [
  /笑死[我自]|笑死个人|笑死自己/u,
  /笑死了[^，。！？…]{0,4}(?:好|有|太|真|很)/u,  // "笑死了这个好有趣" → positive context
  /我.{0,4}急了|我急了/u,
  /我.{0,4}就这[？?]/u,
  /[我自].{0,4}(?:菜[了得]?|垃圾|废物)[！!。，,？?]?$/u,
  /我就[是会]?[一个]?(?:菜|垃圾|废物)/u,
  /[我自].{0,6}(?:就这|也[这样]|经常|老是这样)/u,  // "就这？我自己也经常这样"
];

/**
 * Check if taunting/apparent-attack signals are actually self-directed
 * (laughing at oneself, admitting one's own frustration, etc.).
 */
function isSelfDirected(text) {
  for (const re of SELF_DIRECTED_PATTERNS) {
    if (re.test(text)) return true;
  }
  return false;
}

// ── Step 3.6 helper: Yes/no question detection ──

const YES_NO_QUESTION = /是不是.{0,10}(?:[？?吗啊]|怎么|什么)/u;

function isYesNoQuestion(text) {
  return YES_NO_QUESTION.test(text);
}

// ── Step 3.7 helper: Standalone laughter ──

/**
 * Check if text is pure laughter with no substantive words.
 * "哈哈哈哈" → true; "哈哈哈好活" → false.
 */
function isPureLaughter(text) {
  const stripped = text.replace(/[哈呵嘻嘿嘿呵呵啊呀哦喽~！!？?…。，,\s]/g, '');
  return stripped.length === 0;
}

// ── public API ──

export function classifyScenario(text) {
  const clean = String(text || '').trim();
  if (!clean) {
    return { scenario: 'neutral_info', confidence: 0, scores: {} };
  }

  const scores = {};
  for (const scenario of SCENARIOS) {
    const sig = SIGNALS[scenario] || { strong: [], weak: [] };
    let score = 0;

    for (const re of sig.strong) {
      if (re.test(clean)) score += 3;
    }
    for (const re of sig.weak) {
      if (re.test(clean)) score += 1;
    }

    scores[scenario] = score;
  }

  // ── Step 2.5: Self-directed suppression ──
  // When taunting signals are self-directed (laughing at oneself,
  // admitting frustration, self-deprecating with mockery terms),
  // reduce taunting score and boost self_deprecation.
  if (isSelfDirected(clean)) {
    scores.taunting = Math.max(0, scores.taunting - 3);
    scores.self_deprecation += 2;
  }

  // ── Step 2.6: Yes/no question detection ──
  // "是不是...?" patterns are yes/no questions, not argument openers.
  // Suppress argument signals when the text is clearly a question.
  if (isYesNoQuestion(clean)) {
    scores.argument = Math.max(0, scores.argument - 3);
    scores.neutral_info += 1;
  }

  // ── Step 2.7: Standalone laughter suppression ──
  // Pure laughter without substantive words should not be classified
  // as taunting — it's genuine amusement, a Bilibili norm.
  if (isPureLaughter(clean) && scores.taunting > 0) {
    scores.taunting = Math.floor(scores.taunting * 0.5);
    scores.neutral_info += 1;
  }

  // ── Step 3: Negation-aware reduction ──
  // If the text contains a negation scope (不是/没有), halve the weight
  // of praise and argument signals inside them.  This is a 50% reduction
  // (not flat -1) so that even multi-signal argument/praise gets suppressed
  // when negation is present.
  if (hasNegationScope(clean)) {
    scores.praise = Math.floor(scores.praise * 0.5);
    scores.argument = Math.floor(scores.argument * 0.5);
  }

  // ── Step 3.2: Comparative negation (没有X那么/这么) ──
  // "这个没有那个好用" — comparative, not praise. Zero out praise and argument
  // when a comparative 没有 pattern is present.
  if (/没有.{0,8}(?:那么|这么|那样|这样|那个|这个)/u.test(clean)) {
    scores.praise = 0;
    scores.argument = 0;
  }

  // ── Step 3.3: Laughter + positive context override ──
  // When "哈哈哈/笑死" co-occurs with explicit positive signals
  // (好活, 太绝了, 太有才了, etc.), the laughter is genuine amusement,
  // not mockery. Don't let taunting suppress praise in this context.
  const LAUGHTER_PATTERNS = /(?:哈哈哈+|笑死[我了]?)/u;
  const EXPLICIT_POSITIVE = /(?:好活|太绝了|太有才了|当赏|厉害|牛逼|太[强棒牛]了|[👍👏🔥💯])/u;
  if (LAUGHTER_PATTERNS.test(clean) && EXPLICIT_POSITIVE.test(clean) && scores.praise >= 3) {
    // Boost praise to overcome taunting suppression
    scores.praise += 2;
    // Soften taunting — laughter with explicit praise isn't mockery
    scores.taunting = Math.floor(scores.taunting * 0.5);
  }

  // ── Step 2: Cross-scenario suppression ──
  // Strong taunting signals should suppress praise and argument scores
  // because attack/insult tone is incompatible with genuine praise or
  // evidence-based debate.
  if (scores.taunting >= 3) {
    scores.praise = Math.floor(scores.praise * 0.5);
  }
  if (scores.taunting >= 4 && scores.argument >= 2) {
    scores.argument = Math.max(0, scores.argument - 2);
  }

  // ── Step 4: Argument-vs-taunting tiebreaker ──
  // When taunting and argument scores are close (within 2 points),
  // prefer taunting — Bilibili discourse is more often attack/insult
  // than evidence-based reasoned argument.
  if (scores.taunting > 0 && scores.argument > 0 &&
      Math.abs(scores.taunting - scores.argument) <= 2) {
    scores.argument -= 1;
  }

  // Pick the scenario with the highest score
  let bestScenario = 'neutral_info';
  let bestScore = scores.neutral_info || 0;

  for (const [scenario, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestScenario = scenario;
    }
  }

  // Confidence: 0 if no signals, scales with signal density
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0
    ? Math.min(1, bestScore / Math.max(totalScore, 1))
    : 0;

  return { scenario: bestScenario, confidence: Math.round(confidence * 100) / 100, scores };
}

/**
 * Score how well a comment matches a specific scenario.
 *
 * @param {string} text - comment text
 * @param {string} scenario - one of the SCENARIOS values
 * @returns {number} 0..1 confidence for the given scenario
 */
export function scenarioScore(text, scenario) {
  const result = classifyScenario(text);
  if (result.scenario === scenario) return result.confidence;
  return 0;
}

/**
 * Get the scenario score boost for a sense's scenario match.
 *
 * Used by disambiguation: if the comment's classified scenario matches
 * the sense's declared scenario, return a bonus (0..0.08).
 *
 * @param {string} commentText
 * @param {string|null} senseScenario - from sense.scenario
 * @returns {number} bonus multiplier (0 to 0.08)
 */
export function scenarioMatchBonus(commentText, senseScenario) {
  if (!senseScenario) return 0;
  const { scenario, confidence } = classifyScenario(commentText);
  if (scenario === senseScenario && confidence > 0) {
    return 0.08 * confidence;
  }
  return 0;
}
