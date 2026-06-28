/**
 * Build a PMI-based term co-occurrence model from scored comment data.
 *
 * Processes a synthetic corpus (or real annotation data if available),
 * computes Pointwise Mutual Information for term pairs in high-risk
 * vs. low-risk contexts, and outputs the model to
 * server/data/termCooccurrence.json.
 *
 * Usage:
 *   node server/scripts/buildCooccurrenceModel.js [--corpus=<path>] [--output=<path>]
 *
 * Flags:
 *   --corpus   Path to a JSON array of scored comments (optional)
 *   --output   Output path (default: server/data/termCooccurrence.json)
 *
 * Corpus format (JSON array):
 *   [{
 *     "comment_text": "...",
 *     "risk_score": 0.0-1.0,
 *     "keyword_terms": [{ "term": "...", "family": "..." }]
 *   }]
 *
 * If no --corpus is given, an embedded synthetic corpus of ~50 Chinese
 * comments is used for demonstration and testing.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', '..');

// ─── Configuration ───────────────────────────────────────────────────────────

const CONFIG = {
  windowSize: 25,        // char distance threshold for co-occurrence
  minCooccurrences: 3,   // minimum pair count to include in model
  deltaThreshold: 0.3,   // minimum |deltaPMI| for meaningful signal
  highRiskThreshold: 0.5,// risk_score >= this → high-risk context
};

// ─── Term position finder ────────────────────────────────────────────────────

/**
 * Find all occurrences of each term in the text, returning position info.
 * @param {string} text
 * @param {string[]} terms
 * @returns {Array<{term: string, position: number}>}
 */
function findTermPositions(text, terms) {
  const positions = [];
  for (const term of terms) {
    if (!term) continue;
    let idx = 0;
    while ((idx = text.indexOf(term, idx)) !== -1) {
      positions.push({ term, position: idx });
      idx += 1; // shift by 1 so overlapping matches are found
    }
  }
  return positions;
}

/**
 * Count individual term occurrences and co-occurrences within the window.
 *
 * @param {string} text
 * @param {string[]} terms
 * @returns {{ counts: Record<string,number>, pairs: Record<string,number> }}
 */
function countCommentCooccurrences(text, terms) {
  const positions = findTermPositions(text, terms);
  const counts = {};
  const pairs = {};

  for (let i = 0; i < positions.length; i++) {
    const ti = positions[i].term;
    counts[ti] = (counts[ti] || 0) + 1;

    for (let j = i + 1; j < positions.length; j++) {
      const dist = Math.abs(positions[i].position - positions[j].position);
      if (dist > CONFIG.windowSize) continue;

      // Skip self-pairs (same term co-occurring with itself is meaningless for PMI)
      if (positions[i].term === positions[j].term) continue;

      // Build sorted pair key
      const pairKey = [positions[i].term, positions[j].term].sort().join('::');
      pairs[pairKey] = (pairs[pairKey] || 0) + 1;
    }
  }

  return { counts, pairs };
}

// ─── PMI computation ─────────────────────────────────────────────────────────

/**
 * Compute PMI scores for all term pairs in a given context.
 *
 * PMI(a,b) = log(P(a,b) / (P(a) * P(b)))
 *          = log(count[a,b] * total / (count[a] * count[b]))
 *
 * @param {Record<string,number>} pairCounts - co-occurrence counts per pair
 * @param {Record<string,number>} termCounts - individual term occurrence counts
 * @returns {Record<string,{pmi: number, count: number}>}
 */
function computePMI(pairCounts, termCounts) {
  const total = Object.values(termCounts).reduce((s, v) => s + v, 0);
  if (total === 0) return {};

  const results = {};
  for (const [pairKey, count] of Object.entries(pairCounts)) {
    const [a, b] = pairKey.split('::');
    const countA = termCounts[a] || 0;
    const countB = termCounts[b] || 0;
    if (countA === 0 || countB === 0) continue;

    // PMI = log(count[a,b] * total / (count[a] * count[b]))
    const pmi = Math.log((count * total) / (countA * countB));
    results[pairKey] = { pmi, count };
  }

  return results;
}

