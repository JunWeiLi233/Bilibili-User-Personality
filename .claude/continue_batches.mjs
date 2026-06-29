import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';

async function gen(family, desc, count) {
  const dict = JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json','utf8'));
  const seen = new Set();
  for (const [_, files] of Object.entries(dict.entryFiles)) {
    for (const file of files) try {
      const data = JSON.parse(readFileSync('server/data/' + file, 'utf8'));
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'object' && val !== null && val.meaning) seen.add(key);
      }
    } catch {}
  }
  const excludeSample = [...seen].slice(-20).join('、');

  const prompt = `你是中文互联网关键词生成器。从训练知识生成真实B站/抖音评论中的网络表达。\n\n生成${count}个"${family}"族关键词。定义：${desc}。不重复：${excludeSample}\n\n每词2-12字。JSON:{"terms":[{"term":"词","family":"${family}","meaning":"语用功能(15-40字)","risk":"high|medium|positive","confidence":0.8}]}只输出JSON。`;

  const resp = await fetch(process.env.DEEPSEEK_BASE_URL + '/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: '你是中文互联网关键词专家。只输出JSON。' },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8192,
    }),
  });
  if (!resp.ok) return [];
  const data = await resp.json();
  const raw = (data.choices?.[0]?.message?.content || '').replace(/```json\s*/g, '').replace(/```/g, '').trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed.terms) return parsed.terms.filter(t => t.term && t.term.length >= 2 && t.term.length <= 12 && !seen.has(t.term));
  } catch(e) {
    try { const fixed = JSON.parse(raw.replace(/,\s*$/, '') + ']}'); if (fixed.terms) return fixed.terms.filter(t => t.term && !seen.has(t.term)); } catch {}
  }
  return [];
}

function mergeResults(terms) {
  const dict = JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json','utf8'));
  const existing = new Set();
  for (const [_, files] of Object.entries(dict.entryFiles))
    for (const file of files) try {
      const d = JSON.parse(readFileSync('server/data/' + file, 'utf8'));
      for (const [key, val] of Object.entries(d)) {
        if (typeof val === 'object' && val !== null && val.meaning) existing.add(key);
      }
    } catch {}

  const nu = terms.filter(t => !existing.has(t.term));
  if (!nu.length) return 0;

  const groups = {};
  for (const t of nu) (groups[t.family] = groups[t.family] || []).push(t);
  const updatedFiles = {...dict.entryFiles};
  const SHARD_MAX = 65536;

  for (const [family, terms] of Object.entries(groups)) {
    const files = [...(updatedFiles[family] || [])];
    let lastFile = files[files.length - 1];
    let lastShard = {}, lastSize = 0;
    if (lastFile && existsSync('server/data/' + lastFile)) {
      const raw = readFileSync('server/data/' + lastFile, 'utf8');
      lastShard = JSON.parse(raw); lastSize = Buffer.byteLength(raw, 'utf8');
    }
    for (const term of terms) {
      const entry = {
        family: term.family, meaning: String(term.meaning || '').trim(),
        risk: String(term.risk || 'medium').trim(),
        confidence: Number.isFinite(Number(term.confidence)) ? Number(term.confidence) : 0.75,
        variants: [], evidenceSamples: [], evidenceSources: [],
        updatedAt: new Date().toISOString(),
      };
      const sz = JSON.stringify(entry).length + 3;
      if (lastSize + sz > SHARD_MAX && Object.keys(lastShard).length > 0) {
        const name = `${family}-${String(files.length + 1).padStart(3, '0')}.json`;
        writeFileSync('server/data/deepseekKeywordDictionary.entries/' + name, JSON.stringify(lastShard, null, 2), 'utf8');
        files.push('deepseekKeywordDictionary.entries/' + name);
        lastShard = {}; lastSize = 0;
      }
      lastShard[term.term] = entry; lastSize += sz;
    }
    if (Object.keys(lastShard).length > 0) {
      const name = `${family}-${String(files.length + 1).padStart(3, '0')}.json`;
      writeFileSync('server/data/deepseekKeywordDictionary.entries/' + name, JSON.stringify(lastShard, null, 2), 'utf8');
      files.push('deepseekKeywordDictionary.entries/' + name);
    }
    updatedFiles[family] = files;
  }

  const manifest = JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json','utf8'));
  manifest.entryFiles = updatedFiles;
  manifest.updatedAt = new Date().toISOString();
  writeFileSync('server/data/deepseekKeywordDictionary.json', JSON.stringify(manifest, null, 2), 'utf8');
  return nu.length;
}

