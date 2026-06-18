import { evidenceNeedlesForTerm } from './deepseekKeywordTrainer.js';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isScrapeDiagnosticMessage(value) {
  const message = cleanText(value);
  return /(?:^|[:\s])(?:discover|explicit Tieba thread URLs):\s+.*HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?:\/\//iu.test(message)
    || /HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?:\/\/(?:tieba|c\.tieba|www\.bilibili|api\.bilibili)\./iu.test(message);
}

function cleanCommentMessage(value) {
  const message = cleanText(value);
  return message && !isScrapeDiagnosticMessage(message) ? message : '';
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

function normalizeNeedle(value) {
  return cleanText(value).normalize('NFKC').toLowerCase();
}

function entryNeedles(entry = {}) {
  return [
    ...evidenceNeedlesForTerm(entry.term),
    ...(Array.isArray(entry.aliases) ? entry.aliases : []),
    ...(Array.isArray(entry.examples) ? entry.examples : []),
  ]
    .map(normalizeNeedle)
    .filter((item) => item.length >= 2);
}

function commentMatchesEntry(comment, entry) {
  const text = normalizeNeedle(comment);
  if (!text) return false;
  return entryNeedles(entry).some((needle) => text.includes(needle));
}

function sourceForBilibiliComment(item = {}) {
  const bvid = cleanText(item.bvid);
  if (bvid) return `Bilibili local UID discovery corpus: https://www.bilibili.com/video/${bvid}/`;
  return 'Bilibili local UID discovery corpus';
}

function sourceForScrapedUserComment(bvid) {
  const cleanedBvid = cleanText(bvid);
  if (cleanedBvid) return `Bilibili local scraped user corpus: https://www.bilibili.com/video/${cleanedBvid}/`;
  return 'Bilibili local scraped user corpus';
}

function sourceForAicuObject(prefix, oid) {
  const cleanedOid = cleanText(oid);
  if (cleanedOid) return `${prefix}: https://www.bilibili.com/video/av${cleanedOid}/`;
  return prefix;
}

function sourceForTiebaComment(item = {}) {
  const sourceUrl = cleanText(item.sourceUrl || item.source);
  if (sourceUrl) return `Tieba public thread scan: ${sourceUrl}`;
  return 'Tieba public thread scan';
}

function splitCommentText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(cleanCommentMessage)
    .filter(Boolean);
}

function flattenUidCommentMap(rawMap = {}) {
  return Object.entries(rawMap)
    .flatMap(([uid, items]) => (Array.isArray(items) ? items.map((item) => ({ ...item, uid: item?.uid || uid })) : []))
    .map((item) => {
      const message = cleanCommentMessage(item?.message);
      if (!message) return null;
      const bvid = cleanText(item?.bvid);
      return {
        message,
        platform: 'bilibili',
        source: sourceForBilibiliComment(item),
        uid: bvid || cleanText(item?.uid),
        uname: cleanText(item?.uname),
      };
    })
    .filter(Boolean);
}

