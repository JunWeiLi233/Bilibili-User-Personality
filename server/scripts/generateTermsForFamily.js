/**
 * generateTermsForFamily.js
 *
 * Generates 30 Bilibili-specific Chinese terms for a target dictionary family
 * via the DeepSeek API. Reads existing terms to avoid duplicates, calls DeepSeek
 * with a targeted prompt, validates output, and writes a new shard file.
 *
 * Usage:
 *   node server/scripts/generateTermsForFamily.js --family evasion --count 30
 *   node server/scripts/generateTermsForFamily.js --family evidence --count 30
 *   node server/scripts/generateTermsForFamily.js --family correction --count 30
 *
 * Env vars required: DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL (optional), DEEPSEEK_MODEL (optional)
 */

import { readdir, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS } from '../services/deepseekRouter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRIES_DIR = join(__dirname, '..', 'data', 'deepseekKeywordDictionary.entries');

const SUPPORTED_FAMILIES = ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];

const FAMILY_PROMPTS = {
  evasion: `你是一个中文互联网语料库专家，专门收集B站（Bilibili）评论区真实的规避表达。

"evasion"（规避）分类定义：拒绝解释、转移举证责任、用"懂的都懂"等圈内默契代替论证、让他人"自己查"/"自己搜"/"问百度"、懒得解释、回避问题、模糊回应。

请生成30个B站评论区真实出现的、与"规避"语义相关的独特中文词汇/短语/梗/固定话术。

硬性规则：
1. 每个term必须是B站评论区真实使用的连续中文/中英混合表达，2-15字。
2. 禁止输出类别词（如"规避"、"逃避"、"回避"本身）。
3. 禁止输出我下面列出的已有术语。
4. 重点覆盖这些子类型（每种类型至少2-3个新术语）：
   - 拒绝对话类：不想聊、拒绝解释、没兴趣讨论
   - 转移责任类：你自己查、问我干嘛、别问我
   - 模糊/拖延类：再说吧、以后再说、懒得回
   - 梗/谐音/缩写类逃脱话术
5. 每个term提供：term（原文）、meaning（中文语用功能20-80字）、risk（high/medium/low）、confidence（0.0-1.0）
6. 只输出纯JSON，不要markdown：
{"keywords":[{"term":"术语","meaning":"中文含义和语用功能","risk":"high|medium|low","confidence":0.0}]}`,

  evidence: `你是一个中文互联网语料库专家，专门收集B站（Bilibili）评论区真实的证据相关表达。

"evidence"（证据）分类定义：要求或提供来源、数据、证据、可核验材料、引用、出处、链接、参考文献、事实核查。

请生成30个B站评论区真实出现的、与"证据"语义相关的独特中文词汇/短语/梗/固定话术。

硬性规则：
1. 每个term必须是B站评论区真实使用的连续中文/中英混合表达，2-15字。
2. 禁止输出类别词（如"证据"、"来源"、"数据"本身）。
3. 禁止输出我下面列出的已有术语。
4. 重点覆盖这些子类型（每种类型至少2-3个新术语）：
   - 要求来源类：有出处吗、来源在哪、贴出来看看
   - 引用证据类：根据XX数据、官方文档、论文写了
   - 质疑缺少类：没证据别乱说、空口无凭、你有数据吗
   - 数据/统计相关梗和缩写
   - 链接/出处/截图类话术
   - 事实核查/纠正类表达
5. 每个term提供：term（原文）、meaning（中文语用功能20-80字）、risk（high/medium/low）、confidence（0.0-1.0）
6. 只输出纯JSON，不要markdown：
{"keywords":[{"term":"术语","meaning":"中文含义和语用功能","risk":"high|medium|low","confidence":0.0}]}`,

  correction: `你是一个中文互联网语料库专家，专门收集B站（Bilibili）评论区真实的修正/更正表达。

"correction"（修正意愿）分类定义：承认错误、修正自己之前的说法、降低结论强度、收回过度断言、感谢指正、改口、澄清误会。

请生成30个B站评论区真实出现的、与"修正意愿"语义相关的独特中文词汇/短语/梗/固定话术。

硬性规则：
1. 每个term必须是B站评论区真实使用的连续中文/中英混合表达，2-15字。
2. 禁止输出类别词（如"修正"、"更正"、"改口"本身）。
3. 禁止输出我下面列出的已有术语。
4. 重点覆盖这些子类型（每种类型至少2-3个新术语）：
   - 承认错误类：我错了、搞错了、我的锅、是我没说清楚
   - 修正说法类：更正一下、补充说明、更准确地说
   - 降低强度类：没有那么绝对、可能我夸张了、收回XX
   - 感谢纠正类：谢谢指正、感谢提醒、已修改
   - 澄清误会类：我不是那个意思、别误会
   - 补充/完善类：接着补充、另外需要说明
5. 每个term提供：term（原文）、meaning（中文语用功能20-80字）、risk（high/medium/low）、confidence（0.0-1.0）
6. 只输出纯JSON，不要markdown：
{"keywords":[{"term":"术语","meaning":"中文含义和语用功能","risk":"high|medium|low","confidence":0.0}]}`,
};

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--family' && process.argv[i + 1]) {
      args.family = process.argv[i + 1];
      i++;
    } else if (process.argv[i] === '--count' && process.argv[i + 1]) {
      args.count = Number(process.argv[i + 1]);
      i++;
    }
  }
  return args;
}

