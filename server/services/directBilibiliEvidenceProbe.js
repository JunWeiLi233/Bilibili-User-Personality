import { evidenceNeedlesForTerm } from './deepseekKeywordTrainer.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function boundedProbeVideosPerQuery(value, fallback = 5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(Math.floor(number), 20));
}

export function isAnalyzableProbeMessage(value) {
  return /[\p{Script=Han}]/u.test(cleanText(value));
}

function evidenceCount(entry = {}) {
  const count = Number(entry.evidenceCount ?? entry.evidence?.length ?? entry.evidenceSamples?.length ?? 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function isVideoContextEvidenceSource(source = {}) {
  const sample = cleanText(source?.sample);
  const sourceText = cleanText(source?.source);
  return sample.startsWith('Bilibili video context:') || sample.startsWith('Bilibili public video title:') || sourceText.includes('search-discovered video context');
}

function isCommentBackedSampleText(sample) {
  const sampleText = cleanText(sample);
  return sampleText && !sampleText.startsWith('Bilibili video context:') && !sampleText.startsWith('Bilibili public video title:');
}

function hasBilibiliCommentScanSource(entry = {}) {
  return (entry.evidenceSources || []).some((source) => {
    const sourceText = cleanText(source?.source);
    return sourceText.startsWith('Bilibili public ') && sourceText.includes('comment scan');
  });
}

function commentBackedEvidenceCount(entry = {}) {
  const rawCount = evidenceCount(entry);
  if (rawCount === 0) return 0;
  const samples = new Set();
  for (const source of entry.evidenceSources || []) {
    const sample = cleanText(source?.sample);
    if (sample && !isVideoContextEvidenceSource(source) && isCommentBackedSampleText(sample)) samples.add(sample);
  }
  if (hasBilibiliCommentScanSource(entry)) {
    for (const sample of entry.evidenceSamples || []) {
      const sampleText = cleanText(sample);
      if (isCommentBackedSampleText(sampleText)) samples.add(sampleText);
    }
  }
  return Math.min(rawCount, samples.size);
}

function coverageEvidenceCount(entry = {}, options = {}) {
  if (options.requireCommentBackedEvidence === true) return commentBackedEvidenceCount(entry);
  const count = Number(entry.coverageEvidenceCount ?? evidenceCount(entry));
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function entryNeedles(entry = {}) {
  return [
    ...evidenceNeedlesForTerm(entry.term),
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ...(Array.isArray(entry.examples) ? entry.examples : []),
  ]
    .map(cleanText)
    .filter((item) => item.length >= 2);
}

function normalizeProbeText(value) {
  return cleanText(value)
    .replace(/<[^>]+>/g, '')
    .replace(/&[^;\s]+;/g, ' ')
    .toLowerCase();
}

const GENERIC_QUERY_TOKENS = new Set([
  'attack',
  'b站',
  'bilibili',
  '评论',
  '评论区',
  '评论回复',
  '回复',
  '回复区',
  '热评',
  '弹幕',
  '梗',
  '节奏',
  'b站评论',
]);

export function probeSearchNeedles(action = {}) {
  const term = cleanText(action?.term);
  const query = cleanText(action?.query);
  return [...new Set([term, ...query.split(/[\s,，、;；|]+/)])]
    .map((token) => token.replace(/^[“”"'!?！？。:：()[\]【】]+|[“”"'!?！？。:：()[\]【】]+$/g, '').trim())
    .filter((token) => token.length >= 2 && !GENERIC_QUERY_TOKENS.has(token.toLowerCase()));
}

export function scoreProbeVideoForAction(video = {}, action = {}) {
  const title = normalizeProbeText(video.title || video.name || video.description);
  if (!title) return 0;
  let score = 0;
  const term = normalizeProbeText(action?.term);
  if (term && title.includes(term)) score += 100;
  for (const needle of probeSearchNeedles(action)) {
    const normalizedNeedle = normalizeProbeText(needle);
    if (!normalizedNeedle || normalizedNeedle === term) continue;
    if (title.includes(normalizedNeedle)) score += normalizedNeedle.length >= 4 ? 20 : 8;
  }
  return score;
}

export function rankProbeVideosForAction(videos = [], action = {}) {
  return [...(Array.isArray(videos) ? videos : [])]
    .map((video, index) => ({ video, index, score: scoreProbeVideoForAction(video, action) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((item) => item.video);
}

function existingSamples(entry = {}) {
  return new Set(
    [
      ...(Array.isArray(entry.evidence) ? entry.evidence : []),
      ...(Array.isArray(entry.evidenceSamples) ? entry.evidenceSamples : []),
      ...(Array.isArray(entry.evidenceSources) ? entry.evidenceSources.map((source) => source?.sample) : []),
    ]
      .map(cleanText)
      .filter(Boolean),
  );
}

export function collectBilibiliReplyMessages(replies = [], video = {}, bucket = []) {
  for (const reply of Array.isArray(replies) ? replies : []) {
    const message = cleanText(reply?.content?.message);
    if (message) {
      const source = video.bvid
        ? `Bilibili public direct comment probe: https://www.bilibili.com/video/${video.bvid}/`
        : video.aid
          ? `Bilibili public direct comment probe: https://www.bilibili.com/video/av${video.aid}/`
          : 'Bilibili public direct comment probe';
      bucket.push({
        message,
        uid: cleanText(reply.mid || reply.member?.mid),
        source,
      });
    }
    collectBilibiliReplyMessages(reply?.replies, video, bucket);
  }
  return bucket;
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16) || 0));
}

export function collectBilibiliDanmakuMessages(xml = '', video = {}) {
  const comments = [];
  const source = video.bvid
    ? `Bilibili public direct danmaku probe: https://www.bilibili.com/video/${video.bvid}/`
    : video.aid
      ? `Bilibili public direct danmaku probe: https://www.bilibili.com/video/av${video.aid}/`
      : 'Bilibili public direct danmaku probe';
  const uid = cleanText(video.bvid || video.cid);
  const pattern = /<d\b[^>]*>([\s\S]*?)<\/d>/gi;
  let match;
  while ((match = pattern.exec(String(xml || '')))) {
    const message = cleanText(decodeXmlEntities(match[1]));
    if (!message) continue;
    comments.push({ message, uid, source });
  }
  return comments;
}

export function buildFreshEvidenceEntriesFromComments(dictionary = {}, comments = [], options = {}) {
  const targetEvidence = Math.max(1, Number(options.targetEvidence) || 3);
  const maxSamplesPerTerm = Math.max(1, Number(options.maxSamplesPerTerm) || 3);
  const targetTerms = new Set((Array.isArray(options.targetTerms) ? options.targetTerms : []).map(cleanText).filter(Boolean));
  const requireCommentBackedEvidence = options.requireCommentBackedEvidence === true;
  const entries = [];

  for (const entry of Array.isArray(dictionary.entries) ? dictionary.entries : []) {
    const term = cleanText(entry.term);
    if (!term) continue;
    if (!targetTerms.has(term) && coverageEvidenceCount(entry, { requireCommentBackedEvidence }) >= targetEvidence) continue;
    const needles = entryNeedles(entry);
    const seen = existingSamples(entry);
    const matches = [];
    for (const comment of comments) {
      const message = cleanText(comment?.message);
      if (!message || seen.has(message) || !needles.some((needle) => message.includes(needle))) continue;
      seen.add(message);
      matches.push({
        source: cleanText(comment.source) || 'Bilibili public direct comment probe',
        uid: cleanText(comment.uid),
        sample: message,
      });
      if (matches.length >= maxSamplesPerTerm) break;
    }
    if (!matches.length) continue;
    entries.push({
      term,
      family: entry.family || 'attack',
      meaning: entry.meaning || '',
      evidence: matches.map((match) => match.sample),
      evidenceSamples: matches.map((match) => match.sample),
      evidenceSources: matches,
    });
  }

  return entries;
}

export function makeSyntheticBilibiliCookie(randomFn = Math.random, now = Date.now()) {
  const hex = (len) =>
    Array.from({ length: len }, () => Math.floor(randomFn() * 16).toString(16))
      .join('')
      .toUpperCase();
  const epoch = Math.floor(now / 1000);
  return [
    `buvid3=${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(13)}infoc`,
    `buvid4=${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}-${epoch}-1`,
    `b_nut=${epoch}`,
    `_uuid=${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(15)}infoc`,
    `b_lsid=${hex(8)}_${hex(10)}`,
  ].join('; ');
}

export function buildProbeCorpus(existing = {}, comments = [], run = {}) {
  const previousComments = (Array.isArray(existing.comments) ? existing.comments : []).filter((comment) =>
    isAnalyzableProbeMessage(comment?.message),
  );
  const seen = new Set(previousComments.map((comment) => cleanText(comment?.message)).filter(Boolean));
  const nextComments = [...previousComments];
  let commentsAdded = 0;
  for (const comment of comments) {
    const message = cleanText(comment?.message);
    if (!message || !isAnalyzableProbeMessage(message) || seen.has(message)) continue;
    seen.add(message);
    commentsAdded += 1;
    nextComments.push({
      message,
      source: cleanText(comment?.source),
      uid: cleanText(comment?.uid),
    });
  }
  const at = cleanText(run.at) || new Date().toISOString();
  return {
    version: Number(existing.version) || 1,
    comments: nextComments,
    runs: [
      ...(Array.isArray(existing.runs) ? existing.runs : []),
      {
        ...run,
        at,
        commentsCollected: comments.length,
        commentsAdded,
      },
    ],
    updatedAt: at,
  };
}

export function probeVideoKey(video = {}) {
  const bvid = cleanText(video.bvid).replace(/\/+$/, '');
  if (bvid) return `bvid:${bvid}`;
  const aid = cleanText(video.aid).replace(/^av/i, '').replace(/\/+$/, '');
  if (aid) return `aid:${aid}`;
  return '';
}

export function extractBilibiliVideoRefs(text = '') {
  const refs = [];
  const seen = new Set();
  const pattern = /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/((?:BV[0-9A-Za-z]+)|(?:av\d+))/g;
  let match;
  while ((match = pattern.exec(String(text || '')))) {
    const id = match[1];
    const ref = id.startsWith('BV') ? { bvid: id } : { aid: id.slice(2) };
    const key = ref.bvid ? `bvid:${ref.bvid}` : `aid:${ref.aid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

export function collectScannedProbeVideoKeys(corpus = {}) {
  const keys = new Set();

  for (const run of Array.isArray(corpus.runs) ? corpus.runs : []) {
    for (const video of Array.isArray(run?.videos) ? run.videos : []) {
      const key = cleanText(video?.key) || probeVideoKey(video);
      if (key) keys.add(key);
    }
  }

  for (const comment of Array.isArray(corpus.comments) ? corpus.comments : []) {
    for (const ref of extractBilibiliVideoRefs(comment?.source)) {
      const key = probeVideoKey(ref);
      if (key) keys.add(key);
    }
  }

  return keys;
}

export function filterUnscannedProbeVideos(videos = [], scannedKeys = new Set()) {
  const seen = new Set();
  const result = [];
  for (const video of Array.isArray(videos) ? videos : []) {
    const key = probeVideoKey(video);
    if (!key || seen.has(key) || scannedKeys.has(key)) continue;
    seen.add(key);
    result.push(video);
  }
  return result;
}

export function buildEvidenceSourceVideosForActions(dictionary = {}, actions = [], options = {}) {
  const maxPerAction = Math.max(0, Math.min(Number(options.maxPerAction) || 0, 50));
  if (!maxPerAction) return new Map();
  const entries = new Map((Array.isArray(dictionary.entries) ? dictionary.entries : []).map((entry) => [cleanText(entry.term), entry]));
  const corpusSourcesByMessage = new Map();
  for (const comment of Array.isArray(options.corpus?.comments) ? options.corpus.comments : []) {
    const message = cleanText(comment?.message);
    if (!message || corpusSourcesByMessage.has(message)) continue;
    corpusSourcesByMessage.set(message, cleanText(comment?.source));
  }
  const result = new Map();

  for (const action of Array.isArray(actions) ? actions : []) {
    const term = cleanText(action?.term);
    if (!term) continue;
    const entry = entries.get(term);
    if (!entry) continue;
    const videos = [];
    const seen = new Set();
    const candidateSources = [
      ...(Array.isArray(entry.evidenceSources) ? entry.evidenceSources.map((source) => source?.source) : []),
      ...(Array.isArray(entry.evidenceSamples) ? entry.evidenceSamples.map((sample) => corpusSourcesByMessage.get(cleanText(sample))) : []),
    ];
    for (const source of candidateSources) {
      for (const ref of extractBilibiliVideoRefs(source)) {
        const key = ref.bvid ? `bvid:${ref.bvid}` : `aid:${ref.aid}`;
        if (seen.has(key)) continue;
        seen.add(key);
        videos.push({
          ...ref,
          title: `existing evidence source for ${term}`,
        });
        if (videos.length >= maxPerAction) break;
      }
      if (videos.length >= maxPerAction) break;
    }
    if (videos.length) result.set(term, videos);
  }

  return result;
}

export function buildBilibiliWebHeaders(referer, options = {}) {
  const userAgent =
    options.userAgent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  let origin = 'https://www.bilibili.com';
  try {
    origin = new URL(referer).origin;
  } catch {
    // Keep the safe default.
  }
  return {
    'user-agent': userAgent,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    referer,
    origin,
    'sec-ch-ua': '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty',
    'sec-fetch-site': 'same-site',
    ...(options.cookie ? { cookie: options.cookie } : {}),
  };
}

export function buildBilibiliViewUrl(video = {}) {
  const url = new URL('https://api.bilibili.com/x/web-interface/view');
  if (video.bvid) url.searchParams.set('bvid', cleanText(video.bvid));
  else if (video.aid) url.searchParams.set('aid', cleanText(video.aid));
  else return null;
  return url;
}

export function buildBilibiliReplyUrl(video = {}, page = 0, pageSize = 20) {
  if (!video.aid) return null;
  const url = new URL('https://api.bilibili.com/x/v2/reply/main');
  url.searchParams.set('type', '1');
  url.searchParams.set('oid', cleanText(video.aid));
  url.searchParams.set('mode', '3');
  url.searchParams.set('next', String(Math.max(0, Number(page) || 0)));
  url.searchParams.set('ps', String(Math.max(1, Math.min(Number(pageSize) || 20, 50))));
  return url;
}

export function buildBilibiliReplyPageUrl(video = {}, page = 1, pageSize = 20) {
  if (!video.aid) return null;
  const url = new URL('https://api.bilibili.com/x/v2/reply');
  url.searchParams.set('type', '1');
  url.searchParams.set('oid', cleanText(video.aid));
  url.searchParams.set('sort', '2');
  url.searchParams.set('pn', String(Math.max(1, Number(page) || 1)));
  url.searchParams.set('ps', String(Math.max(1, Math.min(Number(pageSize) || 20, 50))));
  return url;
}

export function nextReplyCursor(payload = {}, fallback = 0) {
  const cursor = payload?.data?.cursor || {};
  if (cursor.is_end === true || cursor.is_end === 1) return null;
  const next = Number(cursor.next);
  if (Number.isFinite(next) && next > 0) return next;
  return Math.max(0, Number(fallback) || 0) + 1;
}

export function buildBilibiliSearchUrls(query, options = {}) {
  const pages = Math.max(1, Math.min(Number(options.pages) || 1, 10));
  const pageSize = Math.max(1, Math.min(Number(options.pageSize) || 20, 20));
  return Array.from({ length: pages }, (_item, index) => {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'video');
    url.searchParams.set('keyword', cleanText(query));
    url.searchParams.set('page', String(index + 1));
    url.searchParams.set('page_size', String(pageSize));
    return url;
  });
}
