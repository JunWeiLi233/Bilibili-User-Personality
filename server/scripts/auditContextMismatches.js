/**
 * Context Mismatch Audit — finds comments where the lexicon flags risk markers
 * but annotators rated the user as non-argumentative (false positives).
 *
 * Uses the 100-user scored+annotated dataset to identify patterns the
 * isMemeOrQuotedNonAttackText filter should catch but currently misses.
 *
 * Usage:
 *   node server/scripts/auditContextMismatches.js
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCORED_DIR = join(ROOT, '.claude', 'random_sampling_eval', 'scored');
const ANNOTATED_DIR = join(ROOT, '.claude', 'random_sampling_eval', 'annotated');
const USER_DATA_DIR = join(ROOT, '.claude', 'random_sampling_eval', 'user_data');

function loadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// Known Bilibili emotes/expressions that are NOT argumentative
const EMOTE_PATTERNS = [
  /\[[一-鿿\w]+\]/g,  // [笑哭], [doge], [支持], etc.
  /\[(\w+)\]/g,                // [tv_xxx], etc.
];

// Common Bilibili meme/discussion patterns that are rarely argumentative
const MEME_PATTERNS = [
  '哈哈哈', '笑死', '绷不住', '没绷住', '确实', '真实',
  '麻了', '离谱', '抽象', '逆天', '好家伙', '原汁原味',
  '典', '太典了', '典中典', '经典', '名场面',
  '路过', '前排', '打卡', '来了', '附议',
  '俺也一样', '+1', '支持', '赞同', '说的对',
  '有道理', '学习了', '受教了', '长知识了',
  'nice', '666', '牛', '牛逼', '绝了',
  '好耶', '舒服了', '爽了', '起飞',
  '直接进行一个', '这也太', '属于是',
  '我靠', '我去', '卧槽', '握日',
  '笑嘻了', '真没绷住', '难绷',
  '哈哈哈哈', '确实如此',
];

// Patterns that indicate self-directed humor, not argumentativeness
const SELF_DEPRECATION_PATTERNS = [
  '我承认', '我错了', '是我搞混', '记错了', '是我的问题',
  '抱歉', '肤浅了', '丢人了', '社死', '尴尬了',
  '我自己', '我就是', '是我了', '我也一样',
];

// Patterns that indicate quoting/retelling someone else's words
const QUOTING_PATTERNS = [
  '之前看', '以前看', '记得以前', '以前玩',
  '我记得', '记得有', '那时候', '当时',
  '回覆', '回复 @', '说真的', '个人观点',
  '我个人', '我觉得', '我认为', '我感觉',
];

function isLikelyMemeOrQuote(comment) {
  const hits = [];
  for (const p of MEME_PATTERNS) {
    if (comment.includes(p)) hits.push(`meme:${p}`);
  }
  for (const p of SELF_DEPRECATION_PATTERNS) {
    if (comment.includes(p)) hits.push(`self_deprecation:${p}`);
  }
  for (const p of QUOTING_PATTERNS) {
    if (comment.includes(p)) hits.push(`quoting:${p}`);
  }
  return hits;
}

function analyzeUserComments(uid, userData, scored) {
  const comments = (userData?.comments || []).map((c) => c.message);
  if (!comments.length) return [];

  // Get lexicon marks for this user
  const riskMarks = (scored?.vocabularyMarks || [])
    .filter((m) => m.polarity === 'risk');
  const riskTerms = new Set(riskMarks.map((m) => m.term));

  const findings = [];
  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    if (!comment) continue;

    // Check which risk terms appear in this comment
    const matchedTerms = [];
    for (const term of riskTerms) {
      if (comment.includes(term)) matchedTerms.push(term);
    }
    if (!matchedTerms.length) continue;

    const memeHits = isLikelyMemeOrQuote(comment);
    findings.push({
      uid,
      commentIndex: i,
      comment: comment.slice(0, 200),
      matchedTerms,
      memeHits,
      likelyMemeOrQuote: memeHits.length > 0,
      reason: memeHits.length > 0 ? memeHits.join('; ') : 'unknown_context',
    });
  }
  return findings;
}

async function main() {
  console.log('=== Context Mismatch Audit ===\n');

  // Load annotated data to identify false positive users
  const falsePositiveUids = new Set();
  const truePositiveUids = new Set();

  for (const [uid, annotated] of Object.entries(loadAll(ANNOTATED_DIR))) {
    const binary = annotated.binaryLabels || {};
    const consensus = annotated.perAxisConsensus || {};

    // False positive: toxicEmotions scored high but annotators say 0
    const scored = loadJson(join(SCORED_DIR, `${uid}.json`));
    if (!scored) continue;

    const teScore = (scored.scores || []).find((s) => s.category === 'toxicEmotions');
    const teConsensus = consensus.toxicEmotions ?? 0;

    if (teScore && teScore.value > 50 && teConsensus === 0) {
      falsePositiveUids.add(uid);
    }
    if (teConsensus >= 1) {
      truePositiveUids.add(uid);
    }
  }

  console.log(`False positive users (model TE>50, annotator TE=0): ${falsePositiveUids.size}`);
  console.log(`True positive users (annotator TE>=1): ${truePositiveUids.size}`);

  // Extract comments from false positive users
  const allFindings = [];
  for (const uid of falsePositiveUids) {
    const userData = loadJson(join(USER_DATA_DIR, `${uid}.json`));
    const scored = loadJson(join(SCORED_DIR, `${uid}.json`));
    if (!userData || !scored) continue;

    const findings = analyzeUserComments(uid, userData, scored);
    allFindings.push(...findings);
  }

  console.log(`\nTotal comment-level findings: ${allFindings.length}`);

  // Categorize
  const categorized = {
    memeOrQuoteDetected: allFindings.filter((f) => f.likelyMemeOrQuote),
    noMemePattern: allFindings.filter((f) => !f.likelyMemeOrQuote),
  };

  console.log(`Likely meme/quote (missed by filter): ${categorized.memeOrQuoteDetected.length}`);
  console.log(`No obvious meme pattern: ${categorized.noMemePattern.length}`);

  // Sample findings
  console.log('\n--- Sample: Missed meme/quote patterns ---');
  for (const f of categorized.memeOrQuoteDetected.slice(0, 20)) {
    console.log(`  [${f.uid}] "${f.comment.slice(0, 80)}"`);
    console.log(`    Terms: ${f.matchedTerms.join(', ')}`);
    console.log(`    Patterns: ${f.reason}`);
  }

  console.log('\n--- Sample: No obvious meme pattern (potential real FPs) ---');
  for (const f of categorized.noMemePattern.slice(0, 10)) {
    console.log(`  [${f.uid}] "${f.comment.slice(0, 80)}"`);
    console.log(`    Terms: ${f.matchedTerms.join(', ')}`);
  }

  // Generate improvement suggestions
  const missedPatterns = new Set();
  for (const f of categorized.memeOrQuoteDetected) {
    for (const hit of f.memeHits) {
      missedPatterns.add(hit);
    }
  }

  console.log(`\n--- Suggested additions to isMemeOrQuotedNonAttackText ---`);
  console.log(`Missed pattern categories: ${[...missedPatterns].slice(0, 30).join(', ')}`);

  // Check: common false-positive terms
  const termFPCount = {};
  for (const f of allFindings) {
    for (const term of f.matchedTerms) {
      termFPCount[term] = (termFPCount[term] || 0) + 1;
    }
  }
  const sortedFPTerms = Object.entries(termFPCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log(`\n--- Top FP terms (most frequent in non-arg users) ---`);
  for (const [term, count] of sortedFPTerms) {
    console.log(`  ${term}: ${count} occurrences`);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      falsePositiveUsers: falsePositiveUids.size,
      truePositiveUsers: truePositiveUids.size,
      commentFindings: allFindings.length,
      memeDetected: categorized.memeOrQuoteDetected.length,
      noPattern: categorized.noMemePattern.length,
    },
    missedPatterns: [...missedPatterns],
    topFalsePositiveTerms: sortedFPTerms.map(([term, count]) => ({ term, count })),
    suggestedAdditions: {
      memePatterns: MEME_PATTERNS.filter((p) => [...missedPatterns].some((mp) => mp.includes(p))),
      selfDeprecationPatterns: SELF_DEPRECATION_PATTERNS.filter((p) => [...missedPatterns].some((mp) => mp.includes(p))),
      quotingPatterns: QUOTING_PATTERNS.filter((p) => [...missedPatterns].some((mp) => mp.includes(p))),
    },
    samples: {
      memeFalsePositives: categorized.memeOrQuoteDetected.slice(0, 30).map((f) => ({
        uid: f.uid,
        comment: f.comment,
        terms: f.matchedTerms,
        patterns: f.memeHits,
      })),
      noPatternFalsePositives: categorized.noMemePattern.slice(0, 20).map((f) => ({
        uid: f.uid,
        comment: f.comment,
        terms: f.matchedTerms,
      })),
    },
  };

  const outputPath = join(ROOT, 'server', 'data', 'context_mismatch_audit.json');
  saveJson(outputPath, report);
  console.log(`\nSaved to ${outputPath}`);
}

function loadAll(dir) {
  const result = {};
  try {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace('.json', '');
      const data = loadJson(join(dir, f));
      if (data) result[uid] = data;
    }
  } catch { /* dir not found */ }
  return result;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
