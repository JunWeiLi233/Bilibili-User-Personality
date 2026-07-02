/**
 * Headless scoring module — extracted from src/main.jsx for batch evaluation.
 *
 * Provides the same scoring pipeline (speech-act rules + keyword lexicon →
 * Ziegenbein 4-axis scores + troll index) without any React or DOM dependency.
 *
 * Usage:
 *   import { scoreComments, getTrollIndex, buildRuntimeLexicon } from '../services/headlessScorer.js';
 *   const result = scoreComments({ name, uid, text, source, runtimeLexicon, analysisMode });
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMemeOrQuotedNonAttackText, buildRiskLexiconText } from '../../src/languageUnderstanding.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..', '..');

// ── Term frequency filter (Path A: scoring-discrimination fix) ──────────────
// Load term frequency data for filtering high-prevalence noise terms from scoring.
let _termFrequency = null;
function loadTermFrequency() {
  if (_termFrequency) return _termFrequency;
  try {
    const freqPath = join(ROOT, 'server', 'data', 'termFrequency.json');
    if (existsSync(freqPath)) {
      _termFrequency = JSON.parse(readFileSync(freqPath, 'utf8'));
    } else {
      _termFrequency = {};
    }
  } catch { _termFrequency = {}; }
  return _termFrequency;
}

const MAX_USER_FRACTION = Number(process.env.BILIBILI_TERM_FREQ_THRESHOLD) || 0.30;

function filterHighFrequencyTerms(terms) {
  if (!Array.isArray(terms)) return terms;
  const freq = loadTermFrequency();
  return terms.filter(term => {
    const entry = freq[term];
    if (!entry) return true; // unknown term — keep (conservative)
    return entry.userFraction <= MAX_USER_FRACTION;
  });
}

/**
 * Build a scoring-filtered copy of a runtime lexicon.
 * High-frequency terms (>MAX_USER_FRACTION prevalence) are removed
 * from scoring calculations to reduce the noise floor.
 * Returns a new lexicon object; does not mutate the input.
 */
export function buildFilteredLexicon(runtimeLexicon) {
  const filtered = {};
  for (const family of Object.keys(runtimeLexicon || {})) {
    filtered[family] = filterHighFrequencyTerms(runtimeLexicon[family]);
  }
  return filtered;
}

// ── IDF-weighted counting (Path C: scoring-discrimination fix) ─────────────
// Replaces raw term counts with IDF-weighted counts so common terms
// (e.g. "没有" in 72% of users) get near-zero weight while rare
// diagnostic terms get amplified. This is the structural fix for
// the noise-floor problem that freq-filtering (Path A) alone can't solve.

const IDF_REFERENCE_N = 100; // reference corpus size (eval set)

function termIdf(term) {
  const freq = loadTermFrequency();
  const entry = freq[term];
  if (!entry || !entry.userCount) return 1.0; // unknown term: weight=1 (neutral)
  // IDF = log(N / df). Floor df at 1 to avoid division by zero.
  const df = Math.max(1, entry.userCount);
  return Math.log(IDF_REFERENCE_N / df);
}

/**
 * Count matches of terms in text, weighting each term by its IDF.
 * Common terms (high df) → low IDF → low contribution.
 * Rare terms (low df) → high IDF → high contribution.
 */
export function countWeightedMatches(text, terms) {
  if (!Array.isArray(terms)) return 0;
  return terms.reduce((sum, term) => {
    if (!term) return sum;
    const rawCount = text.split(term).length - 1;
    return sum + rawCount * termIdf(term);
  }, 0);
}

/**
 * IDF-weighted density: weightedMatches / totalComments
 */
export function idfWeightedDensity(text, terms, total) {
  return countWeightedMatches(text, terms) / Math.max(total, 1);
}

/**
 * IDF-weighted per-thousand: weightedMatches / textLength * 1000
 */
export function idfWeightedPerThousand(text, terms) {
  return (countWeightedMatches(text, terms) / Math.max(text.length, 1)) * 1000;
}

// ---------------------------------------------------------------------------
// Ziegenbein et al. (2023) 4-category classification
// ---------------------------------------------------------------------------
export const ZIEGENBEIN_CATEGORIES = {
  toxicEmotions: { key: 'toxicEmotions', label: '情绪过激', shortLabel: 'Toxic Emotions' },
  missingCommitment: { key: 'missingCommitment', label: '回避讨论', shortLabel: 'Missing Commitment' },
  missingIntelligibility: { key: 'missingIntelligibility', label: '逻辑混乱', shortLabel: 'Missing Intelligibility' },
  otherReasons: { key: 'otherReasons', label: '其他问题', shortLabel: 'Other Reasons' },
};