async function main() {
  const dict = JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json','utf8'));
  const unique = new Set();
  for (const [_, files] of Object.entries(dict.entryFiles))
    for (const file of files) try {
      const data = JSON.parse(readFileSync('server/data/' + file, 'utf8'));
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'object' && data[key] !== null && data[key].meaning) unique.add(key);
      }
    } catch {}
  let current = unique.size;

  console.log(`Starting: ${current} unique terms, target: 5000`);

  const families = [
    {family:'attack', desc:'讽刺、阵营攻击、侮辱梗、网络黑话、粉丝圈攻击', count:50},
    {family:'absolutes', desc:'绝对化断言、全称量化、无例外表述、夸张频率', count:50},
    {family:'evidence', desc:'质疑来源、要求证据、数据引用、信源评估', count:45},
    {family:'evasion', desc:'举证转移、拒绝解释、秘密暗示、推卸责任', count:45},
    {family:'cooperation', desc:'条件化、限定词、让步、合作讨论标记', count:45},
    {family:'correction', desc:'自我修正、道歉、收回前言、承认错误', count:45},
  ];

  for (let batch = 21; current < 5000 && batch <= 40; batch++) {
    console.log(`\n=== Batch ${batch} (need ${5000 - current} more) ===`);
    let batchTerms = [];

    for (let i = 0; i < families.length; i++) {
      const f = families[i];
      const terms = await gen(f.family, f.desc, f.count);
      const nu = terms.filter(t => !batchTerms.find(x => x.term === t.term));
      batchTerms.push(...nu);
      console.log(`  [${i+1}/6] ${f.family}: +${nu.length} (batch: ${batchTerms.length})`);
      if (i < 5) await new Promise(r => setTimeout(r, 1000));
    }

    if (batchTerms.length === 0) { console.log('No new terms. Stopping.'); break; }

    const added = mergeResults(batchTerms);
    current += added;
    console.log(`Merged: +${added}. Total: ${current} (${(current/5000*100).toFixed(1)}%)`);

    const byFam = {};
    for (const t of batchTerms) byFam[t.family] = (byFam[t.family]||0) + 1;
    writeFileSync(`server/data/batch_${batch}.json`, JSON.stringify({
      batch, generatedAt: new Date().toISOString(), totalTerms: batchTerms.length, byFamily: byFam, terms: batchTerms
    }, null, 2), 'utf8');

    if (current >= 5000) break;
  }

  console.log(`\n=== Final: ${current} unique terms ===`);
  const finalUnique = new Set(); const byFam = {};
  for (const [f, files] of Object.entries(JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json','utf8')).entryFiles))
    for (const file of files) try {
      const d = JSON.parse(readFileSync('server/data/' + file, 'utf8'));
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'object' && v !== null && v.meaning && !finalUnique.has(k)) {
          finalUnique.add(k);
          byFam[f] = (byFam[f]||0) + 1;
        }
      }
    } catch {}
  console.log(`By family: ${JSON.stringify(byFam)}`);
  console.log(`Progress: ${finalUnique.size}/5000 (${(finalUnique.size/5000*100).toFixed(1)}%)`);
}

main().catch(e => { console.error('Fatal: ' + e.message); process.exit(1); });