async function loadExistingTerms(family) {
  const terms = new Set();
  try {
    const files = await readdir(ENTRIES_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      if (!file.startsWith(family + '-')) continue;
      const data = JSON.parse(await import('node:fs/promises').then(m => m.readFile(join(ENTRIES_DIR, file), 'utf-8')));
      const entries = data.entries || [];
      for (const e of entries) {
        const t = String(e.term || '').trim();
        if (t) terms.add(t);
      }
    }
  } catch (err) {
    console.error('Warning: could not read existing terms:', err.message);
  }
  return terms;
}

async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set');

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const model = process.env.DEEPSEEK_MODEL || MODELS.V4_PRO;

  const body = {
    model,
    messages: [
      { role: 'system', content: '你是中文互联网语料库专家。只输出合法JSON，不要markdown。' },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    stream: false,
    max_tokens: 8000,
    temperature: 0.8,
  };

  let resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`DeepSeek API error ${resp.status}: ${errText.slice(0, 500)}`);
  }

  let data = await resp.json();
  let content = data?.choices?.[0]?.message?.content || '';

  // If content is empty or appears truncated (JSON doesn't close), retry without response_format
  if (!content.trim() || !content.trim().endsWith('}')) {
    console.log('Response appears truncated or empty, retrying without response_format...');
    const retryBody = {
      ...body,
      response_format: undefined,
      max_tokens: 8000,
      messages: [
        ...body.messages,
        {
          role: 'user',
          content: '请继续输出完整的JSON，不要截断。确保JSON以}结尾。',
        },
      ],
    };
    const retryResp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(retryBody),
    });
    if (!retryResp.ok) {
      const errText = await retryResp.text();
      throw new Error(`DeepSeek API retry error ${retryResp.status}: ${errText.slice(0, 500)}`);
    }
    const retryData = await retryResp.json();
    const retryContent = retryData?.choices?.[0]?.message?.content || '';
    // If retry content starts with }, it's a continuation
    if (retryContent.trim().startsWith('}')) {
      content = content.trim() + '\n' + retryContent.trim();
    } else {
      content = content.trim() || retryContent.trim();
    }
  }

  return content;
}

function extractJson(text) {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  // Remove BOM if present
  if (cleaned.charCodeAt(0) === 0xFEFF) cleaned = cleaned.slice(1);
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/, '');
    cleaned = cleaned.trim();
  }
  // Try to find the JSON object boundaries if the response has extra text
  const objStart = cleaned.indexOf('{');
  const objEnd = cleaned.lastIndexOf('}');
  if (objStart !== -1 && objEnd > objStart) {
    cleaned = cleaned.slice(objStart, objEnd + 1);
  }
  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    // Try to fix common issues: trailing commas, unescaped chars
    try {
      const fixed = cleaned.replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']');
      return JSON.parse(fixed);
    } catch (secondError) {
      throw new Error(`JSON parse failed. First error: ${firstError.message}. Content preview: ${cleaned.slice(0, 300)}...`);
    }
  }
}

function validateEntry(entry, existingTerms) {
  const term = String(entry.term || '').trim();
  if (!term) return { valid: false, reason: 'empty term' };
  if (term.length < 2) return { valid: false, reason: `term too short: "${term}"` };
  if (term.length > 20) return { valid: false, reason: `term too long: "${term}"` };
  if (existingTerms.has(term)) return { valid: false, reason: `duplicate: "${term}"` };
  // Reject category words
  const categoryWords = ['规避', '逃避', '回避', '证据', '来源', '数据', '修正', '更正', '改口', '攻击', '关键词', '分类'];
  if (categoryWords.includes(term)) return { valid: false, reason: `category word: "${term}"` };
  const meaning = String(entry.meaning || '').trim();
  if (meaning.length < 5) return { valid: false, reason: `meaning too short for "${term}"` };
  return { valid: true };
}