// ---------------------------------------------------------------------------
// Base lexicons (same as src/main.jsx)
// ---------------------------------------------------------------------------
export const baseLexicons = {
  attack: [
    // Path B (2026-06-28): Removed high-freq context-dependent terms that
    // generate false positives on 20-49% of users: 装, 纯, 云, 笑死, 典, 赢.
    // These are common words in Chinese whose attack meaning depends on context.
    // The speech-act rules (人身攻击/资格审查, 扣立场/动机揣测) already catch
    // the genuinely problematic usage patterns with better precision.
    '你懂', '洗傻', '智商', '脑子', '蠢', '跪', '急了', '别扯', '洗地', '你连',
    '孝', '绷', '小丑', '你配', '你也配', '你算老几', '你什么东西', '你行你上', '就你',
    '看你主页', '翻你动态', '查成分', '你主子', '你爹', '孝子', '逆天', '闹麻了', '唐', '啥狗',
    '出生', '破防', '这就破防', '急成这样', '急了急了', '懂哥', '云玩家', '脑测', '脑补',
    '大聪明', '睿智', '麻了', '绷不住', '蚌', '赢麻了', '遥遥领先', '遥遥',
    '你这种', '你个', '什么东西', '你也配', '搞笑', '可笑', '笑嘻了', '难绷',
    '纯纯', '纯属', '离谱', '逆天', '抽象', '神金', '有病',
  ],
  absolutes: [
    // Path B (2026-06-28): Removed high-freq common adverbs/quantifiers that
    // appear in 11-46% of users regardless of argumentative behavior:
    // 都是, 肯定, 根本, 所有, 没人. These are function words, not risk signals.
    // The speech-act rules (一棍子打死, 铁口直断不给证据) already catch
    // genuinely absolute/overgeneralizing statements with context.
    '全部', '从来', '永远', '必然', '早就没有', '哪个不是', '没有一个',
    '全都', '一律', '无一例外', '百分百', '百分之一百', '任何人', '谁都', '没有人',
    '没有一个人', '没有哪个', '从古至今', '自古以来', '历来',
  ],
  evidence: [
    '数据', '来源', '原文', '链接', '出处', '引用', '截图', '证据', '样本',
    '可查', '可验证', '查证', '核实',
  ],
  evasion: [
    '你自己搜', '自己查', '懂的都懂', '这还用问', '懒得解释', '不解释', '百度一下',
    '不会百度', '问百度', '去百度', '自己去找', '不会搜', '搜一下不会', '这都不知道',
    '常识', '不用我教', '自己学', '去看书', '多读书', '这还用说', '这都不懂',
    '说了你也不懂', '你懂什么',
  ],
  cooperation: [
    '可能', '不一定', '如果', '我理解', '能否', '可以贴', '补充', '限定', '或许', '大概',
    '也许', '有可能', '据我所知', '就我所见', '以我目前', '暂时', '目前看来', '现阶段',
    '这里有一个', '让我补充', '提供一下', '仅供参考', '个人看法', '在我看来', '我的理解',
  ],
  correction: [
    '我错了', '我说重了', '更正', '修正', '改结论', '承认', '说错了', '搞错了', '弄错了',
    '记错了', '确实', '你说得对', '受教', '学习', '感谢指正', '谢谢指正', '有道理',
    '你说的有道理', '这倒也是', '那倒也对', '收回', '前面说错', '之前说错', '是我搞混',
  ],
};

