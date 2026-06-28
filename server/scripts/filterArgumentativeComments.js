#!/usr/bin/env node
/**
 * Argumentativeness Pre-Filter — Step 1 of the κ Gate Fix Plan
 *
 * Reads personality_analysis_data_100.json, extracts ALL unique comment texts,
 * scores each with a heuristic argumentativeness filter, deduplicates, takes
 * the top 300, and outputs argumentative_candidates.json for 3-annotator DeepSeek.
 *
 * Scoring rules (from KAPPA_GATE_FIX_PLAN.md):
 *   Contains ≥1 attack term + emotional punctuation (!?！？) → +30
 *   Contains ≥1 evasion term ("懂的都懂", "自己查") → +20
 *   Contains ≥1 absolutes term ("全都是", "没有一个") → +15
 *   Received replies (comment has children/replies in thread) → +10
 *   Length ≥ 50 chars → +5
 *   Contains cooperation terms ("可能", "不一定") → -20
 *
 * Usage:
 *   node server/scripts/filterArgumentativeComments.js
 *   node server/scripts/filterArgumentativeComments.js --top 300 --output .claude/annotation_data/argumentative_candidates.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CWD = process.cwd();

// ——— CLI args ———
function parseArgs(argv) {
  const args = { top: 300, input: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--top': args.top = parseInt(argv[++i], 10) || 300; break;
      case '--input': args.input = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
    }
  }
  return args;
}

// ─── Heuristic term sets ───

/** Attack terms: common Chinese aggressive/confrontational vocabulary */
const ATTACK_TERMS = new Set([
  '傻逼', '傻B', 'sb', 'SB', '脑残', '弱智', '废物', '垃圾', '恶心',
  '滚', '滚蛋', '草', '操', '妈的', '他妈', '你妈', '尼玛', 'tm',
  '无语', '离谱', '有病', '神经病', '疯子', '智障', '低能',
  '放屁', '扯淡', '胡说', '瞎说', '闭嘴',
  '急了', '破防', '典', '绷不住', '孝子', '孝',
  '就这', '不会吧', '差不多得了',
  '笑死', '乐', '啊对对对', '典中典',
  '纯纯', '太对', '对对对',
]);

/** Emotional punctuation (combined with attack terms = +30) */
const EMOTIONAL_PUNCT = /[!！?？]{2,}|[!！?？][!！?？\s]*[!！?？]/u;

/** Evasion terms */
const EVASION_TERMS = new Set([
  '懂的都懂', '自己查', '你自己看', '懒得', '不想说',
  '没必要', '你开心就好', '你说得对', '行了吧',
  '不想解释', '爱信不信', '随便你', '无所谓',
  '你说是就是', '你赢了', '当我没说',
  '回避', '转移话题', '别问了', '不说了',
]);

/** Absolutes terms */
const ABSOLUTES_TERMS = new Set([
  '全都是', '没有一个', '所有人都', '从来都', '永远都',
  '绝对是', '一定是', '肯定是', '必然是', '绝对是',
  '毫无', '完全不', '根本不', '绝对不', '永远不',
  '所有', '每一个', '任何', '全部',
  '毫无疑问', '显然', '明摆着',
  '必定', '铁定', '板上钉钉',
]);

/** Cooperation terms (negative weight — these reduce argumentativeness) */
const COOPERATION_TERMS = new Set([
  '可能', '不一定', '也许', '或许', '大概',
  '我觉得', '个人认为', '仅供参考',
  '也许吧', '不好说', '看情况',
  '一般来说', '通常', '有些',
  '有的', '部分', '并非所有',
  '说得对', '有道理', '确实如此',
  '同意', '赞同', '支持你的观点',
  '补充一下', '另外', '另一方面',
]);

/** Reply indicators in the text itself (proxy for "has replies") */
const REPLY_INDICATORS = /^回复\s*[@：:]|回复\s+\w+|^@\w+/u;

// ─── Scoring ───

/**
 * Score a single comment for argumentativeness.
 * @param {string} text - comment text
 * @param {object} meta - optional metadata (source, etc.)
 * @returns {number} heuristic score
 */
function scoreComment(text) {
  const clean = String(text || '').trim();
  if (!clean) return 0;

  let score = 0;

  // Rule 1: Attack term + emotional punctuation → +30
  const hasAttack = ATTACK_TERMS.size > 0 && [...ATTACK_TERMS].some(t => clean.includes(t));
  const hasEmotionalPunct = EMOTIONAL_PUNCT.test(clean);
  if (hasAttack && hasEmotionalPunct) {
    score += 30;
  } else if (hasAttack) {
    // Attack term alone still gets partial credit
    score += 15;
  }

  // Rule 2: Evasion term → +20
  const hasEvasion = [...EVASION_TERMS].some(t => clean.includes(t));
  if (hasEvasion) {
    score += 20;
  }

  // Rule 3: Absolutes term → +15
  const hasAbsolutes = [...ABSOLUTES_TERMS].some(t => clean.includes(t));
  if (hasAbsolutes) {
    score += 15;
  }

  // Rule 4: Reply indicator (comment is a reply to someone) → +10
  if (REPLY_INDICATORS.test(clean)) {
    score += 10;
  }

  // Rule 5: Length ≥ 50 chars → +5
  if (clean.length >= 50) {
    score += 5;
  }

  // Rule 6: Cooperation terms → -20
  const hasCooperation = [...COOPERATION_TERMS].some(t => clean.includes(t));
  if (hasCooperation) {
    score -= 20;
  }

  // Floor at 0
  return Math.max(0, score);
}