export function flattenBilibiliCommentCorpus(raw) {
  if (Array.isArray(raw) && raw.every((item) => typeof item === 'string')) {
    return raw
      .map(cleanCommentMessage)
      .filter(Boolean)
      .map((message) => ({
        message,
        platform: 'bilibili',
        source: 'Bilibili local text corpus',
        uid: '',
        uname: '',
      }));
  }

  if (raw?._uidComments && typeof raw._uidComments === 'object') {
    return flattenUidCommentMap(raw._uidComments);
  }

  if (Array.isArray(raw?.comments)) {
    return raw.comments
      .map((item) => {
        const message = cleanCommentMessage(item?.message);
        if (!message) return null;
        const platform = cleanText(item?.platform) || 'bilibili';
        return {
          message,
          platform,
          source: cleanText(item?.source) || (platform === 'tieba' ? sourceForTiebaComment(item) : 'Bilibili local corpus'),
          uid: cleanText(item?.uid || item?.mid),
          uname: cleanText(item?.uname),
        };
      })
      .filter(Boolean);
  }

  if (Array.isArray(raw?.runs)) {
    return raw.runs
      .flatMap((run) => (Array.isArray(run?.results) ? run.results : []))
      .flatMap((result) => (Array.isArray(result?.comments) ? result.comments : []))
      .map((item) => {
        const message = cleanCommentMessage(item?.message);
        if (!message) return null;
        const platform = cleanText(item?.platform) || 'tieba';
        return {
          message,
          platform,
          source: platform === 'tieba' ? sourceForTiebaComment(item) : cleanText(item?.source) || 'Bilibili local corpus',
          uid: cleanText(item?.uid || item?.mid),
          uname: cleanText(item?.uname),
        };
      })
      .filter(Boolean);
  }

  if (raw?.users && typeof raw.users === 'object') {
    const comments = [];
    for (const [uid, user] of Object.entries(raw.users)) {
      const bvids = Array.isArray(user?.bvids) ? user.bvids : [];
      const commentLines = splitCommentText(user?.commentText);
      const scrapedLines = commentLines.length ? commentLines : splitCommentText(user?.combinedText);
      for (const [index, message] of scrapedLines.entries()) {
        comments.push({
          message,
          platform: 'bilibili',
          source: sourceForScrapedUserComment(bvids[index]),
          uid: cleanText(user?.uid || uid),
          uname: cleanText(user?.uname || user?.name),
        });
      }
      for (const item of Array.isArray(user?.comments) ? user.comments : []) {
        const message = cleanCommentMessage(item?.message);
        if (!message) continue;
        const oid = cleanText(item?.oid);
        comments.push({
          message,
          platform: 'bilibili',
          source: sourceForAicuObject('Bilibili local AICU corpus', oid),
          uid: cleanText(uid),
          uname: cleanText(item?.uname || user?.name),
        });
      }
      for (const item of Array.isArray(user?.danmaku) ? user.danmaku : []) {
        const message = cleanCommentMessage(item?.content || item?.message);
        if (!message) continue;
        const oid = cleanText(item?.oid);
        comments.push({
          message,
          platform: 'bilibili',
          source: sourceForAicuObject('Bilibili local AICU danmaku corpus', oid),
          uid: cleanText(uid),
          uname: cleanText(item?.uname || user?.name),
        });
      }
    }
    return comments;
  }

  const values = Array.isArray(raw) ? raw : Object.values(raw || {}).flat();
  return flattenUidCommentMap({ '': values });
}

export function buildWeakTermSet(dictionary = {}, options = {}) {
  const targetEvidence = Math.max(1, Number(options.targetEvidence) || 3);
  const targetTerms = new Set((Array.isArray(options.targetTerms) ? options.targetTerms : []).map(cleanText).filter(Boolean));
  const weak = new Map();
  for (const entry of Array.isArray(dictionary.entries) ? dictionary.entries : []) {
    const term = cleanText(entry.term);
    if (!term) continue;
    if (targetTerms.has(term) || coverageEvidenceCount(entry, options) < targetEvidence) weak.set(term, entry);
  }
  return weak;
}

function existingSamples(entry = {}) {
  return new Set([
    ...(Array.isArray(entry.evidence) ? entry.evidence : []),
    ...(Array.isArray(entry.evidenceSamples) ? entry.evidenceSamples : []),
    ...(Array.isArray(entry.evidenceSources) ? entry.evidenceSources.map((source) => source?.sample) : []),
  ].map(cleanText).filter(Boolean));
}

function sourceBackedSamples(entry = {}) {
  return new Set(
    (Array.isArray(entry.evidenceSources) ? entry.evidenceSources : [])
      .map((source) => source?.sample)
      .map(cleanText)
      .filter(Boolean),
  );
}

function hasRecoverableVideoSource(entry = {}, sample = '') {
  const targetSample = cleanText(sample);
  if (!targetSample) return false;
  return (Array.isArray(entry.evidenceSources) ? entry.evidenceSources : []).some((source) => {
    if (cleanText(source?.sample) !== targetSample) return false;
    return sourceHasRecoverableVideoUrl(source?.source);
  });
}

function sourceHasRecoverableVideoUrl(source = '') {
  return /(?:https?:\/\/)?(?:www\.)?bilibili\.com\/video\/(?:BV[0-9A-Za-z]+|av\d+)/u.test(cleanText(source));
}