// ---------------------------------------------------------------------------
// Speech-act rules (same as src/main.jsx)
// ---------------------------------------------------------------------------
export const speechActRules = [
  {
    act: '人身攻击 / 资格审查',
    type: '情绪输出',
    severity: '高',
    target: '人',
    pattern: /(你懂|你连|智商|脑子|洗傻|小丑|蠢|急了|典|孝|绷|笑死|你配|你也配|你算老几|你什么东西|你来|你行你上|就你|你这种|你个|看你主页|翻你动态|查成分|你主子|你爹|孝子|逆天|闹麻了|唐|啥狗|出生|急了急了|破防|这就破防|急成这样).{0,20}/,
    diagnosis: '对人不对话——翻主页、扣帽子、质疑资格，是在羞辱人而不是在讨论问题。',
    deltas: { toxicEmotions: 28, cooperation: -18, logic: -10 },
  },
  {
    act: '扣立场 / 动机揣测',
    type: '偷换概念',
    severity: '高',
    target: '动机',
    pattern: /(其实就是|所以你就是|给资本|洗地|收钱|屁股|站队|水军|五毛|美分|粉红|小粉红|精外|洋奴|殖人|1450|来电了|蛙|湾湾|神神|兔兔|你国|贵国|境外势力|恰饭|恰烂钱|广告费|收了多少|到账).{0,22}/,
    diagnosis: '把观点偷换成立场——"你说A是因为你站B，所以A不用讨论了"。',
    deltas: { toxicEmotions: 20, logic: -24, cooperation: -14 },
  },
  {
    act: '甩举证责任',
    type: '缺证据',
    severity: '中',
    target: '证明责任',
    pattern: /(你自己搜|自己查|懂的都懂|这还用问|懒得解释|不解释|百度一下|不会百度|问百度|去百度|自己去找|不会搜|搜一下不会|这都不知道|常识|不用我教|自己学|去看书|多读书|这还用说|这都不懂).{0,20}/,
    diagnosis: '自己说了观点却让别人去查——谁主张谁举证，凭什么让别人替你找证据。',
    deltas: { evidence: -28, cooperation: -10 },
  },
  {
    act: '一棍子打死',
    type: '逻辑硬伤',
    severity: '中',
    target: '命题范围',
    pattern: /(所有|全部|都是|没有一个|哪个不是|从来|永远|根本|全都|一律|无一例外|百分百|百分之一百|任何人|谁都|没人|没有人|没有一个人|没有哪个|从古至今|自古以来|历来).{0,24}/,
    diagnosis: '拿个例当全部——从"有的"直接跳到"全都"，跳过中间所有限定条件。',
    deltas: { closure: 26, logic: -20 },
  },
  {
    act: '铁口直断不给证据',
    type: '事实存疑',
    severity: '中',
    target: '事实',
    pattern: /(早就没有|不可能|必然|肯定|绝对|毫无疑问|毋庸置疑|不用怀疑|不可能是|肯定是|绝对是|很明显|明摆着|众所周知|大家都知道|谁不知道|不用想|毫无疑问地|确定无疑).{0,24}/,
    diagnosis: '语气很笃定但没给任何可查的来源——"大家都知道"可不算是证据。',
    deltas: { closure: 18, evidence: -16, logic: -10 },
  },
  {
    act: '留余地 / 讲道理',
    type: '正常讨论',
    severity: '低',
    target: '观点',
    pattern: /(可能|不一定|如果|我理解|能否|可以贴|补充|限定|或许|大概|也许|有可能|据我所知|就我所见|以我目前|暂时|目前看来|现阶段|这里有一个|让我补充|提供一下|仅供参考|个人看法|在我看来|我的理解).{0,24}/,
    diagnosis: '加了限定词、留了余地——说明是在认真讨论，而不是硬杠到底。',
    deltas: { cooperation: 24, evidence: 8, closure: -10 },
    positive: true,
  },
  {
    act: '认错 / 改口',
    type: '正常讨论',
    severity: '低',
    target: '自我修正',
    pattern: /(我错了|我说重了|更正|修正|改结论|承认|说错了|搞错了|弄错了|记错了|确实|你说得对|受教|学习|感谢指正|谢谢指正|有道理|你说的有道理|这倒也是|那倒也对|收回|前面说错|之前说错|是我搞混).{0,24}/,
    diagnosis: '能承认错误或改口——这是区分正常讨论者和杠精的关键信号。',
    deltas: { correction: 32, cooperation: 12 },
    positive: true,
  },
];

// ---------------------------------------------------------------------------
// Lexicon family metadata (same as src/main.jsx)
// ---------------------------------------------------------------------------
export const lexiconFamilyMeta = {
  attack: {
    label: '攻击 / 嘲讽',
    axis: '情绪过激',
    type: '情绪输出',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中攻击或阴阳怪气类词语，会拉高情绪过激（Toxic Emotions）得分。',
  },
  absolutes: {
    label: '绝对化',
    axis: '逻辑混乱',
    type: '缺少限定',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中绝对化断言类词语，会推高逻辑混乱（Missing Intelligibility）得分。',
  },
  evidence: {
    label: '证据线索',
    axis: '逻辑混乱',
    type: '证据请求',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中证据或来源类词语，视为逻辑混乱的正向指标。',
  },
  evasion: {
    label: '举证回避',
    axis: '回避讨论',
    type: '缺证据',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中甩锅式回避词语，会推高回避讨论（Missing Commitment）得分。',
  },
  cooperation: {
    label: '合作讨论',
    axis: '逻辑混乱',
    type: '讨论线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中澄清、让步或留余地类词语，视为逻辑混乱的正向指标。',
  },
  correction: {
    label: '自我修正',
    axis: '回避讨论',
    type: '修正线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中认错或改口类词语，视为回避讨论的正向指标。',
  },
};

