import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SUPPORTED_FAMILIES = ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];
const DEEPSEEK_V4_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];
const STOP_TERMS = new Set([
  '变体1',
  '变体2',
  '词或短语',
  '用户名',
  '视频标题',
  '普通名词',
  '证据',
  '来源',
  '数据',
  '报告',
  '论文',
]);
const FAMILY_ALIASES = {
  sarcasm: 'attack',
  meme: 'attack',
  insult: 'attack',
  stanceAttack: 'attack',
  evidenceShift: 'evasion',
  proofShift: 'evasion',
  dodge: 'evasion',
  absolute: 'absolutes',
  overgeneralization: 'absolutes',
  source: 'evidence',
  proof: 'evidence',
  collaborate: 'cooperation',
  hedge: 'cooperation',
  revision: 'correction',
};

export const DEFAULT_DICTIONARY_PATH = join(process.cwd(), 'server', 'deepseekKeywordDictionary.json');

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function cleanTerm(term) {
  return String(term || '')
    .replace(/[，。！？、；：,.!?;:"'“”‘’`~()[\]{}<>]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeFamily(family) {
  const raw = String(family || '').trim();
  return SUPPORTED_FAMILIES.includes(raw) ? raw : FAMILY_ALIASES[raw] || 'attack';
}

function authHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

export function extractJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(jsonText);
}

export function normalizeKeywordEntries(rawEntries = []) {
  const entries = [];
  for (const item of rawEntries) {
    const family = normalizeFamily(item.family);
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const terms = unique([item.term, ...variants].map(cleanTerm)).filter((term) => term.length >= 2 && term.length <= 12);
    const meaning = String(item.meaning || item.reason || '').trim();
    if (!meaning || /中文含义|语用功能|^含义$|^解释$/.test(meaning)) continue;
    for (const term of terms) {
      if (STOP_TERMS.has(term) || /^变体\d+$/.test(term)) continue;
      entries.push({
        term,
        family,
        meaning,
        risk: String(item.risk || '').trim() || (family === 'cooperation' || family === 'correction' ? 'positive' : 'medium'),
        confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.68,
      });
    }
  }
  return [...new Map(entries.map((entry) => [`${entry.family}:${entry.term}`, entry])).values()];
}

async function readDictionary(dictionaryPath) {
  try {
    const current = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    return {
      version: current.version || 1,
      updatedAt: current.updatedAt || null,
      entries: Array.isArray(current.entries) ? current.entries : [],
      families: current.families || {},
    };
  } catch {
    return { version: 1, updatedAt: null, entries: [], families: {} };
  }
}

export async function mergeEntriesIntoDictionary(entries, options = {}) {
  const dictionaryPath = options.dictionaryPath || DEFAULT_DICTIONARY_PATH;
  const current = await readDictionary(dictionaryPath);
  const normalizedEntries = normalizeKeywordEntries(entries);
  const entryMap = new Map(current.entries.map((entry) => [`${entry.family}:${entry.term}`, entry]));
  for (const entry of normalizedEntries) {
    entryMap.set(`${entry.family}:${entry.term}`, {
      ...entryMap.get(`${entry.family}:${entry.term}`),
      ...entry,
      updatedAt: new Date().toISOString(),
    });
  }

  const allEntries = [...entryMap.values()].sort((a, b) => a.family.localeCompare(b.family) || a.term.localeCompare(b.term));
  const families = Object.fromEntries(SUPPORTED_FAMILIES.map((family) => [family, []]));
  for (const entry of allEntries) {
    if (!families[entry.family]) families[entry.family] = [];
    families[entry.family].push(entry.term);
  }
  for (const family of Object.keys(families)) families[family] = unique(families[family]).sort();

  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: allEntries,
    families,
  };
  await mkdir(dirname(dictionaryPath), { recursive: true });
  await writeFile(dictionaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function getDeepSeekConfig(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const baseUrl = String(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const configuredModel = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const apiKey = env.DEEPSEEK_API_KEY || '';

  if (!apiKey) {
    return {
      ok: false,
      provider: 'deepseek',
      baseUrl,
      model: configuredModel,
      available: false,
      keyConfigured: false,
      models: DEEPSEEK_V4_MODELS,
      error: 'DEEPSEEK_API_KEY is not configured.',
    };
  }

  try {
    const response = await fetchImpl(`${baseUrl}/models`, { headers: authHeaders(apiKey) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload.data || []).map((model) => model.id).filter(Boolean);
    const model = models.includes(configuredModel)
      ? configuredModel
      : models.find((item) => item === 'deepseek-v4-flash') || models.find((item) => item === 'deepseek-v4-pro') || configuredModel;
    return {
      ok: true,
      provider: 'deepseek',
      baseUrl,
      model,
      configuredModel,
      available: Boolean(model),
      keyConfigured: true,
      models,
    };
  } catch (error) {
    return {
      ok: true,
      provider: 'deepseek',
      baseUrl,
      model: configuredModel,
      configuredModel,
      available: true,
      keyConfigured: true,
      models: DEEPSEEK_V4_MODELS,
      warning: `Could not list models: ${error.message}`,
    };
  }
}

function buildKeywordMessages({ text, uid }) {
  return [
    {
      role: 'system',
      content:
        '你是中文互联网术语词典训练器。只输出 JSON。你要从 B 站用户发言中发现值得加入本地词典的新词、梗、缩写、谐音或固定话术，并归入语义族。',
    },
    {
      role: 'user',
      content: `JSON 结构：
{"keywords":[{"term":"词或短语","family":"attack|absolutes|evidence|evasion|cooperation|correction","meaning":"中文含义和语用功能","variants":["变体"],"risk":"high|medium|positive|neutral","confidence":0.0}]}

分类规则：
- attack: 讽刺、阴阳怪气、资格审查、阵营/动机攻击、侮辱性梗。
- absolutes: 绝对化、全称化、没有例外的强断言。
- evidence: 来源、数据、证据、可核验材料相关词。
- evasion: 懂的都懂、自己搜、拒绝解释、转移举证责任。
- cooperation: 可能、限定、澄清、愿意看来源、合作讨论。
- correction: 我错了、说重了、更正、修正、降低结论强度。

不要加入普通名词、视频标题、用户名、纯数字。优先选择 2 到 12 字的中文互联网表达。不要输出 markdown。

UID: ${uid || 'unknown'}
发言样本：
${String(text || '').slice(0, 6000)}`,
    },
  ];
}

function heuristicKeywordEntries(text) {
  const patterns = [
    { pattern: /(不会真有人(?:觉得|以为)?)/g, family: 'attack', meaning: '用反问包装资格审查或嘲讽' },
    { pattern: /(典中典|典|孝|急了|绷不住|赢麻了|乐|yygq|阴阳怪气|懂哥|小丑)/gi, family: 'attack', meaning: '中文互联网嘲讽或贬低性梗' },
    { pattern: /(懂的都懂|你自己搜|自己查|不会百度|这还用问|懒得解释)/g, family: 'evasion', meaning: '把举证责任转移给对方' },
    { pattern: /(全是|全都|根本没有|没有一个|必然|绝对|肯定是)/g, family: 'absolutes', meaning: '缺少限定条件的强断言' },
    { pattern: /(数据|来源|报告|论文|链接|证据|出处)/g, family: 'evidence', meaning: '要求或提供可核验证据' },
    { pattern: /(可能|不一定|如果有|可以贴|我理解|补充一下)/g, family: 'cooperation', meaning: '合作讨论或条件化表达' },
    { pattern: /(我错了|我说重了|前面说重了|更正|修正|改结论)/g, family: 'correction', meaning: '自我修正或结论降级' },
  ];
  const entries = [];
  for (const item of patterns) {
    for (const match of String(text || '').matchAll(item.pattern)) {
      entries.push({
        term: match[1] || match[0],
        family: item.family,
        meaning: item.meaning,
        confidence: 0.5,
      });
    }
  }
  return normalizeKeywordEntries(entries);
}

async function generateKeywordEntries(payload, config, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const heuristicEntries = heuristicKeywordEntries(payload.text);
  if (!config.available || !config.keyConfigured || !config.model) {
    return { entries: heuristicEntries, usedFallback: true, raw: '' };
  }

  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders((options.env || process.env).DEEPSEEK_API_KEY),
    body: JSON.stringify({
      model: config.model,
      messages: buildKeywordMessages(payload),
      response_format: { type: 'json_object' },
      stream: false,
      temperature: 0.1,
      max_tokens: 900,
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek generate failed with HTTP ${response.status}`);
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  try {
    const parsed = extractJsonObject(raw);
    const deepseekEntries = normalizeKeywordEntries(parsed.keywords || parsed.terms || []);
    const entries = normalizeKeywordEntries([...deepseekEntries, ...heuristicEntries]);
    return {
      entries,
      usedFallback: deepseekEntries.length === 0,
      raw,
    };
  } catch {
    return { entries: heuristicEntries, usedFallback: true, raw };
  }
}

export async function trainKeywordDictionary(payload, options = {}) {
  const config = await getDeepSeekConfig(options);
  const generated = await generateKeywordEntries(payload, config, options);
  const dictionary = await mergeEntriesIntoDictionary(generated.entries, options);
  return {
    ok: true,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model || '',
    available: config.available,
    keyConfigured: config.keyConfigured,
    usedFallback: generated.usedFallback,
    entries: generated.entries,
    dictionary,
    warning: config.warning,
  };
}

export async function readKeywordDictionary(options = {}) {
  return readDictionary(options.dictionaryPath || DEFAULT_DICTIONARY_PATH);
}
