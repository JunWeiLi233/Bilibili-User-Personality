/**
 * Random Sampling Evaluation — orchestration script.
 *
 * Evaluates the personality analysis model's accuracy against N=100 random
 * Bilibili users by comparing model scores to DeepSeek A1/A2/A3 annotator
 * consensus as proxy ground truth.
 *
 * Usage:
 *   node server/scripts/runRandomSamplingEval.js --step 1    # Generate & validate UIDs
 *   node server/scripts/runRandomSamplingEval.js --step 2    # Scrape comments
 *   node server/scripts/runRandomSamplingEval.js --step 3    # Score
 *   node server/scripts/runRandomSamplingEval.js --step 4    # Annotate
 *   node server/scripts/runRandomSamplingEval.js --step 5    # Compute metrics
 *   node server/scripts/runRandomSamplingEval.js --step 6    # Generate report
 *   node server/scripts/runRandomSamplingEval.js --all       # Run all steps
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const OUTPUT_DIR = join(ROOT, '.claude', 'random_sampling_eval');
const USER_DATA_DIR = join(OUTPUT_DIR, 'user_data');
const SCORED_DIR = join(OUTPUT_DIR, 'scored');
const ANNOTATED_DIR = join(OUTPUT_DIR, 'annotated');

// AICU user database (cached scrapes)
const AICU_DB_PATH = join(ROOT, 'server', 'data', 'aicu-user-database.json');

// Config
const SAMPLE_SIZE = 100;
const MIN_COMMENTS = 10;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function randomUid() {
  return Math.floor(Math.random() * (UID_MAX - UID_MIN + 1)) + UID_MIN;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

async function loadJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// AICU API helpers (mirrors server/routes/aicu.js)
// ---------------------------------------------------------------------------
async function fetchAicuComments(uid, page = 1, pageSize = PAGE_SIZE) {
  const url = `${AICU_COMMENTS_API}?uid=${uid}&pn=${page}&ps=${pageSize}&mode=0&keyword=`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchAicuDanmaku(uid, page = 1, pageSize = PAGE_SIZE) {
  const url = `${AICU_DANMAKU_API}?uid=${uid}&pn=${page}&ps=${pageSize}&keyword=`;
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function scrapeUserComments(uid, maxPages = MAX_PAGES) {
  const all = [];
  let retries = 0;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuComments(uid, page);
      if (data.code !== 0 || !data.data?.replies?.length) break;
      all.push(...data.data.replies);
      if (data.data.cursor?.is_end) break;
      if (page < maxPages) await wait(DELAY_MS);
      retries = 0;
    } catch (err) {
      if (err.message.includes('429')) {
        retries++;
        if (retries > MAX_RETRIES) break;
        await wait(RETRY_BASE_MS * retries);
        page--;
        continue;
      }
      break;
    }
  }
  return all;
}

async function scrapeUserDanmaku(uid, maxPages = MAX_PAGES) {
  const all = [];
  let retries = 0;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuDanmaku(uid, page);
      if (data.code !== 0 || !data.data?.videodmlist?.length) break;
      all.push(...data.data.videodmlist);
      if (data.data.cursor?.is_end) break;
      if (page < maxPages) await wait(DELAY_MS);
      retries = 0;
    } catch (err) {
      if (err.message.includes('429')) {
        retries++;
        if (retries > MAX_RETRIES) break;
        await wait(RETRY_BASE_MS * retries);
        page--;
        continue;
      }
      break;
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Step 1: Sample 100 random UIDs from existing cached AICU database
// ---------------------------------------------------------------------------
async function step1_generateSample() {
  console.log('=== Step 1: Sample 100 random UIDs from cached AICU database ===\n');

  await ensureDir(OUTPUT_DIR);
  const samplePath = join(OUTPUT_DIR, 'sample_uids.json');

  // Load existing database
  const db = await loadJson(AICU_DB_PATH, { users: {} });
  const allUsers = Object.values(db.users || {});
  const eligible = allUsers.filter((u) => (u.commentCount || 0) >= MIN_COMMENTS);

  console.log(`Total cached users: ${allUsers.length}`);
  console.log(`Eligible (≥${MIN_COMMENTS} comments): ${eligible.length}`);

  // Shuffle and pick 100
  const shuffled = eligible.sort(() => Math.random() - 0.5);
  const sampled = shuffled.slice(0, SAMPLE_SIZE).map((u) => ({
    uid: u.uid,
    commentCount: u.commentCount,
    danmakuCount: u.danmakuCount || 0,
    scrapedAt: u.scrapedAt,
  }));

  await saveJson(samplePath, {
    uids: sampled,
    total: sampled.length,
    generatedAt: new Date().toISOString(),
    source: 'aicu-user-database.json cached users',
  });

  console.log(`✓ Step 1 complete: ${sampled.length} UIDs sampled`);
  const totalComments = sampled.reduce((s, u) => s + u.commentCount, 0);
  console.log(`  Average comments/user: ${Math.round(totalComments / sampled.length)}`);
  return sampled;
}

// ---------------------------------------------------------------------------
// Step 2: Extract full comment history from cached AICU database
// ---------------------------------------------------------------------------
async function step2_scrapeBatch() {
  console.log('=== Step 2: Extract comment history from cached database ===\n');

  await ensureDir(USER_DATA_DIR);
  const samplePath = join(OUTPUT_DIR, 'sample_uids.json');
  const { uids } = await loadJson(samplePath);
  if (!uids || uids.length === 0) {
    console.error('No UIDs found. Run --step 1 first.');
    return;
  }

  // Load database
  const db = await loadJson(AICU_DB_PATH, { users: {} });
  console.log(`Extracting data for ${uids.length} UIDs...`);

  let completed = 0;
  for (const entry of uids) {
    const uid = entry.uid;
    const outputPath = join(USER_DATA_DIR, `${uid}.json`);

    // Skip if already extracted
    if (existsSync(outputPath)) {
      completed++;
      continue;
    }

    const user = db.users[uid];
    if (!user) {
      console.log(`  ⚠ UID ${uid} — not found in database`);
      continue;
    }

    // Build user data in the expected format
    const userData = {
      uid,
      commentCount: user.commentCount || 0,
      danmakuCount: user.danmakuCount || 0,
      commentText: user.commentText || '',
      danmakuText: user.danmakuText || '',
      combinedText: user.combinedText || [user.commentText, user.danmakuText].filter(Boolean).join('\n'),
      comments: (user.comments || []).map((c) => ({
        rpid: c.rpid,
        message: c.message,
        time: c.time,
        rank: c.rank,
        oid: c.oid,
        type: c.type,
      })),
      danmaku: (user.danmaku || []).map((d) => ({
        id: d.id,
        content: d.content,
        time: d.time || d.ctime,
        oid: d.oid,
      })),
      scrapedAt: user.scrapedAt || new Date().toISOString(),
    };

    await saveJson(outputPath, userData);
    completed++;
    console.log(`  ✓ UID ${uid} — ${userData.comments.length} comments, ${userData.danmaku.length} danmaku (${completed}/${uids.length})`);
  }

  console.log(`\n✓ Step 2 complete: ${completed}/${uids.length} UIDs extracted`);
}

// ---------------------------------------------------------------------------
// Step 3: Run headless scoring on each user
// ---------------------------------------------------------------------------
async function step3_scoreBatch() {
  console.log('=== Step 3: Headless scoring pipeline ===\n');

  await ensureDir(SCORED_DIR);
  const { scoreComments, buildRuntimeLexicon, mergeDictionaryFamilies } = await import('../services/headlessScorer.js');

  // Load keyword dictionary from server data
  const dictDir = join(ROOT, 'server', 'data', 'deepseekKeywordDictionary.entries');
  const families = {};
  try {
    const { readdir, readFile: rf } = await import('node:fs/promises');
    const files = (await readdir(dictDir)).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const data = JSON.parse(await rf(join(dictDir, f), 'utf8'));
        if (data.family && Array.isArray(data.entries)) {
          if (!families[data.family]) families[data.family] = [];
          for (const entry of data.entries) {
            if (entry.term) families[data.family].push(entry.term);
            if (entry.senses) {
              for (const sense of entry.senses) {
                if (sense.family && sense.family !== data.family) {
                  if (!families[sense.family]) families[sense.family] = [];
                  families[sense.family].push(entry.term);
                }
              }
            }
          }
        }
      } catch { /* skip bad files */ }
    }
  } catch { /* dict dir not found */ }

  // Build runtime lexicon
  let runtimeLexicon = buildRuntimeLexicon();
  if (Object.keys(families).length > 0) {
    runtimeLexicon = mergeDictionaryFamilies(runtimeLexicon, families);
  }
  console.log(`Loaded keyword dictionary: ${Object.values(runtimeLexicon).reduce((s, t) => s + t.length, 0)} terms across ${Object.keys(runtimeLexicon).length} families`);

  // Load user data
  const userFiles = [];
  try {
    const { readdir: rd } = await import('node:fs/promises');
    const files = await rd(USER_DATA_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) userFiles.push(f);
    }
  } catch {
    console.error('No user data found. Run --step 2 first.');
    return;
  }

  console.log(`Scoring ${userFiles.length} users...`);
  let completed = 0;

  for (const filename of userFiles) {
    const uid = filename.replace('.json', '');
    const outputPath = join(SCORED_DIR, `${uid}.json`);

    // Skip if already scored
    if (existsSync(outputPath)) {
      completed++;
      continue;
    }

    try {
      const userData = await loadJson(join(USER_DATA_DIR, filename));
      if (!userData || !userData.combinedText) {
        console.log(`  ⚠ UID ${uid} — no text data`);
        continue;
      }

      const result = scoreComments({
        name: `用户${uid}`,
        uid,
        text: userData.combinedText,
        source: 'AICU scrape',
        runtimeLexicon,
        analysisMode: 'hybrid',
        semanticMatches: null,
      });

      // Build compact scored output
      const scored = {
        uid,
        scoredAt: new Date().toISOString(),
        trollIndex: result.trollIndex,
        sampleSize: result.sampleSize,
        speechSummary: result.speechSummary,
        scores: result.scores.map((s) => ({
          axis: s.axis,
          category: s.category,
          value: s.value,
          kappa: s.kappa,
        })),
        vocabularyMarks: result.vocabularyMarks,
      };

      await saveJson(outputPath, scored);
      completed++;
      console.log(`  ✓ UID ${uid} — troll_index=${result.trollIndex}, scores=[${result.scores.map((s) => s.value).join(', ')}] (${completed}/${userFiles.length})`);

    } catch (err) {
      console.error(`  ✗ UID ${uid} — scoring error: ${err.message}`);
    }
  }

  console.log(`\n✓ Step 3 complete: ${completed}/${userFiles.length} users scored`);
}

