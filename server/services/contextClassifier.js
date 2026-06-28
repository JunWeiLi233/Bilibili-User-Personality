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
    ],
    weak: [
      /[你您][真可]?行/u,
      /[真可]?牛[逼批啤]?/u,
      /赢[麻嘛]了/u,
      /不愧是你/u,
      /你说得对/u,  // often sarcastic in context
      /确实[是]?[的]?$/u,
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
      /不是[这那]?[样么]?/u,
      /请[问請]/u,
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
      /牛逼/u,
      /[真太]?[好棒赞]/u,
      /[👍👏🔥💯]/u,
      /支持/u,
      /加油/u,
      /666/u,
    ],
    weak: [
      /不错/u,
      /可以[啊呀]?/u,
      /爱了/u,
      /喜欢/u,
      /学到了/u,
      /感谢/u,
      /谢谢/u,
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

// ── public API ──

/**
 * Classify a comment into the most likely scenario.
 *
 * @param {string} text - comment text
 * @returns {{ scenario: string, confidence: number, scores: Record<string, number> }}
 *   scenario — the top scenario (or 'neutral_info' as default)
 *   confidence — 0..1, how strongly the classifier believes in the top scenario
 *   scores — all scenario scores (for debugging)
 */
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