function localEvidenceSampleScore(match = {}, entry = {}) {
  const sample = cleanText(match.sample);
  const term = cleanText(entry.term);
  if (!sample) return 0;

  let score = 0;
  if (term && sample.includes(term)) score += 3;
  if (sample.length >= 8 && sample.length <= 160) score += 2;
  if (/[“"「『《]?\s*[^“"」』》]{0,12}\s*[”"」』》]/.test(sample)) score += 1;
  if (/\[[^\]]{1,40}\]|[😀-🙏🌀-🗿🚀-🛿☀-⛿✀-➿]/u.test(sample)) score += 1;
  if (/弹幕|评论区|评论|回复|锐评|指点|懂哥|教.*做|一堆|逆天|笑死|绷|神人|什么/u.test(sample)) score += 3;
  if (/不是.*意思|什么梗|怎么说|谁懂|有没有懂/u.test(sample)) score += 1;
  if (/^\s*[\p{P}\p{S}\dA-Za-z\s]{0,8}\s*$/u.test(sample)) score -= 3;
  return score;
}

function cleanLocalEvidenceSampleScore(match = {}, entry = {}) {
  const sample = cleanText(match.sample);
  const term = cleanText(entry.term);
  if (!sample) return 0;

  let score = 0;
  if (term && sample.includes(term)) score += 3;
  if (sample.length >= 8 && sample.length <= 160) score += 2;
  if (/[\u201c\u2018\u300a\u3010\u300c\u300e\uff08(]\s*[^\u201d\u2019\u300b\u3011\u300d\u300f\uff09)]{0,12}\s*[\u201d\u2019\u300b\u3011\u300d\u300f\uff09)]/.test(sample)) score += 1;
  if (/\[[^\]]{1,40}\]|[\u{1f300}-\u{1f64f}\u{1f680}-\u{1f6ff}\u2600-\u27bf]/u.test(sample)) score += 1;
  if (/\u5f39\u5e55|\u8bc4\u8bba\u533a|\u8bc4\u8bba|\u56de\u590d|\u9510\u8bc4|\u6307\u70b9|\u61c2\u54e5|\u5012\u6253\u4e00\u8019|\u9006\u5929|\u7b11\u6b7b|\u7ef7|\u795e\u4eba|\u4ec0\u4e48/u.test(sample)) score += 3;
  if (/\u4e0d\u662f.*\u610f\u601d|\u4ec0\u4e48\u610f\u601d|\u600e\u4e48\u8bf4|\u8c01\u61c2|\u6709\u6ca1\u6709\u61c2/u.test(sample)) score += 1;
  if (/^\s*[\p{P}\p{S}\dA-Za-z\s]{0,8}\s*$/u.test(sample)) score -= 3;
  return score;
}

function rankLocalEvidenceMatches(matches = [], entry = {}) {
  return [...matches].sort((left, right) => {
    const scoreDelta = cleanLocalEvidenceSampleScore(right, entry) - cleanLocalEvidenceSampleScore(left, entry);
    if (scoreDelta !== 0) return scoreDelta;
    return cleanText(left.sample).length - cleanText(right.sample).length;
  });
}

export function findLocalCorpusEvidenceEntries(dictionary = {}, comments = [], options = {}) {
  const weakTerms = buildWeakTermSet(dictionary, options);
  const maxSamplesPerTerm = Math.max(1, Number(options.maxSamplesPerTerm) || 3);
  const entries = [];

  for (const [term, entry] of weakTerms.entries()) {
    const seenSamples = existingSamples(entry);
    const sourcedSamples = sourceBackedSamples(entry);
    const backfillUnsourcedSamples = options.requireCommentBackedEvidence === true;
    const matchedSamples = new Set();
    const candidateMatches = [];
    for (const comment of comments) {
      const message = cleanText(comment?.message);
      if (!message || matchedSamples.has(message) || !commentMatchesEntry(message, entry)) continue;
      if (
        seenSamples.has(message) &&
        (
          !backfillUnsourcedSamples ||
          !sourceHasRecoverableVideoUrl(comment?.source) ||
          (sourcedSamples.has(message) && hasRecoverableVideoSource(entry, message))
        )
      ) continue;
      seenSamples.add(message);
      matchedSamples.add(message);
      candidateMatches.push({
        source: cleanText(comment.source) || 'Bilibili local corpus',
        uid: cleanText(comment.uid),
        sample: message,
      });
    }
    const matches = rankLocalEvidenceMatches(candidateMatches, entry).slice(0, maxSamplesPerTerm);
    if (matches.length === 0) continue;
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