export const familyOrder = Object.keys(lexiconFamilyMeta);

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------
export const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function splitComments(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function countMatches(text, terms) {
  if (!Array.isArray(terms)) return 0;
  return terms.reduce((sum, term) => sum + (term ? text.split(term).length - 1 : 0), 0);
}

export function perThousand(text, terms) {
  return (countMatches(text, terms) / Math.max(text.length, 1)) * 1000;
}

// ---------------------------------------------------------------------------
// Lexicon building
// ---------------------------------------------------------------------------
export function buildRuntimeLexicon(customLexicon = {}) {
  return Object.fromEntries(
    Object.entries(baseLexicons).map(([key, terms]) => {
      const customTerms = customLexicon[key] || [];
      return [key, [...new Set([...terms, ...customTerms])]];
    }),
  );
}

export function mergeDictionaryFamilies(currentLexicon, families = {}) {
  return Object.fromEntries(
    familyOrder.map((family) => {
      const learned = Array.isArray(families[family]) ? families[family] : [];
      return [family, [...new Set([...(currentLexicon[family] || []), ...learned])]];
    }),
  );
}

// ---------------------------------------------------------------------------
// Speech act classification
// ---------------------------------------------------------------------------
export function classifySpeechAct(comment, index, totalComments) {
  const isMeme = isMemeOrQuotedNonAttackText(comment);
  const matched = speechActRules
    .map((rule) => {
      const match = comment.match(rule.pattern);
      if (!match) return null;
      const memeDeltas = isMeme && !rule.positive
        ? Object.fromEntries(Object.entries(rule.deltas).map(([k, v]) => [k, Math.round(v * 0.5)]))
        : rule.deltas;
      return {
        id: `semantic-${index}-${rule.act}`,
        source: '语境分析',
        speechAct: rule.act,
        target: rule.target,
        type: rule.type,
        severity: rule.severity,
        comment,
        highlight: match[0].trim(),
        diagnosis: `${rule.act}。${rule.diagnosis}${isMeme ? '（含梗图/引用语境，降低权重）' : ''}`,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中语义规则；重点检查它是否仍在回应原命题。`,
        confidence: (rule.positive ? 0.64 : rule.severity === '高' ? 0.86 : 0.75) * (isMeme ? 0.7 : 1),
        deltas: memeDeltas,
        positive: rule.positive,
      };
    })
    .filter(Boolean);

  return matched.length > 0
    ? matched
    : [
        {
          id: `semantic-neutral-${index}`,
          source: '语境分析',
          speechAct: '普通观点表达',
          target: '观点',
          type: '未检出高风险错误',
          severity: '低',
          comment,
          highlight: comment,
          diagnosis: '未发现明显攻击、偷换概念、甩举证责任或过度绝对化。不过表达温和不代表观点正确，还要看说的内容本身。',
          evidence: `第 ${index + 1}/${totalComments} 条评论未命中高风险规则。`,
          confidence: 0.54,
          deltas: {},
          neutral: true,
        },
      ];
}

// ---------------------------------------------------------------------------
// Lexicon mark detection
// ---------------------------------------------------------------------------
export function findLexiconMarks(comment, index, totalComments, runtimeLexicon) {
  const marks = [];
  const memeNonAttack = isMemeOrQuotedNonAttackText(comment);
  const highFpTerms = new Set([
    '不是', '我去', '路过', '酸了', '死了', '呵呵', '刀了', '刷屏',
    '送走', '应激', 'p的', '厉不厉害', '辣眼', '辣眼睛',
  ]);
  const downweight = loadDownweightFactors();
  const wordBoundaryRe = /[一-鿿぀-ゟ゠-ヿ\w]/;
  for (const family of familyOrder) {
    const meta = lexiconFamilyMeta[family];
    const terms = runtimeLexicon[family] || [];
    for (const term of terms) {
      if (!term || !comment.includes(term)) continue;
      if (memeNonAttack && meta.polarity === 'risk') continue;
      if (meta.polarity === 'risk' && highFpTerms.has(term)) continue;
      if (term.length <= 2 && /[一-鿿]/.test(term) && meta.polarity !== 'risk') {
        let allBadBoundary = true;
        let searchFrom = 0;
        while (searchFrom < comment.length) {
          const idx = comment.indexOf(term, searchFrom);
          if (idx === -1) break;
          const prev = idx > 0 ? comment[idx - 1] : '';
          const next = idx + term.length < comment.length ? comment[idx + term.length] : '';
          if (!wordBoundaryRe.test(prev) && !wordBoundaryRe.test(next)) {
            allBadBoundary = false;
            break;
          }
          searchFrom = idx + 1;
        }
        if (allBadBoundary) continue;
      }

      // Apply per-term precision downweighting
      const dw = downweight[term];
      const precisionFactor = dw?.factor ?? 1.0;
      // Skip terms with zero precision (pure noise)
      if (precisionFactor <= 0.0) continue;

      const baseConfidence = meta.polarity === 'risk' ? 0.64 : 0.6;
      const adjustedConfidence = baseConfidence * precisionFactor;

      marks.push({
        id: `lexicon-${index}-${family}-${term}`,
        source: '词库匹配',
        speechAct: `${meta.label}词汇标记`,
        target: meta.axis,
        type: meta.type,
        severity: meta.severity,
        comment,
        highlight: term,
        family,
        axis: meta.axis,
        polarity: meta.polarity,
        diagnosis: `${meta.diagnosis} 词面命中只作为雷达辅助证据，不单独定性。${precisionFactor < 1 ? ` (precision-adjusted: ×${precisionFactor.toFixed(2)})` : ''}`,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中字典词"${term}"（${meta.label}），已计入雷达「${meta.axis}」相关计算。`,
        confidence: parseFloat(adjustedConfidence.toFixed(3)),
        _precisionFactor: precisionFactor < 1 ? precisionFactor : undefined,
      });
    }
  }
  return [...new Map(marks.map((mark) => [`${mark.family}:${mark.highlight}`, mark])).values()].slice(0, 6);
}