// ─── Comment extraction ───

/**
 * Extract all unique comment texts from personality_analysis_data_100.json.
 * Returns array of {text, source_uid, keywordFamilies, keywordTerms, sources}
 */
function extractComments(data) {
  const seen = new Map(); // normalized text → entry
  const analyses = data.analyses || {};

  for (const [uid, analysis] of Object.entries(analyses)) {
    const topTerms = analysis.topTerms || [];
    for (const termEntry of topTerms) {
      const samples = termEntry.samples || [];
      const family = termEntry.family || 'unknown';
      const term = termEntry.term || '';

      for (const sample of samples) {
        const text = String(sample.text || '').trim();
        if (!text) continue;

        // Normalize: collapse whitespace
        const normalized = text.replace(/\s+/g, ' ').trim();

        if (seen.has(normalized)) {
          // Merge metadata
          const existing = seen.get(normalized);
          existing.keywordFamilies.add(family);
          existing.keywordTerms.add(term);
        } else {
          seen.set(normalized, {
            text,  // keep original
            normalized,
            source_uid: uid,
            keywordFamilies: new Set([family]),
            keywordTerms: new Set([term]),
          });
        }
      }
    }
  }

  // Convert Sets to arrays
  return [...seen.values()].map(entry => ({
    text: entry.text,
    normalized: entry.normalized,
    source_uid: entry.source_uid,
    keywordFamilies: [...entry.keywordFamilies],
    keywordTerms: [...entry.keywordTerms],
  }));
}

// ─── Main ───

function main() {
  const args = parseArgs(process.argv.slice(2));

  const inputPath = resolve(CWD, args.input || '.claude/personality_analysis_data_100.json');
  const outputPath = resolve(CWD, args.output || '.claude/annotation_data/argumentative_candidates.json');

  console.log('=== Argumentativeness Pre-Filter ===');
  console.log(`  Input:  ${inputPath}`);
  console.log(`  Output: ${outputPath}`);
  console.log();

  // Load data
  let data;
  try {
    data = JSON.parse(readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error(`ERROR loading input file: ${e.message}`);
    process.exit(1);
  }

  // Extract comments
  const comments = extractComments(data);
  console.log(`Extracted ${comments.length} unique comment texts`);
  console.log(`  Total messages in source: ${data.summary?.totalMessages || '?'}`);
  console.log(`  Total hits in source: ${data.summary?.totalHits || '?'}`);
  console.log(`  Total distinct in source: ${data.summary?.totalDistinct || '?'}`);

  // Score each comment
  const scored = comments.map(c => ({
    ...c,
    score: scoreComment(c.text),
  }));

  // Distribution stats
  const scores = scored.map(c => c.score);
  scores.sort((a, b) => b - a);
  const maxScore = scores[0] || 0;
  const minScore = scores[scores.length - 1] || 0;
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length || 0;

  console.log();
  console.log('Score distribution:');
  console.log(`  Max: ${maxScore}, Min: ${minScore}, Avg: ${avgScore.toFixed(1)}`);
  console.log(`  Score ≥ 10: ${scores.filter(s => s >= 10).length}`);
  console.log(`  Score ≥ 20: ${scores.filter(s => s >= 20).length}`);
  console.log(`  Score ≥ 30: ${scores.filter(s => s >= 30).length}`);
  console.log(`  Score = 0:  ${scores.filter(s => s === 0).length}`);

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  const topN = scored.slice(0, Math.min(args.top, scored.length));

  console.log();
  console.log(`Top ${topN.length} candidates:`);
  console.log(`  Score range: ${topN[topN.length - 1]?.score || 0} – ${topN[0]?.score || 0}`);

  // Format output with comment_id
  const output = topN.map((c, i) => ({
    comment_id: `arg_${String(i + 1).padStart(4, '0')}`,
    comment_text: c.text,
    source_uid: c.source_uid,
    source_file: 'personality_analysis_data_100.json',
    heuristic_score: c.score,
    keyword_families: frequencyMap(c.keywordFamilies),
    keyword_terms: c.keywordTerms,
    annotations: [],
  }));

  // Ensure output directory exists
  try {
    mkdirSync(dirname(outputPath), { recursive: true });
  } catch (_) { /* dir exists */ }

  writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nOutput written to: ${outputPath}`);
  console.log(`  ${output.length} candidates ready for 3-annotator DeepSeek`);
  console.log('Done.');
}

/** Convert array to {item: count} frequency map */
function frequencyMap(arr) {
  const map = {};
  for (const item of arr) {
    map[item] = (map[item] || 0) + 1;
  }
  return map;
}

main();