/**
 * Build the co-occurrence model from a scored corpus.
 *
 * @param {Array<{comment_text: string, risk_score: number, keyword_terms: Array<{term: string, family?: string}>}>} corpus
 * @returns {Object} model object
 */
function buildModel(corpus) {
  // Separate high-risk and low-risk contexts
  const highTermCounts = {};
  const lowTermCounts = {};
  const highPairCounts = {};
  const lowPairCounts = {};

  for (const comment of corpus) {
    const text = comment.comment_text || '';
    const terms = (comment.keyword_terms || []).map(t =>
      typeof t === 'string' ? t : t.term
    ).filter(Boolean);

    if (terms.length < 1) continue;

    const { counts, pairs } = countCommentCooccurrences(text, terms);
    const isHighRisk = comment.risk_score >= CONFIG.highRiskThreshold;

    const targetTermCounts = isHighRisk ? highTermCounts : lowTermCounts;
    const targetPairCounts = isHighRisk ? highPairCounts : lowPairCounts;

    for (const [term, cnt] of Object.entries(counts)) {
      targetTermCounts[term] = (targetTermCounts[term] || 0) + cnt;
    }
    for (const [pairKey, cnt] of Object.entries(pairs)) {
      targetPairCounts[pairKey] = (targetPairCounts[pairKey] || 0) + cnt;
    }
  }

  // Compute PMI for each context
  const highPMI = computePMI(highPairCounts, highTermCounts);
  const lowPMI = computePMI(lowPairCounts, lowTermCounts);

  // Merge into final pair list
  const allPairKeys = new Set([
    ...Object.keys(highPMI),
    ...Object.keys(lowPMI),
  ]);

  const pairs = {};
  for (const key of allPairKeys) {
    const h = highPMI[key];
    const l = lowPMI[key];
    const highRiskPMI = h ? h.pmi : null;
    const lowRiskPMI = l ? l.pmi : null;
    const totalCount = (h?.count || 0) + (l?.count || 0);

    // Filter: only keep pairs with ≥ minCooccurrences
    if (totalCount < CONFIG.minCooccurrences) continue;

    // Compute deltaPMI. When PMI is missing in one context, treat as -∞ (large negative)
    // For practical purposes, we approximate missing PMI as -2.0
    const highVal = highRiskPMI !== null ? highRiskPMI : -2.0;
    const lowVal = lowRiskPMI !== null ? lowRiskPMI : -2.0;
    const deltaPMI = highVal - lowVal;

    // Only include pairs with meaningful delta
    if (Math.abs(deltaPMI) < CONFIG.deltaThreshold) continue;

    pairs[key] = {
      highRiskPMI: highRiskPMI !== null ? parseFloat(highRiskPMI.toFixed(4)) : null,
      lowRiskPMI: lowRiskPMI !== null ? parseFloat(lowRiskPMI.toFixed(4)) : null,
      deltaPMI: parseFloat(deltaPMI.toFixed(4)),
      count: totalCount,
    };
  }

  return {
    version: 1,
    builtAt: new Date().toISOString(),
    config: { ...CONFIG },
    pairs,
    stats: {
      corpusSize: corpus.length,
      uniqueTerms: Object.keys({ ...highTermCounts, ...lowTermCounts }).length,
      uniquePairs: Object.keys(pairs).length,
    },
  };
}

// ─── Synthetic corpus ────────────────────────────────────────────────────────

/**
 * Synthetic corpus of ~50 Chinese Bilibili-like comments with known term pairs
 * and risk scores, sufficient to demonstrate PMI calculation.
 *
 * High-risk pairs (attack + absolutes):
 *   你根本::所有, 脑子::从来, 智商::永远, 你懂::全部, 蠢::全都,
 *   急了::没有一个, 纯::必然, 云::从来, 孝::全部, 绷::全都
 *
 * Low-risk pairs (cooperation + correction):
 *   可能::确实, 我理解::你说得对, 大概::有道理, 或许::承认,
 *   不一定::数据, 如果::指正, 据我所知::可能, 暂时::感谢指正,
 *   我理解::确实, 目前看来::或许
 */
