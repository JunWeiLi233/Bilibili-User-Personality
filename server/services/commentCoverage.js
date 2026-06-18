import { findDictionaryEntriesWithTextEvidence } from './deepseekKeywordTrainer.js';

function hasChinese(text) {
  return /[\p{Script=Han}]/u.test(String(text || ''));
}

function cleanComment(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripMentionScaffolding(text) {
  return cleanComment(text)
    .replace(/回复\s*@[^:：\s]+[\s:：]*/gu, '')
    .replace(/@[^:：\s]+/gu, '')
    .trim();
}

function summarizeHit(entry) {
  return {
    term: entry.term,
    family: entry.family,
    meaning: entry.meaning,
  };
}

const EMOTE_SEMANTICS = [
  {
    pattern: /\[(?:tv_)?doge(?:[_-][^\]]+)?\]|doge|🙃|🙂|😏/iu,
    term: 'doge/反讽表情',
    family: 'attack',
    meaning: '中文平台评论中常用来标记反讽、阴阳怪气、保命式玩笑或“话里有话”的语气，不能当作普通装饰忽略。',
  },
  {
    pattern: /\[(?:藏狐|tv_斜眼笑|斜眼笑|滑稽|妙啊|阴险)\]|😅|😂|🤣|🤭/u,
    term: '嘲讽/看戏表情',
    family: 'attack',
    meaning: '表达调侃、看戏、嘲笑或讽刺态度；需要结合句子判断是玩梗还是指向具体对象的攻击。',
  },
  {
    pattern: /\[(?:吃瓜|嗑瓜子|热词系列[_-]吃瓜|doge[_-]金箍)\]|🍉/u,
    term: '吃瓜/旁观表情',
    family: 'evasion',
    meaning: '表示围观、拱火、旁观或回避直接论证，常弱化说话者责任或把严肃争论娱乐化。',
  },
  {
    pattern: /\[(?:捂脸|笑哭|喜极而泣|允悲|辣眼睛)\]|😓|🤦|🤦‍♂️|🤦‍♀️/u,
    term: '无语/尴尬表情',
    family: 'attack',
    meaning: '表达无语、尴尬、轻蔑或自嘲；在中文评论里经常承担态度和讽刺功能。',
  },
];

export function detectEmoteSemanticHits(comment) {
  const message = cleanComment(comment);
  if (!message) return [];
  return EMOTE_SEMANTICS
    .filter((item) => item.pattern.test(message))
    .map((item) => summarizeHit(item));
}

function cleanNeedle(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function isSelfReferentialNoviceHit(entry, message) {
  if (entry?.family !== 'attack') return false;
  const term = String(entry?.term || '');
  const aliases = Array.isArray(entry?.aliases) ? entry.aliases.map(String) : [];
  if (![term, ...aliases].some((value) => value.includes('小白'))) return false;
  return /(?:^|[，,。！？!?\s])我(?:也|是|就是|也算|算)?[^，,。！？!?]{0,8}小白/u.test(message);
}

function isSuppressedLexicalHit(entry, message) {
  return isSelfReferentialNoviceHit(entry, message);
}

function exactDictionaryEntries(dictionary, message) {
  const cleanMessage = cleanNeedle(message);
  if (!cleanMessage) return [];
  const hits = [];
  for (const entry of Array.isArray(dictionary?.entries) ? dictionary.entries : []) {
    const needles = [entry.term, ...(Array.isArray(entry.aliases) ? entry.aliases : []), ...(Array.isArray(entry.examples) ? entry.examples : [])]
      .map(cleanNeedle)
      .filter((item) => item.length >= 2);
    if (needles.some((needle) => cleanMessage.includes(needle))) hits.push(entry);
  }
  return hits;
}

export function classifyCommentCoverage(dictionary, comment, options = {}) {
  const message = cleanComment(comment);
  if (!message) {
    return {
      covered: false,
      mode: 'uncovered',
      reason: 'empty comment',
      hits: [],
      comment: message,
    };
  }

  const attributableMessage = stripMentionScaffolding(message);
  const evidenceEntries = findDictionaryEntriesWithTextEvidence(dictionary, attributableMessage, {
    source: options.source || 'comment coverage check',
  }).filter((entry) => !isSuppressedLexicalHit(entry, attributableMessage));
  const lexicalEntries = evidenceEntries.length > 0
    ? evidenceEntries
    : exactDictionaryEntries(dictionary, attributableMessage)
      .filter((entry) => !isSuppressedLexicalHit(entry, attributableMessage));
  const lexicalHits = lexicalEntries.map(summarizeHit);
  const emoteHits = detectEmoteSemanticHits(message);
  const hits = [...lexicalHits, ...emoteHits];

  if (hits.length > 0) {
    return {
      covered: true,
      mode: 'keyword',
      reason: lexicalHits.length > 0 && emoteHits.length > 0
        ? 'dictionary term and emoji/emote semantic marker matched'
        : (lexicalHits.length > 0 ? 'dictionary term evidence matched' : 'emoji/emote semantic marker matched'),
      hits,
      comment: message,
    };
  }

  if (hasChinese(message)) {
    return {
      covered: true,
      mode: 'neutral',
      reason: 'no dictionary risk term matched; comment remains analyzable as neutral/no-keyword speech',
      hits: [],
      comment: message,
    };
  }

  return {
    covered: false,
    mode: 'uncovered',
    reason: 'non-Chinese or unsupported empty lexical content',
    hits: [],
    comment: message,
  };
}

export function sampleCommentCoverage(dictionary, comments = [], options = {}) {
  const sampleSize = Math.max(0, Number(options.sampleSize) || comments.length);
  const picked = comments.slice(0, sampleSize);
  const samples = picked.map((comment) => classifyCommentCoverage(dictionary, comment, options));
  const byMode = { keyword: 0, neutral: 0, uncovered: 0 };
  for (const sample of samples) {
    byMode[sample.mode] = (byMode[sample.mode] || 0) + 1;
  }
  const covered = samples.filter((sample) => sample.covered).length;
  return {
    total: samples.length,
    covered,
    uncovered: samples.length - covered,
    coverageRatio: samples.length > 0 ? covered / samples.length : 1,
    byMode,
    samples,
  };
}