async function main() {
  const args = parseArgs();
  const family = args.family;
  const targetCount = args.count || 30;

  if (!family || !SUPPORTED_FAMILIES.includes(family)) {
    console.error(`Usage: node generateTermsForFamily.js --family <${SUPPORTED_FAMILIES.join('|')}> --count <N>`);
    console.error(`  Unknown family: ${family}`);
    process.exit(1);
  }

  if (!FAMILY_PROMPTS[family]) {
    console.error(`No prompt template for family: ${family}`);
    process.exit(1);
  }

  console.log(`\n=== Generating ${targetCount} new terms for family: ${family} ===\n`);

  // 1. Load existing terms
  const existingTerms = await loadExistingTerms(family);
  console.log(`Existing terms for ${family}: ${existingTerms.size}`);

  // 2. Build prompt with existing terms
  const existingList = [...existingTerms].sort().join('、');
  const basePrompt = FAMILY_PROMPTS[family];
  const prompt = `${basePrompt}\n\n已有术语（禁止重复输出）：\n${existingList || '（暂无已有术语）'}\n\n请生成${targetCount}个全新的、不在上述已有列表中的术语。总数应接近${targetCount}个。`;

  // 3. Call DeepSeek
  console.log(`Calling DeepSeek API (model: ${process.env.DEEPSEEK_MODEL || MODELS.V4_PRO})...`);
  let raw;
  try {
    raw = await callDeepSeek(prompt);
  } catch (err) {
    console.error('DeepSeek API call failed:', err.message);
    process.exit(1);
  }

  // 4. Parse and validate
  let parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    console.error('Failed to parse JSON response. Raw output (first 500 chars):');
    console.error(raw.slice(0, 500));
    process.exit(1);
  }

  const keywords = parsed.keywords || parsed.terms || [];
  if (!Array.isArray(keywords)) {
    console.error('Response does not contain keywords array. Keys:', Object.keys(parsed));
    process.exit(1);
  }

  // 5. Validate and filter
  const validEntries = [];
  const rejected = [];
  for (const kw of keywords) {
    const result = validateEntry(kw, existingTerms);
    if (result.valid) {
      validEntries.push({
        term: String(kw.term || '').trim(),
        family,
        meaning: String(kw.meaning || '').trim(),
        risk: kw.risk || 'medium',
        confidence: Number(kw.confidence) || 0.6,
        evidenceCount: 0,
        updatedAt: new Date().toISOString(),
      });
    } else {
      rejected.push({ entry: kw.term, reason: result.reason });
    }
  }

  console.log(`\nValid entries: ${validEntries.length}`);
  console.log(`Rejected: ${rejected.length}`);
  if (rejected.length > 0) {
    for (const r of rejected.slice(0, 10)) {
      console.log(`  - "${r.entry}": ${r.reason}`);
    }
  }

  if (validEntries.length === 0) {
    console.error('\nNo valid entries generated. Exiting.');
    process.exit(1);
  }

  // 6. Determine next shard number
  let maxShard = 0;
  try {
    const files = await readdir(ENTRIES_DIR);
    for (const f of files) {
      const safeFamily = family.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      const m = f.match(new RegExp(`^${safeFamily}-(\\d+)\\.json$`));
      if (m) maxShard = Math.max(maxShard, Number(m[1]));
    }
  } catch {}
  const nextShard = String(maxShard + 1).padStart(3, '0');
  const shardPath = join(ENTRIES_DIR, `${family}-${nextShard}.json`);

  // 7. Write shard file
  const shardData = {
    version: 1,
    updatedAt: new Date().toISOString(),
    family,
    shard: `${family}-${nextShard}`,
    shardCount: maxShard + 1,
    entries: validEntries,
  };

  await writeFile(shardPath, JSON.stringify(shardData, null, 2), 'utf-8');
  console.log(`\n✅ Written ${validEntries.length} entries to: ${shardPath}`);

  const newTotal = existingTerms.size + validEntries.length;
  console.log(`📊 New total for ${family}: ~${newTotal} terms (${existingTerms.size} existing + ${validEntries.length} new)`);

  // Print the new terms
  console.log(`\nNew ${family} terms:`);
  for (const e of validEntries) {
    console.log(`  - ${e.term} [${e.risk}] ${e.meaning.slice(0, 60)}...`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