function buildSyntheticCorpus() {
  const high = (text, terms) => ({
    comment_text: text,
    risk_score: 0.75 + Math.random() * 0.15,
    keyword_terms: terms.map(t =>
      typeof t === 'string' ? { term: t } : t
    ),
  });

  const low = (text, terms) => ({
    comment_text: text,
    risk_score: 0.15 + Math.random() * 0.2,
    keyword_terms: terms.map(t =>
      typeof t === 'string' ? { term: t } : t
    ),
  });

  // High-risk comments with attack + absolutes co-occurrence
  const highRisk = [
    // 你根本 + 所有 / 全部 co-occurrences
    high('你根本不懂，所有这些都是错的', ['你根本', '所有']),
    high('你根本就是故意的，所有人都在看', ['你根本', '所有']),
    high('你根本不想讨论，所有解释都是借口', ['你根本', '所有']),
    high('你根本不知道全部真相', ['你根本', '全部']),
    high('你根本不在乎，所有人都看出来了', ['你根本', '所有']),

    // 脑子 + 从来 co-occurrences
    high('你脑子有问题吧？从来就没对过', ['脑子', '从来']),
    high('有脑子的人从来不会这么说', ['脑子', '从来']),
    high('你脑子从来就没正常过', ['脑子', '从来']),

    // 智商 + 永远 co-occurrences
    high('就你这智商？永远都搞不明白', ['智商', '永远']),
    high('智商堪忧，永远都理解不了', ['智商', '永远']),
    high('这智商永远没救了', ['智商', '永远']),

    // 你懂 + 全部 co-occurrences
    high('你懂什么？全部都是瞎扯', ['你懂', '全部']),
    high('你懂个啥，全部都说错了', ['你懂', '全部']),
    high('你懂的话全部都应该知道', ['你懂', '全部']),

    // 蠢 + 全都 co-occurrences
    high('太蠢了，全都是胡说八道', ['蠢', '全都']),
    high('蠢得可以，全部常识都没有', ['蠢', '全部']),

    // 急了 + 没有一个
    high('急什么？没有一个能打的', ['急了', '没有一个']),
    high('急了急了，没有一个说对了', ['急了', '没有一个']),

    // 纯 + 必然
    high('纯属搞事，必然是这个结果', ['纯', '必然']),
    high('纯纯的智商税，必然没人买', ['纯', '必然']),

    // 云 + 从来
    high('云玩家从来不看攻略', ['云', '从来']),
    high('云的很，从来都是瞎说', ['云', '从来']),

    // 所有 + 从来 (absolutes clustering)
    high('所有问题从来就没解决过', ['所有', '从来']),
    high('所有观点从来都不考虑事实', ['所有', '从来']),
    high('所有人从来都不说实话', ['所有', '从来']),
  ];

  // Low-risk comments with cooperation + correction co-occurrence
  const lowRisk = [
    // 可能 + 确实 co-occurrences
    low('可能我理解错了，确实你说得对', ['可能', '确实', '你说得对']),
    low('可能确实是我的问题', ['可能', '确实']),
    low('这可能确实不太好说', ['可能', '确实']),
    low('可能确实需要再考虑一下', ['可能', '确实']),

    // 我理解 + 你说得对 co-occurrences
    low('我理解你的观点，你说得对', ['我理解', '你说得对']),
    low('我理解你说的，确实有道理', ['我理解', '确实', '有道理']),
    low('我理解你的意思，你说得对', ['我理解', '你说得对']),

    // 大概 + 有道理 co-occurrences
    low('大概是我的问题，你说的有道理', ['大概', '有道理']),
    low('大概你是对的，有道理', ['大概', '有道理']),

    // 或许 + 承认 (correction) co-occurrences
    low('或许吧，我承认你说的有道理', ['或许', '有道理']),
    low('或许你说得对，我承认错了', ['或许', '你说得对']),

    // 据我所知 + 可能 co-occurrences
    low('据我所知，可能不是这样', ['据我所知', '可能']),
    low('据我所知，可能还有其他原因', ['据我所知', '可能']),

    // 如果 + 指正 co-occurrences
    low('如果我说错了，请指正', ['如果', '指正']),
    low('如果有问题，感谢指正', ['如果', '指正']),

    // 暂时 + 感谢指正 co-occurrences
    low('暂时保留意见，感谢指正', ['暂时', '感谢指正']),
    low('暂时先这样，感谢指正', ['暂时', '感谢指正']),

    // 不一定 + 数据
    low('不一定对，让我补充数据', ['不一定', '数据']),
    low('不一定准确，需要更多数据', ['不一定', '数据']),

    // 目前看来 + 或许
    low('目前看来，或许你说得对', ['目前看来', '或许']),
    low('目前看来，或许可以再等等', ['目前看来', '或许']),

    // Cooperation-only context (single terms, dilutes high-risk signal)
    low('这是我的个人看法', ['个人看法']),
    low('仅供参考', ['仅供参考']),
    low('在我看来可能不是这样', ['可能', '在我看来']),
    low('据我所知这不一定对', ['据我所知', '不一定']),
  ];

  return [...highRisk, ...lowRisk];
}

