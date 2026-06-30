/**
 * Generate Chinese internet argot/slang keyword terms using DeepSeek's knowledge.
 * This bypasses the corpus bottleneck by asking DeepSeek to recall known terms.
 * Usage: node .claude/generate_terms_deepseek.js
 *   FAMILY=attack node .claude/generate_terms_deepseek.js  # single family
 *   BATCH_SIZE=50 node .claude/generate_terms_deepseek.js
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_GENERATE_MODEL || 'deepseek-v4-flash';

if (!DEEPSEEK_API_KEY) {
  console.error('Set DEEPSEEK_API_KEY environment variable');
  process.exit(1);
}

const TARGET_FAMILY = process.env.FAMILY || null;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '80', 10);
const WRITE_MODE = process.env.WRITE === '1';
const REPORT_PATH = join(PROJECT_ROOT, 'server', 'data', 'generatedTermsReport.json');

const FAMILY_DESCRIPTIONS = {
  attack: '讽刺、阴阳怪气、资格审查、阵营/动机攻击、侮辱性梗。例如：典中典、急了、绷不住、赢麻了、阴阳怪气、懂哥、小丑、逆天、闹麻了、唐、猪鼻、破防',
  absolutes: '绝对化、全称化、没有例外的强断言。例如：全是、全都、根本没有、没有一个、必然、绝对、肯定是、毫无疑问、毋庸置疑、众所周知、百分百',
  evidence: '来源、数据、证据、可核验材料相关词。例如：数据来源、有数据吗、来源呢、出处在哪、上链接、发链接、张口就来、无图无真相、信源、查查资料',
  evasion: '懂的都懂、自己搜、拒绝解释、转移举证责任。例如：懂的都懂、你自己搜、自己查、不会百度、懒得解释、问百度、这还用说、常识、这都不知道',
  cooperation: '可能、限定、澄清、愿意看来源、合作讨论。例如：有一说一、确实、我是觉得、我认为、我觉得、应该、也许、大概、或许、仅供参考、个人看法、有一说一',
  correction: '我错了、说重了、更正、修正、降低结论强度。例如：前面说重了、我说重了、说错了、更正一下、我收回、前面说错了、补充一点、纠正一下',
};

const FAMILIES = TARGET_FAMILY ? [TARGET_FAMILY] : ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];

async function deepseekChat(messages) {
  const response = await fetch(`${DEEPSEEK_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages,
      response_format: { type: 'json_object' },
      max_tokens: 4000,
      stream: false,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`DeepSeek API ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function generateTermsForFamily(family, batchIndex = 0) {
  const description = FAMILY_DESCRIPTIONS[family] || family;

  const systemPrompt = `你是中文互联网论辩行为关键词专家。你精通B站、知乎、贴吧、抖音等平台的网络表达、梗、缩写和谐音。你需要生成大量具有论辩行为分析价值的中文互联网关键词。`;

  const userPrompt = `请生成一批"${family}"族的论辩行为关键词。

族定义：${description}

要求：
1. 生成 ${BATCH_SIZE} 个不同的关键词，优先生成未见于常见词表中的新颖表达
2. 每个term必须是2-12字的真实中文互联网表达（可以是梗、缩写、谐音、固定话术）
3. 优先B站评论区常见表达
4. 每个词标注meaning（中文语用功能说明，15-40字）
5. risk标注：positive（合作/修正类）、medium（一般争议类）、high（强烈攻击类）
6. 要求JSON格式：{"terms":[{"term":"词","meaning":"含义","risk":"high|medium|positive","confidence":0.7}]}

示例输出：
{"terms":[{"term":"典中典","meaning":"用反讽指出对方言论过于典型或可笑","risk":"medium","confidence":0.85},{"term":"有一说一","meaning":"表示客观公正态度，铺垫后续观点","risk":"positive","confidence":0.82}]}

请只输出JSON对象，不要markdown格式化。重要：至少输出${BATCH_SIZE}个不同的term。`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await deepseekChat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.terms && Array.isArray(parsed.terms)) {
        const terms = parsed.terms
          .filter(t => t.term && t.term.length >= 2 && t.term.length <= 12)
          .map(t => ({
            term: t.term,
            family,
            meaning: String(t.meaning || '').trim(),
            risk: String(t.risk || 'medium').trim(),
            confidence: Number(t.confidence) || 0.7,
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          }));

        if (terms.length > 0) {
          return { family, terms, batchIndex, raw: cleaned };
        }
      }
      console.warn(`  Attempt ${attempt + 1}: empty terms, retrying...`);
    } catch (err) {
      console.warn(`  Attempt ${attempt + 1} error: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return { family, terms: [], batchIndex };
}

async function main() {
  console.log(`Generating terms for families: ${FAMILIES.join(', ')}`);
  console.log(`Model: ${DEEPSEEK_MODEL}, Batch size: ${BATCH_SIZE}`);
  console.log(`Write mode: ${WRITE_MODE ? 'ON' : 'DRY RUN'}\n`);

  const allResults = [];
  let totalTerms = 0;

  for (const family of FAMILIES) {
    console.log(`\n=== Family: ${family} ===`);
    const batches = family === 'attack' || family === 'cooperation' ? 3 : 2;

    for (let bi = 0; bi < batches; bi++) {
      console.log(`  Batch ${bi + 1}/${batches}...`);
      const result = await generateTermsForFamily(family, bi);
      allResults.push(result);
      const uniqueTerms = [...new Set(result.terms.map(t => t.term))];
      totalTerms += uniqueTerms.length;
      console.log(`  → ${uniqueTerms.length} unique terms (total: ${totalTerms})`);

      if (bi < batches - 1) {
        await new Promise(r => setTimeout(r, 1000)); // rate limit
      }
    }
  }

  // Deduplicate across all families
  const seen = new Set();
  const deduped = [];
  for (const result of allResults) {
    for (const term of result.terms) {
      if (!seen.has(term.term)) {
        seen.add(term.term);
        deduped.push(term);
      }
    }
  }

  const byFamily = {};
  for (const t of deduped) {
    byFamily[t.family] = (byFamily[t.family] || 0) + 1;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total unique terms: ${deduped.length}`);
  console.log(`By family:`, byFamily);

  const report = {
    generatedAt: new Date().toISOString(),
    model: DEEPSEEK_MODEL,
    totalUniqueTerms: deduped.length,
    byFamily,
    terms: deduped,
  };

  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\nReport saved to: ${REPORT_PATH}`);

  if (WRITE_MODE) {
    console.log(`\nWriting ${deduped.length} terms to dictionary...`);
    // Use the existing merge pipeline
    const { mergeEntriesIntoDictionary } = await import('../server/services/deepseekKeywordTrainer.js');
    const result = await mergeEntriesIntoDictionary(deduped);
    console.log(`Dictionary merged: ${result.entries?.length || 0} entries`);
  } else {
    console.log(`\nDry run. Set WRITE=1 to merge terms into dictionary.`);
  }
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