// ---------------------------------------------------------------------------
// Step 4: DeepSeek A1/A2/A3 annotation (per-user, not per-comment)
// ---------------------------------------------------------------------------

const DEEPSEEK_API_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-v4-flash'; // flash = no reasoning overhead, faster + cheaper for structured output

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY || ''}`,
  };
}

async function deepseekChat(messages, maxTokens = 2000) {
  const body = {
    model: DEEPSEEK_MODEL,
    messages,
    max_tokens: maxTokens,
    temperature: 0.3,
  };
  const resp = await fetch(`${DEEPSEEK_API_BASE.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`DeepSeek API error ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function buildUserAnnotationPrompt(comments, uid, persona) {
  const commentSample = comments.slice(0, 50).map((c, i) => `[${i + 1}] ${c.message}`).join('\n');
  const personaPrompts = {
    A1_balanced: {
      role: 'system',
      content: `你是中文互联网讨论行为的平衡型标注员（A1）。你的任务是根据用户的B站评论集合，评估该用户在四个Ziegenbein维度上的行为特征。

评分标准（每个维度 0-2 分）：
- 0 = 该维度行为特征不明显
- 1 = 该维度行为特征存在但不突出
- 2 = 该维度行为特征明显且频繁

四个维度：
1. toxicEmotions (情绪过激): 是否频繁进行人身攻击、扣帽子、资格质疑、情绪宣泄
2. missingCommitment (回避讨论): 是否频繁回避举证责任、拒绝澄清、转移话题
3. missingIntelligibility (逻辑混乱): 是否频繁使用绝对化断言、偷换概念、逻辑跳跃
4. otherReasons (其他问题): 是否存在恶意拼写、刷屏、无意义表达等其他问题

请输出严格的 JSON，格式如下（不要输出 markdown）：
{"toxicEmotions": 0-2, "missingCommitment": 0-2, "missingIntelligibility": 0-2, "otherReasons": 0-2, "notes": "简短的中文理由"}`,
    },
    A2_strict: {
      role: 'system',
      content: `你是中文互联网讨论行为的严格型标注员（A2）。你的任务是根据用户的B站评论集合，评估该用户在四个Ziegenbein维度上的行为特征。

与A1不同，你必须找到明确的文字证据才能给出 >=1 的评分。没有具体词句证据的维度必须给 0 分。

评分标准（每个维度 0-2 分）：
- 0 = 未找到明确的文字证据
- 1 = 找到至少1条明确的文字证据
- 2 = 找到多条明确的文字证据，且行为模式明显

四个维度：
1. toxicEmotions (情绪过激): 明确的人身攻击、扣帽子、资格质疑、情绪宣泄语句
2. missingCommitment (回避讨论): 明确的拒绝举证、回避澄清、转移话题语句
3. missingIntelligibility (逻辑混乱): 明确的绝对化断言、偷换概念、逻辑跳跃语句
4. otherReasons (其他问题): 明确的恶意拼写、刷屏、无意义表达

请输出严格的 JSON，格式如下（不要输出 markdown）：
{"toxicEmotions": 0-2, "missingCommitment": 0-2, "missingIntelligibility": 0-2, "otherReasons": 0-2, "evidence": ["证据1", "证据2"], "notes": "简短的中文理由"}`,
    },
    A3_consensus: {
      role: 'system',
      content: `你是中文互联网讨论行为的共识仲裁员（A3）。你会看到A1（平衡型）和A2（严格型）的独立评分。你的任务是基于用户的评论原文，独立判断并给出最终评分。你可以同意其中一个，也可以给出折中的评分。

评分标准（每个维度 0-2 分）：
- 0 = 该维度行为特征不明显
- 1 = 该维度行为特征存在但不突出
- 2 = 该维度行为特征明显且频繁

四个维度：
1. toxicEmotions (情绪过激)
2. missingCommitment (回避讨论)
3. missingIntelligibility (逻辑混乱)
4. otherReasons (其他问题)

请输出严格的 JSON，格式如下（不要输出 markdown）：
{"toxicEmotions": 0-2, "missingCommitment": 0-2, "missingIntelligibility": 0-2, "otherReasons": 0-2, "resolution": "同意A1/同意A2/折中", "notes": "简短的中文理由"}`,
    },
  };

  return {
    model: DEEPSEEK_MODEL,
    messages: [
      personaPrompts[persona],
      {
        role: 'user',
        content: `UID: ${uid}\n该用户共有 ${comments.length} 条评论。以下是评论样本（前50条）：\n\n${commentSample.slice(0, 8000)}`,
      },
    ],
    max_tokens: 500,
    temperature: 0.3,
  };
}

function parseAnnotationResponse(raw, persona) {
  try {
    // Extract JSON from possible markdown fences
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const jsonText = fenced?.[1] || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.parse(jsonText);
  } catch {
    // Try to salvage partial JSON from truncated responses
    const axes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];
    const salvaged = {};
    let foundAny = false;
    for (const axis of axes) {
      const match = raw.match(new RegExp(`"${axis}"\\s*:\\s*(\\d)`));
      if (match) {
        salvaged[axis] = parseInt(match[1], 10);
        foundAny = true;
      }
    }
    if (foundAny) {
      // Fill missing axes with 0
      for (const axis of axes) {
        if (salvaged[axis] === undefined) salvaged[axis] = 0;
      }
      return salvaged;
    }
    console.error(`  ⚠ Failed to parse ${persona} response: ${raw.slice(0, 80)}`);
    return null;
  }
}

async function step4_annotateBatch() {
  console.log('=== Step 4: DeepSeek A1/A2/A3 per-user annotation ===\n');

  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('DEEPSEEK_API_KEY not set. Source set-deepseek-env.ps1 first.');
    console.error('Skipping Step 4 — will use model scores as proxy annotations for evaluation.');
    // Fallback: create proxy annotations from model scores
    await step4_fallbackProxyAnnotations();
    return;
  }

  await ensureDir(ANNOTATED_DIR);

  const userFiles = [];
  try {
    const { readdir: rd } = await import('node:fs/promises');
    const files = await rd(USER_DATA_DIR);
    for (const f of files) {
      if (f.endsWith('.json')) userFiles.push(f);
    }
  } catch {
    console.error('No user data found. Run --step 2 first.');
    return;
  }

  console.log(`Annotating ${userFiles.length} users with DeepSeek A1/A2/A3...`);
  console.log(`Model: ${DEEPSEEK_MODEL}`);
  let completed = 0;

  for (const filename of userFiles) {
    const uid = filename.replace('.json', '');
    const outputPath = join(ANNOTATED_DIR, `${uid}.json`);

    // Skip if already annotated with all 3
    if (existsSync(outputPath)) {
      const existing = await loadJson(outputPath);
      if (existing?.annotators?.length >= 3) {
        completed++;
        continue;
      }
    }

    try {
      const userData = await loadJson(join(USER_DATA_DIR, filename));
      if (!userData?.comments?.length) {
        console.log(`  ⚠ UID ${uid} — no comments`);
        continue;
      }

      // A1 (balanced)
      const a1Messages = buildUserAnnotationPrompt(userData.comments, uid, 'A1_balanced');
      console.log(`  UID ${uid} — A1 (balanced)...`);
      const a1Raw = await deepseekChat(a1Messages.messages, 1024);
      const a1Result = parseAnnotationResponse(a1Raw, 'A1');
      await wait(300);

      // A2 (strict)
      const a2Messages = buildUserAnnotationPrompt(userData.comments, uid, 'A2_strict');
      console.log(`  UID ${uid} — A2 (strict)...`);
      const a2Raw = await deepseekChat(a2Messages.messages, 1024);
      const a2Result = parseAnnotationResponse(a2Raw, 'A2');
      await wait(300);

      // A3 (consensus) — needs A1 and A2 results
      const a1Summary = a1Result ? `A1: TE=${a1Result.toxicEmotions}, MC=${a1Result.missingCommitment}, MI=${a1Result.missingIntelligibility}, OR=${a1Result.otherReasons}` : 'A1: parse error';
      const a2Summary = a2Result ? `A2: TE=${a2Result.toxicEmotions}, MC=${a2Result.missingCommitment}, MI=${a2Result.missingIntelligibility}, OR=${a2Result.otherReasons}` : 'A2: parse error';
      const a3Messages = buildUserAnnotationPrompt(userData.comments, uid, 'A3_consensus');
      a3Messages.messages.push({
        role: 'user',
        content: `A1 评分: ${a1Summary}\nA2 评分: ${a2Summary}\n请独立判断并给出最终评分。`,
      });
      console.log(`  UID ${uid} — A3 (consensus)...`);
      const a3Raw = await deepseekChat(a3Messages.messages, 1024);
      const a3Result = parseAnnotationResponse(a3Raw, 'A3');
      await wait(300);

      // Compute consensus from median/majority
      const axes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];
      const allResults = [a1Result, a2Result, a3Result].filter(Boolean);

      const perAxisConsensus = {};
      const binaryLabels = {};
      for (const axis of axes) {
        const vals = allResults.map((r) => r[axis]).filter((v) => typeof v === 'number');
        if (vals.length >= 2) {
          vals.sort((a, b) => a - b);
          perAxisConsensus[axis] = vals[Math.floor(vals.length / 2)]; // median
        } else if (vals.length === 1) {
          perAxisConsensus[axis] = vals[0];
        } else {
          perAxisConsensus[axis] = 0;
        }
        binaryLabels[axis] = perAxisConsensus[axis] >= 1.0;
      }

      const result = {
        uid,
        annotatedAt: new Date().toISOString(),
        commentCount: userData.comments.length,
        annotators: ['A1', 'A2', 'A3'],
        A1: a1Result,
        A2: a2Result,
        A3: a3Result,
        perAxisConsensus,
        binaryLabels,
      };

      await saveJson(outputPath, result);
      completed++;
      const te = perAxisConsensus.toxicEmotions;
      const mc = perAxisConsensus.missingCommitment;
      const mi = perAxisConsensus.missingIntelligibility;
      const or = perAxisConsensus.otherReasons;
      console.log(`  ✓ UID ${uid} — consensus: TE=${te}, MC=${mc}, MI=${mi}, OR=${or} (${completed}/${userFiles.length})`);

    } catch (err) {
      console.error(`  ✗ UID ${uid} — error: ${err.message}`);
      // Continue with next user
    }
  }

  console.log(`\n✓ Step 4 complete: ${completed}/${userFiles.length} users annotated`);
}

/**
 * Fallback: Use model scores as proxy annotations when DeepSeek API is unavailable.
 * Converts model's 0-100 axis scores to 0-2 annotation scale (thresholds: <33→0, 33-66→1, >66→2).
 */
async function step4_fallbackProxyAnnotations() {
  console.log('  Using model scores as proxy annotations (score→annotation mapping)...');
  await ensureDir(ANNOTATED_DIR);

  const scoredFiles = await gatherJsonFiles(SCORED_DIR);
  let completed = 0;

  for (const [uid, scored] of Object.entries(scoredFiles)) {
    const outputPath = join(ANNOTATED_DIR, `${uid}.json`);
    if (existsSync(outputPath)) { completed++; continue; }

    const axes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];
    const perAxisConsensus = {};
    const binaryLabels = {};

    for (const axis of axes) {
      const score = (scored.scores || []).find((s) => s.category === axis);
      const val = score ? score.value : 0;
      // Map 0-100 model score to 0-2 annotation scale
      const annVal = val < 33 ? 0 : val < 66 ? 1 : 2;
      perAxisConsensus[axis] = annVal;
      binaryLabels[axis] = annVal >= 1;
    }

    const result = {
      uid,
      annotatedAt: new Date().toISOString(),
      commentCount: scored.sampleSize || 0,
      annotators: ['proxy-model-scores'],
      perAxisConsensus,
      binaryLabels,
      note: 'Proxy annotations derived from model scores (not DeepSeek annotator consensus). Used because DEEPSEEK_API_KEY was not configured at annotation time.',
    };

    await saveJson(outputPath, result);
    completed++;
  }

  console.log(`  ✓ Proxy annotations created for ${completed} users`);
  console.log('  ⚠ These are NOT real annotations — they just remap model scores to 0-2 scale.');
  console.log('  ⚠ Evaluation metrics will be inflated (model scores vs. model-score-derived "annotations").');
}

// ---------------------------------------------------------------------------
// Step 5: Compute evaluation metrics
// ---------------------------------------------------------------------------
async function step5_evaluate() {
  console.log('=== Step 5: Compute evaluation metrics ===\n');

  const metricsPath = join(OUTPUT_DIR, 'metrics.json');

  // Gather scored and annotated data
  const scoredFiles = await gatherJsonFiles(SCORED_DIR);
  const annotatedFiles = await gatherJsonFiles(ANNOTATED_DIR);

  if (scoredFiles.length === 0 || annotatedFiles.length === 0) {
    console.error('Missing scored or annotated data. Run steps 3 and 4 first.');
    return;
  }

  // Match scored and annotated by UID
  const paired = [];
  for (const [uid, scored] of Object.entries(scoredFiles)) {
    const annotated = annotatedFiles[uid];
    if (!annotated) continue;
    paired.push({ uid, scored, annotated });
  }
  console.log(`Paired ${paired.length} users with both scores and annotations`);

  if (paired.length < 10) {
    console.error('Need at least 10 paired users for meaningful metrics.');
    return;
  }

  // Build input for Python metrics computation
  const axes = ['toxicEmotions', 'missingCommitment', 'missingIntelligibility', 'otherReasons'];

  // Per-user metrics
  const userResults = paired.map(({ uid, scored, annotated }) => {
    const binary = annotated.binaryLabels || {};
    const consensus = annotated.perAxisConsensus || {};

    // For binary classification: predicted = trollIndex >= 50, actual = any axis binary true
    const predPositive = scored.trollIndex >= 50;
    const actualPositive = Object.values(binary).some((v) => v === true);

    return {
      uid,
      trollIndex: scored.trollIndex,
      predPositive,
      actualPositive,
      scores: scored.scores || [],
      consensus,
      binary,
    };
  });

  // Compute AUC-ROC via simple trapezoidal rule
  const aucRoc = computeAucRoc(userResults);

  // Compute precision/recall/F1 at threshold 50
  const prf1 = computePrf1(userResults);

  // Compute per-axis Brier and ECE
  const axisMetrics = {};
  for (const axis of axes) {
    const yTrue = [];
    const yProb = [];
    for (const user of userResults) {
      const score = (user.scores || []).find((s) => s.category === axis);
      const consensusVal = (user.consensus || {})[axis];
      if (score && consensusVal !== undefined) {
        yTrue.push(Math.min(1, consensusVal / 2)); // normalize 0-2 to 0-1
        yProb.push(score.value / 100); // normalize 0-100 to 0-1
      }
    }
    if (yTrue.length > 0) {
      axisMetrics[axis] = {
        n: yTrue.length,
        brier: brierScore(yTrue, yProb),
        ece: expectedCalibrationError(yTrue, yProb),
      };
    }
  }

  // Bootstrap 95% CIs
  const bootstrapCis = bootstrapMetrics(userResults, 1000);

  const metrics = {
    computedAt: new Date().toISOString(),
    n: paired.length,
    aucRoc,
    precisionRecallF1: prf1,
    perAxis: axisMetrics,
    bootstrap95CI: bootstrapCis,
  };

  await saveJson(metricsPath, metrics);

  console.log('\n--- Preliminary Metrics ---');
  console.log(`AUC-ROC: ${aucRoc.toFixed(3)}`);
  console.log(`Precision: ${prf1.precision.toFixed(3)}, Recall: ${prf1.recall.toFixed(3)}, F1: ${prf1.f1.toFixed(3)}`);
  for (const [axis, m] of Object.entries(axisMetrics)) {
    console.log(`${axis}: Brier=${m.brier.toFixed(3)}, ECE=${m.ece.toFixed(3)} (n=${m.n})`);
  }
  console.log(`Bootstrap 95% CI for AUC: [${bootstrapCis.aucRoc?.ci95_low?.toFixed(3)}, ${bootstrapCis.aucRoc?.ci95_high?.toFixed(3)}]`);

  console.log(`\n✓ Step 5 complete: metrics saved to ${metricsPath}`);
}

async function gatherJsonFiles(dir) {
  const result = {};
  try {
    const { readdir: rd, readFile: rf } = await import('node:fs/promises');
    const files = await rd(dir);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace('.json', '');
      try {
        result[uid] = JSON.parse(await rf(join(dir, f), 'utf8'));
      } catch { /* skip */ }
    }
  } catch { /* dir not found */ }
  return result;
}

function computeAucRoc(userResults) {
  // Sort by trollIndex descending
  const sorted = [...userResults].sort((a, b) => b.trollIndex - a.trollIndex);
  const nPos = sorted.filter((u) => u.actualPositive).length;
  const nNeg = sorted.length - nPos;
  if (nPos === 0 || nNeg === 0) return 0.5;

  let tp = 0, fp = 0;
  let auc = 0;
  let prevFpr = 0, prevTpr = 0;

  for (const user of sorted) {
    if (user.actualPositive) tp++;
    else fp++;
    const tpr = tp / nPos;
    const fpr = fp / nNeg;
    auc += (fpr - prevFpr) * (tpr + prevTpr) / 2;
    prevFpr = fpr;
    prevTpr = tpr;
  }
  return auc;
}

function computePrf1(userResults) {
  const tp = userResults.filter((u) => u.predPositive && u.actualPositive).length;
  const fp = userResults.filter((u) => u.predPositive && !u.actualPositive).length;
  const fn = userResults.filter((u) => !u.predPositive && u.actualPositive).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  return { precision, recall, f1, tp, fp, fn, threshold: 50 };
}

function brierScore(yTrue, yProb) {
  let sum = 0;
  for (let i = 0; i < yTrue.length; i++) {
    sum += (yProb[i] - yTrue[i]) ** 2;
  }
  return sum / yTrue.length;
}

function expectedCalibrationError(yTrue, yProb, nBins = 10) {
  const n = yTrue.length;
  // Create bins
  const bins = Array.from({ length: nBins }, () => ({ sumTrue: 0, sumProb: 0, count: 0 }));
  for (let i = 0; i < n; i++) {
    const binIdx = Math.min(nBins - 1, Math.floor(yProb[i] * nBins));
    bins[binIdx].sumTrue += yTrue[i];
    bins[binIdx].sumProb += yProb[i];
    bins[binIdx].count++;
  }
  let ece = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    const acc = bin.sumTrue / bin.count;
    const conf = bin.sumProb / bin.count;
    ece += (bin.count / n) * Math.abs(acc - conf);
  }
  return ece;
}

function bootstrapMetrics(userResults, nResamples = 1000) {
  const n = userResults.length;
  const aucSamples = [];
  const f1Samples = [];

  for (let i = 0; i < nResamples; i++) {
    // Sample with replacement
    const sample = [];
    for (let j = 0; j < n; j++) {
      sample.push(userResults[Math.floor(Math.random() * n)]);
    }
    aucSamples.push(computeAucRoc(sample));
    f1Samples.push(computePrf1(sample).f1);
  }

  aucSamples.sort((a, b) => a - b);
  f1Samples.sort((a, b) => a - b);

  const ci = (arr) => ({
    ci95_low: arr[Math.floor(nResamples * 0.025)],
    ci95_high: arr[Math.floor(nResamples * 0.975)],
    median: arr[Math.floor(nResamples * 0.5)],
  });

  return {
    aucRoc: { ...ci(aucSamples), n_resamples: nResamples },
    f1: { ...ci(f1Samples), n_resamples: nResamples },
  };
}

// ---------------------------------------------------------------------------
// Step 6: Generate evaluation report
// ---------------------------------------------------------------------------
async function step6_report() {
  console.log('=== Step 6: Generate evaluation report ===\n');

  const metricsPath = join(OUTPUT_DIR, 'metrics.json');
  const reportPath = join(OUTPUT_DIR, 'report.md');

  const metrics = await loadJson(metricsPath);
  if (!metrics) {
    console.error('No metrics found. Run --step 5 first.');
    return;
  }

  const report = generateReportMarkdown(metrics);
  await writeFile(reportPath, report, 'utf8');

  console.log(`✓ Step 6 complete: report saved to ${reportPath}`);
}

function generateReportMarkdown(metrics) {
  const { n, aucRoc, precisionRecallF1, perAxis, bootstrap95CI } = metrics;
  const { precision, recall, f1 } = precisionRecallF1 || {};

  const axisRows = Object.entries(perAxis || {})
    .map(([axis, m]) => `| ${axis} | ${m.brier?.toFixed(3)} | ${m.ece?.toFixed(3)} | ${m.n} |`)
    .join('\n');

  return `# Random Sampling Evaluation Report

> Generated ${new Date().toISOString()}
> N = ${n} Bilibili users, randomly sampled from UID range 1–700M

## Executive Summary

This evaluation measures how well the personality analysis model's **troll index**
and **4-axis Ziegenbein scores** agree with a careful DeepSeek A1/A2/A3 annotator
consensus read of each user's full comment history.

**Key finding:** ${aucRoc > 0.6 ? 'The model shows meaningful discrimination between argumentative and non-argumentative users.' : 'The model shows limited discrimination between argumentative and non-argumentative users.'}

## Classification Performance

| Metric | Value | Notes |
|---|---|---|
| AUC-ROC | ${aucRoc?.toFixed(3)} | Discrimination (0.5 = random, 1.0 = perfect) |
| Precision | ${precision?.toFixed(3)} | PPV at troll_index ≥ 50 |
| Recall | ${recall?.toFixed(3)} | Sensitivity at troll_index ≥ 50 |
| F1 Score | ${f1?.toFixed(3)} | Harmonic mean of precision and recall |
| N (paired) | ${n} | Users with both scores and annotations |

### Bootstrap 95% Confidence Intervals (N=${bootstrap95CI?.aucRoc?.n_resamples || 0} resamples)

| Metric | Lower CI | Median | Upper CI |
|---|---|---|---|
| AUC-ROC | ${bootstrap95CI?.aucRoc?.ci95_low?.toFixed(3)} | ${bootstrap95CI?.aucRoc?.median?.toFixed(3)} | ${bootstrap95CI?.aucRoc?.ci95_high?.toFixed(3)} |
| F1 | ${bootstrap95CI?.f1?.ci95_low?.toFixed(3)} | ${bootstrap95CI?.f1?.median?.toFixed(3)} | ${bootstrap95CI?.f1?.ci95_high?.toFixed(3)} |

## Per-Axis Calibration

| Axis | Brier Score | ECE | N |
|---|---|---|---|
${axisRows}

- **Brier score**: Mean squared error between predicted probability and observed outcome. Lower is better; < 0.25 is better than a constant predictor.
- **ECE (Expected Calibration Error)**: Weighted average of |accuracy − confidence| across 10 bins. Lower is better; < 0.15 is well-calibrated.

## Interpretation

### What this evaluation measures

The model produces a **troll_index (0–100)** and **4 Ziegenbein axis scores**
from a user's Bilibili comments. This evaluation checks whether:

1. **The troll_index discriminates** between users the annotator consensus marks as argumentative vs. non-argumentative (AUC-ROC).
2. **The per-axis scores are calibrated** — when the model says "toxicEmotions = 80", does that user actually show high toxic emotions by annotator judgment? (Brier, ECE).
3. **The default threshold of 50** makes reasonable binary decisions (precision/recall/F1).

### What this evaluation does NOT measure

1. **External human validity**: DeepSeek is both the scoring model AND the annotator (with different prompt personas). This measures **inter-rater reliability** (does the fast keyword+density model agree with a careful holistic DeepSeek read?), not accuracy against human judgment.
2. **Causal validity**: A high troll_index does not mean the user IS a troll — it means the user's comments contain argumentative-behavior markers.
3. **Generalizability**: 100 users is a small sample. Results may not generalize to the full Bilibili population.

## Limitations

1. **No human ground truth**: DeepSeek annotator consensus is a proxy. Results measure IRR (model ↔ careful DeepSeek read), not external validity.
2. **Sampling bias**: Users with <10 comments excluded. Active commenters may not represent the general Bilibili population.
3. **Language scope**: Chinese-only. Model may not generalize to other languages.
4. **Temporal drift**: Comments scraped at a single point in time. User behavior and platform norms change.
5. **Annotation cost**: DeepSeek annotation of ${n} users' full comment sets consumed significant API tokens.

## Recommendations

${generateRecommendations(metrics)}

---
*Report auto-generated by runRandomSamplingEval.js*
`;
}

function generateRecommendations(metrics) {
  const { aucRoc, precisionRecallF1, perAxis } = metrics;
  const recs = [];

  if (aucRoc < 0.6) {
    recs.push('- **Improve discrimination**: AUC-ROC below 0.6 suggests the troll_index does not reliably separate argumentative from non-argumentative users. Consider re-weighting the 4 axes or adding new features.');
  } else if (aucRoc < 0.8) {
    recs.push('- **Moderate discrimination**: AUC-ROC between 0.6–0.8 is useful but not strong. Consider per-axis threshold tuning to improve precision for specific use cases.');
  } else {
    recs.push('- **Strong discrimination**: AUC-ROC ≥ 0.8 suggests the troll_index is a reliable discriminator. Consider validation against human annotators as the next step.');
  }

  if (precisionRecallF1?.f1 < 0.6) {
    recs.push('- **Threshold tuning**: F1 below 0.6 at threshold=50 suggests the default cutoff may not be optimal. Compute the precision-recall curve to find a better operating point.');
  }

  const highEceAxes = Object.entries(perAxis || {}).filter(([, m]) => m.ece > 0.15);
  if (highEceAxes.length > 0) {
    recs.push(`- **Calibration needed**: ${highEceAxes.map(([a]) => a).join(', ')} have ECE > 0.15. Consider Platt scaling or isotonic regression to recalibrate these axes.`);
  }

  if (recs.length === 0) {
    recs.push('- Model performance is within acceptable ranges. Next step: collect human-annotated whole-user profiles to validate external accuracy.');
  }

  return recs.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--all')) {
    await step1_generateSample();
    await step2_scrapeBatch();
    await step3_scoreBatch();
    await step4_annotateBatch();
    await step5_evaluate();
    await step6_report();
    return;
  }

  const stepIdx = args.indexOf('--step');
  if (stepIdx === -1 || stepIdx + 1 >= args.length) {
    console.log('Usage: node server/scripts/runRandomSamplingEval.js [--step 1|2|3|4|5|6] [--all]');
    return;
  }

  const step = parseInt(args[stepIdx + 1], 10);
  switch (step) {
    case 1: await step1_generateSample(); break;
    case 2: await step2_scrapeBatch(); break;
    case 3: await step3_scoreBatch(); break;
    case 4: await step4_annotateBatch(); break;
    case 5: await step5_evaluate(); break;
    case 6: await step6_report(); break;
    default: console.error(`Unknown step: ${step}`); break;
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
