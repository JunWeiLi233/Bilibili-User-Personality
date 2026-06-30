/**
 * Direct DeepSeek API term generator — bypasses executor for larger max_tokens.
 * Usage: node .claude/direct_generate.js
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DICT_PATH = 'server/data/deepseekKeywordDictionary.json';
const DATA_DIR = 'server/data';
const MAX_TOKENS = 16384;

// Get existing terms to avoid duplicates
async function existingTermsSet() {
  const dict = JSON.parse(await readFile(DICT_PATH, 'utf8'));
  const fs = await import('node:fs/promises');
  const seen = new Set();
  for (const [_, files] of Object.entries(dict.entryFiles)) {
    for (const file of files) {
      try {
        const data = JSON.parse(await fs.readFile(join(DATA_DIR, file), 'utf8'));
        for (const term of Object.keys(data)) seen.add(term);
      } catch {}
    }
  }
  return { seen, dict };
}

async function deepseekGenerate(family, description, exampleTerms, count) {
  const config = await loadConfig();
  if (!config.apiKey) throw new Error('No API key');

  const existing = await existingTermsSet();
  const excludeList = [...existing.seen].slice(0, 50).join('、');

  const system = '你是中文互联网论辩行为关键词生成专家。从你的训练知识中生成大量真实存在于B站/抖音/知乎/贴吧评论中的中文互联网表达。只输出JSON。';

  const prompt = `生成${count}个"${family}"族的中文互联网论辩行为关键词。

族定义：${description}
已知已有关键词（不要重复这些）：${excludeList}

要求：
1. 每个term为2-12字的真实中文互联网表达
2. 含义必须具体（15-40字），不能是占位符
3. 优先B站评论区常见表达
4. 包含缩写、谐音、梗、固定句式
5. 覆盖不同子类型（不要集中在少数子类）

输出格式：{"terms":[{"term":"词","meaning":"含义","risk":"high|medium|positive","confidence":0.8}]}
只输出JSON对象。`;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || 'deepseek-v4-pro',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: MAX_TOKENS,
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`API ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

async function loadConfig() {
  // Try env var first, then holder
  const envKey = process.env.DEEPSEEK_API_KEY;
  if (envKey && envKey.length > 10) {
    return {
      apiKey: envKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
    };
  }
  try {
    const holder = JSON.parse(await readFile(join(process.env.HOME || process.env.USERPROFILE || '.', '.deepseek', 'config.json'), 'utf8'));
    return { apiKey: holder.apiKey, baseUrl: holder.baseUrl || 'https://api.deepseek.com', model: holder.model || 'deepseek-v4-pro' };
  } catch { throw new Error('No DeepSeek config found'); }
}

async function main() {
  console.log('Loading config...');
  const config = await loadConfig();
  console.log(`Model: ${config.model}, Key: ${config.apiKey.slice(0,5)}...`);

  const families = [
    {
      family: 'attack', count: 300,
      desc: '讽刺、阴阳怪气、资格审查、阵营/动机攻击、侮辱性梗、人身攻击、鄙视链用语',
      examples: '典中典、急了、绷不住、赢麻了',
    },
    {
      family: 'absolutes', count: 250,
      desc: '绝对化断言、全称量化、无例外表述、必然性语言、夸张频率词',
      examples: '全是、根本、绝对、毫无疑问',
    },
    {
      family: 'evidence', count: 200,
      desc: '质疑来源、要求证据、引用格式、数据核查、信源评估',
      examples: '数据来源、出处、上链接、张口就来',
    },
    {
      family: 'evasion', count: 200,
      desc: '举证责任转移、拒绝解释、秘密知识暗示、搜索引擎转发、沉默要求',
      examples: '懂的都懂、自己搜、不会百度、懒得解释',
    },
    {
      family: 'cooperation', count: 200,
      desc: '条件化表达、限定词、澄清、承认限制、让步、合作讨论标记',
      examples: '有一说一、确实、我认为、应该、也许',
    },
    {
      family: 'correction', count: 200,
      desc: '自我修正、道歉、收回前言、降低结论强度、承认错误',
      examples: '说重了、我说错了、更正一下、我收回',
    },
  ];

  let grandTotal = 0;
  const allNew = [];

  for (let i = 0; i < families.length; i++) {
    const f = families[i];
    console.log(`\n[${i+1}/6] ${f.family}: requesting ${f.count} terms...`);

    try {
      const raw = await deepseekGenerate(f.family, f.desc, f.examples, f.count);
      // Parse
      let parsed = null;
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      try { parsed = JSON.parse(cleaned); } catch(e) {
        // Try to extract just the JSON object
        const match = cleaned.match(/\{"terms"\s*:\s*\[/);
        if (match) {
          try { parsed = JSON.parse(cleaned.slice(match.index)); } catch {}
        }
      }

      if (parsed?.terms && Array.isArray(parsed.terms)) {
        const existing = await existingTermsSet();
        let added = 0;
        for (const t of parsed.terms) {
          if (!t.term || !t.family) t.family = f.family;
          if (t.term.length < 2 || t.term.length > 12) continue;
          if (existing.seen.has(t.term)) continue;
          if (allNew.find(x => x.term === t.term)) continue;
          allNew.push({
            term: String(t.term).trim(),
            family: String(t.family || f.family).trim(),
            meaning: String(t.meaning || '').trim(),
            risk: String(t.risk || 'medium').trim(),
            confidence: Number(t.confidence) || 0.75,
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          });
          existing.seen.add(t.term);
          added++;
        }
        console.log(`  -> ${added} new terms (${parsed.terms.length} generated, ${parsed.terms.length - added} duplicates)`);
        grandTotal += added;
      } else {
        console.log(`  -> Parse error: ${raw.slice(0, 200)}`);
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}`);
    }

    if (i < families.length - 1) await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\n=== Complete ===`);
  console.log(`Total new terms: ${allNew.length}`);

  const byFamily = {};
  for (const t of allNew) byFamily[t.family] = (byFamily[t.family]||0) + 1;
  console.log(`By family: ${JSON.stringify(byFamily)}`);

  await writeFile('server/data/allGeneratedTerms_direct.json', JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalTerms: allNew.length,
    byFamily,
    terms: allNew,
  }, null, 2), 'utf8');
  console.log(`Saved to allGeneratedTerms_direct.json`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