// ---------------------------------------------------------------------------
// Vocabulary marks summarization
// ---------------------------------------------------------------------------
export function summarizeVocabularyMarks(marks) {
  const grouped = new Map();
  for (const mark of marks) {
    const key = `${mark.family}:${mark.highlight}`;
    const current = grouped.get(key) || {
      term: mark.highlight,
      family: mark.family,
      label: lexiconFamilyMeta[mark.family]?.label || mark.family,
      axis: mark.axis,
      polarity: mark.polarity,
      count: 0,
    };
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || familyOrder.indexOf(a.family) - familyOrder.indexOf(b.family))
    .slice(0, 14);
}

// ---------------------------------------------------------------------------
// Semantic match merging
// ---------------------------------------------------------------------------
export function mergeSemanticMatches(lexiconMarks, semanticMatches, comments, familyMeta) {
  const meta = familyMeta || lexiconFamilyMeta;
  const existingKeys = new Set(lexiconMarks.map((m) => `${m.family}:${m.highlight}`));
  const semanticMarks = [];
  for (let i = 0; i < Math.min(semanticMatches.length, comments.length); i++) {
    const matches = semanticMatches[i] || [];
    for (const match of matches) {
      const key = `${match.family}:${match.term}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const famMeta = meta[match.family] || {};
      semanticMarks.push({
        id: `semantic-${i}-${match.family}-${match.term}`,
        source: '语义匹配',
        speechAct: `${famMeta.label || match.family}语义标记`,
        target: famMeta.axis || '语义相关',
        type: famMeta.type || '语义线索',
        severity: famMeta.severity || '低',
        comment: comments[i] || '',
        highlight: match.term,
        family: match.family,
        axis: famMeta.axis || '语义相关',
        polarity: famMeta.polarity || 'support',
        diagnosis: `语义相似匹配命中词"${match.term}"（相似度 ${(match.similarity || match.score || 0).toFixed(2)}），作为辅助语义证据。`,
        evidence: `第 ${i + 1}/${comments.length} 条评论语义匹配到字典词"${match.term}"（${famMeta.label || match.family}）`,
        confidence: (famMeta.polarity === 'risk' ? 0.58 : 0.54) * Math.min((match.similarity || match.score || 0.72), 1),
      });
    }
  }
  return [...lexiconMarks, ...semanticMarks];
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------
function normalizeForRisk(score) {
  // All 4 Ziegenbein axes are deficiency measures (higher = more problematic)
  return score.value;
}

// ---------------------------------------------------------------------------
// Calibration config (lazy-loaded from server/data/)
// ---------------------------------------------------------------------------
let _calibrationConfig = null;
let _scoringConfig = null;
let _downweightFactors = null;

function loadCalibrationConfig() {
  if (_calibrationConfig) return _calibrationConfig;
  try {
    // First try the scoring_config.json (comprehensive config)
    const cfgPath = join(__dirname, '..', 'data', 'scoring_config.json');
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
      if (cfg?.calibration) {
        _calibrationConfig = { ok: true, calibration: cfg.calibration, n_users: cfg.n_users };
        return _calibrationConfig;
      }
    }
    // Fallback to standalone per_axis_calibration.json
    const calPath = join(__dirname, '..', 'data', 'per_axis_calibration.json');
    if (existsSync(calPath)) {
      _calibrationConfig = JSON.parse(readFileSync(calPath, 'utf8'));
    }
  } catch { /* calibration not available */ }
  return _calibrationConfig;
}

function loadScoringConfig() {
  if (_scoringConfig) return _scoringConfig;
  try {
    const cfgPath = join(__dirname, '..', 'data', 'scoring_config.json');
    if (existsSync(cfgPath)) {
      _scoringConfig = JSON.parse(readFileSync(cfgPath, 'utf8'));
    }
  } catch { /* config not available */ }
  return _scoringConfig;
}

/**
 * Apply per-axis isotonic calibration to raw model scores.
 *
 * Uses linear interpolation between calibration points to map
 * model raw score (0-100) → calibrated probability (0-1).
 * Falls back to identity (score/100) if no calibration data.
 *
 * @param {Array} scores - Array of {axis, category, value} score objects
 * @returns {Array} New scores array with calibrated values
 */
export function applyCalibration(scores) {
  const config = loadCalibrationConfig();
  if (!config?.ok || !config.calibration) return scores;

  return scores.map((s) => {
    const cal = config.calibration[s.category];
    if (!cal?.calibration_points?.length) return s;

    const points = cal.calibration_points;
    const rawValue = s.value;

    // Linear interpolation
    let calibratedProb = rawValue / 100; // fallback

    if (rawValue <= points[0][0]) {
      calibratedProb = points[0][1];
    } else if (rawValue >= points[points.length - 1][0]) {
      calibratedProb = points[points.length - 1][1];
    } else {
      for (let i = 0; i < points.length - 1; i++) {
        if (rawValue >= points[i][0] && rawValue <= points[i + 1][0]) {
          const xFrac = (rawValue - points[i][0]) / (points[i + 1][0] - points[i][0]);
          calibratedProb = points[i][1] + xFrac * (points[i + 1][1] - points[i][1]);
          break;
        }
      }
    }

    return {
      ...s,
      value: Math.round(clamp(calibratedProb * 100)),
      calibratedValue: Math.round(clamp(calibratedProb * 100)),
      rawValue: s.value,
      note: `calibrated: ${s.value} → ${Math.round(clamp(calibratedProb * 100))} (ρ=${cal.spearman_rho?.toFixed(3) || 'N/A'})`,
    };
  });
}

/**
 * Get the optimal troll_index binary threshold from scoring config.
 * Falls back to 50 if no config available.
 */
export function getTrollThreshold() {
  const config = loadScoringConfig();
  if (config?.optimalThreshold?.value != null) {
    return config.optimalThreshold.value;
  }
  return 50; // legacy default
}

/**
 * Get learned blend weights (semantic × α + lexicon × (1-α)) per axis.
 * Falls back to uniform 0.5/0.5 if no config available.
 */
export function getBlendWeights() {
  const config = loadScoringConfig();
  if (config?.blendWeights?.per_axis_weights) {
    const weights = {};
    for (const [ax, w] of Object.entries(config.blendWeights.per_axis_weights)) {
      weights[ax] = w.optimal_alpha ?? 0.5;
    }
    return weights;
  }
  return {
    toxicEmotions: 0.5,
    missingCommitment: 0.5,
    missingIntelligibility: 0.5,
    otherReasons: 0.5,
  };
}

/**
 * Load term precision downweight factors from audit output.
 * Terms with low precision get reduced confidence multipliers.
 */
function loadDownweightFactors() {
  if (_downweightFactors) return _downweightFactors;
  try {
    const auditPath = join(__dirname, '..', 'data', 'term_precision_audit.json');
    if (existsSync(auditPath)) {
      const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
      _downweightFactors = audit.downweightFactors || {};
    } else {
      _downweightFactors = {};
    }
  } catch { _downweightFactors = {}; }
  return _downweightFactors;
}

/**
 * Reload all config caches — useful after updating calibration/audit data.
 */
export function reloadConfig() {
  _calibrationConfig = null;
  _scoringConfig = null;
  _downweightFactors = null;
}

// ---------------------------------------------------------------------------
// Troll index computation
// ---------------------------------------------------------------------------
const TROLL_WEIGHTS = {
  '情绪过激': 0.28,
  '回避讨论': 0.25,
  '逻辑混乱': 0.27,
  '其他问题': 0.20,
};

export function getTrollIndex(user) {
  if (!user || !Array.isArray(user.scores)) return 0;
  return Math.round(
    user.scores.reduce((sum, score) => sum + normalizeForRisk(score) * (TROLL_WEIGHTS[score.axis] || 0.25), 0),
  );
}

// ---------------------------------------------------------------------------
// Inter-rater reliability (hardcoded from n=300 annotation study, 2026-06-28)
// ---------------------------------------------------------------------------
const KAPPA_STATUS = {
  toxicEmotions: 0.84,
  missingCommitment: 0.75,
  missingIntelligibility: 0.69,
  otherReasons: 0.70,
};

// ---------------------------------------------------------------------------
// Main scoring entry point
// ---------------------------------------------------------------------------
let _scoreCounter = 0;

/**
 * Score a user's comments using the hybrid (semantic + lexicon) pipeline.
 *
 * @param {Object} params
 * @param {string} params.name - Display name
 * @param {string} params.uid - User ID
 * @param {string} params.text - Combined comment text (newline-separated)
 * @param {string} params.source - Bio/source text
 * @param {Object} [params.runtimeLexicon] - Custom lexicon (defaults to baseLexicons)
 * @param {string} [params.analysisMode] - 'hybrid' | 'semantic' | 'lexicon' (default 'hybrid')
 * @param {Array} [params.semanticMatches] - Optional per-comment semantic similarity matches
 * @returns {Object} Scoring result with troll_index and per-axis scores
 */
export function scoreComments({ name, uid, text, source, runtimeLexicon, analysisMode = 'hybrid', semanticMatches = null, calibrate = true }) {
  const lex = runtimeLexicon || baseLexicons;
  const comments = splitComments(text);
  const joined = comments.join('\n');
  const riskLexiconText = buildRiskLexiconText(comments);
  const total = Math.max(comments.length, 1);

  // IDF-weighted density for risk families (Path C).
  // Attack, absolutes, and evasion terms are weighted by IDF so common
  // words (e.g. "没有" in 72% of users) contribute near-zero while rare
  // diagnostic terms contribute proportionally more.
  const idfDensity = (terms) => idfWeightedDensity(joined, terms, total);
  const idfRiskDensity = (terms) => idfWeightedDensity(riskLexiconText, terms, total);
  const idfPerThousand = (terms) => idfWeightedPerThousand(riskLexiconText, terms);

  // Raw density for support families (correction, cooperation, evidence).
  // These are inverse indicators — their full weight is intentional.
  const density = (terms) => countMatches(joined, terms) / total;

  // Speech-act classification
  const semanticActs = comments.flatMap((comment, index) => classifySpeechAct(comment, index, total));
  const negativeActs = semanticActs.filter((act) => !act.positive && !act.neutral);
  const positiveActs = semanticActs.filter((act) => act.positive);

  // Lexicon marks (full lexicon — IDF weighting happens at density level)
  const lexiconMarks = comments.flatMap((comment, index) => findLexiconMarks(comment, index, total, lex));
  const allLexiconMarks = semanticMatches && semanticMatches.length
    ? mergeSemanticMatches(lexiconMarks, semanticMatches, comments, lexiconFamilyMeta)
    : lexiconMarks;
  const riskLexiconMarks = allLexiconMarks.filter((mark) => mark.polarity === 'risk');
  const vocabularyMarks = summarizeVocabularyMarks(allLexiconMarks);

  // Corpus-derived baseline seeds
  const semanticSeed = {
    toxicEmotions: 26,
    missingCommitment: 28,
    missingIntelligibility: 44,
    otherReasons: 10,
  };

  semanticActs.forEach((act) => {
    Object.entries(act.deltas || {}).forEach(([key, value]) => {
      if (semanticSeed[key] !== undefined) semanticSeed[key] = clamp(semanticSeed[key] + value);
    });
  });

  // Keyword density formula — IDF-weighted for risk families (Path C)
  const lexiconSeed = {
    toxicEmotions: clamp(28 + idfRiskDensity(lex.attack) * 24 + idfPerThousand(lex.attack) * 2.8),
    missingCommitment: clamp(28 + idfRiskDensity(lex.evasion) * 22 - density(lex.correction) * 14 - density(lex.cooperation) * 8),
    missingIntelligibility: clamp(44 + idfRiskDensity(lex.absolutes) * 18 + idfPerThousand(lex.absolutes) * 2.2 - density(lex.evidence) * 10 + (riskLexiconMarks.length / total) * 12),
    otherReasons: clamp(10 + (riskLexiconMarks.length / total) * 8),
  };

  // Blend — use learned weights from scoring_config when available
  const blendWeights = getBlendWeights();
  const blendAlpha = (category) => blendWeights[category] ?? 0.5;

  const mix = (key) => {
    if (analysisMode === 'semantic') return semanticSeed[key];
    if (analysisMode === 'lexicon') return lexiconSeed[key];
    const alpha = blendAlpha(key);
    return semanticSeed[key] * alpha + lexiconSeed[key] * (1 - alpha);
  };

  const categoryMap = {
    toxicEmotions: '情绪过激',
    missingCommitment: '回避讨论',
    missingIntelligibility: '逻辑混乱',
    otherReasons: '其他问题',
  };

  const scores = Object.entries(categoryMap).map(([category, axis]) => {
    const k = KAPPA_STATUS[category];
    return {
      axis,
      category,
      value: Math.round(clamp(mix(category))),
      benchmark: { toxicEmotions: 48, missingCommitment: 44, missingIntelligibility: 52, otherReasons: 30 }[category],
      kappa: k,
      kappaLabel: k === null ? '评分者一致性: 待标注' :
        k >= 0.6 ? `评分者一致性: κ=${k.toFixed(2)} (可信)` :
        k >= 0.4 ? `评分者一致性: κ=${k.toFixed(2)} (中置信度)` :
        `评分者一致性: κ=${k.toFixed(2)} (低置信度)`,
      kappaVariant: k === null ? 'pending' :
        k >= 0.6 ? 'trusted' :
        k >= 0.4 ? 'moderate' : 'low-confidence',
      note: '',
    };
  });

  // Errors / evidence
  const primaryErrors =
    analysisMode === 'lexicon'
      ? lexiconMarks
      : [...negativeActs, ...(analysisMode === 'hybrid' ? lexiconMarks.slice(0, 4) : [])];

  const fallbackErrors =
    primaryErrors.length > 0
      ? primaryErrors
      : [{
          id: 'generated-empty',
          source: analysisMode === 'lexicon' ? '词库匹配' : '语境分析',
          speechAct: '未检出高风险表达',
          target: '观点',
          type: '未检出高风险错误',
          severity: '低',
          comment: comments[0] || '当前样本为空或缺少可分析评论。',
          highlight: comments[0] || '当前样本为空或缺少可分析评论。',
          diagnosis: '当前样本没有明显攻击、偷换概念、甩举证责任或过度绝对化。低风险不等于观点正确，只是说明这段评论里缺少高冲突语言。',
          evidence: `已检查 ${comments.length} 条评论。`,
          confidence: 0.58,
        }];

  const result = {
    id: `generated-${Date.now()}-${++_scoreCounter}-${analysisMode}`,
    uid: uid || '自定义样本',
    name: name || '自定义 B 站用户',
    bio: source || '由粘贴评论样本即时生成',
    sampleSize: comments.length,
    analyzed: comments.length,
    confidence: comments.length,
    stanceSwitchRate: clamp((positiveActs.length + countMatches(joined, lex.correction || [])) / Math.max(total * 2, 1), 0, 1),
    disagreementRate: clamp((negativeActs.length + riskLexiconMarks.length * 0.35) / Math.max(total, 1), 0, 1),
    engineLabel: analysisMode === 'semantic' ? '语境分析' : analysisMode === 'lexicon' ? '词库模式' : '智能融合',
    speechSummary: {
      negative: negativeActs.length,
      positive: positiveActs.length,
      lexicon: lexiconMarks.length,
      mode: analysisMode,
    },
    vocabularyMarks,
    scores,
    errors: fallbackErrors,
    trollIndex: 0, // computed below
  };

  // Apply per-axis calibration (isotonic regression curves). The live UI opts
  // out (calibrate=false) to keep the raw 0-100 scale + existing bands; the eval
  // path keeps calibration (it's an AUC measurement transform, not part of the
  // core score). Default true preserves all existing eval callers unchanged.
  const calibratedScores = calibrate ? applyCalibration(scores) : scores;

  result.trollIndex = getTrollIndex({ ...result, scores: calibratedScores });

  // Attach calibrated info
  result._calibrated = {
    applied: calibrate,
    scores: calibratedScores,
    threshold: getTrollThreshold(),
    blendWeights: blendWeights,
  };
  return result;
}

export default {
  scoreComments,
  getTrollIndex,
  buildRuntimeLexicon,
  mergeDictionaryFamilies,
  classifySpeechAct,
  findLexiconMarks,
  splitComments,
  countMatches,
  clamp,
  baseLexicons,
  speechActRules,
  lexiconFamilyMeta,
  familyOrder,
  ZIEGENBEIN_CATEGORIES,
};