// ─── Main ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { corpus: '', output: '' };
  for (const a of argv) {
    if (a.startsWith('--corpus=')) args.corpus = a.split('=')[1];
    else if (a.startsWith('--output=')) args.output = a.split('=')[1];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputPath = args.output || join(PROJECT, 'server', 'data', 'termCooccurrence.json');

  let corpus;
  if (args.corpus && existsSync(args.corpus)) {
    try {
      corpus = JSON.parse(readFileSync(args.corpus, 'utf8'));
      console.log(`Loaded ${corpus.length} comments from ${args.corpus}`);
    } catch (e) {
      console.error(`Failed to load corpus from ${args.corpus}: ${e.message}`);
      process.exit(1);
    }
  } else if (args.corpus) {
    console.error(`Corpus file not found: ${args.corpus}`);
    process.exit(1);
  } else {
    corpus = buildSyntheticCorpus();
    console.log(`Using synthetic corpus: ${corpus.length} comments`);
  }

  const model = buildModel(corpus);

  // Ensure output directory exists
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(model, null, 2), 'utf8');

  console.log(`\nCo-occurrence model built:`);
  console.log(`  Corpus:           ${model.stats.corpusSize} comments`);
  console.log(`  Unique terms:     ${model.stats.uniqueTerms}`);
  console.log(`  Unique pairs:     ${model.stats.uniquePairs}`);
  console.log(`  Window size:      ${model.config.windowSize} chars`);
  console.log(`  Min co-occur:     ${model.config.minCooccurrences}`);
  console.log(`  Delta threshold:  ${model.config.deltaThreshold}`);

  // Show top pairs by |deltaPMI|
  const sorted = Object.entries(model.pairs)
    .sort((a, b) => Math.abs(b[1].deltaPMI) - Math.abs(a[1].deltaPMI))
    .slice(0, 15);

  if (sorted.length > 0) {
    console.log(`\nTop pairs by |deltaPMI|:`);
    for (const [key, val] of sorted) {
      const trend = val.deltaPMI > 0 ? 'BOOST (arg.)' : 'SUPPRESS (neut.)';
      console.log(`  ${key.padEnd(20)} Δ=${val.deltaPMI.toFixed(2)}  count=${val.count}  ${trend}`);
    }
  } else {
    console.log(`\nNo pairs met the thresholds.`);
  }

  console.log(`\nOutput: ${outputPath}`);
}

try {
  main();
} catch (e) {
  console.error('Fatal:', e);
  process.exit(1);
}
