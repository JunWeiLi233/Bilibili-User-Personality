function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasHanText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function sourceForRow(options = {}, row = {}) {
  const dataset = cleanText(options.dataset);
  const file = cleanText(options.file);
  const url = cleanText(row.url || row.sourceUrl || row.source || row.href);
  const prefix = `Hugging Face dataset: ${dataset}${file ? `/${file}` : ''}`;
  return url ? `${prefix}: ${url}` : prefix;
}

function splitJsonl(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parseCsv(raw) {
  const lines = String(raw || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((header) => cleanText(header));
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function isTiebaLikeRow(row = {}, options = {}) {
  const platform = cleanText(row.platform || row.source_platform || options.platform).toLowerCase();
  const href = cleanText(row.href || row.url || row.sourceUrl || row.source);
  return platform === 'tieba' || /tieba\.baidu\.com/i.test(href);
}

function firstTextField(row = {}, options = {}) {
  if (Array.isArray(row.messages)) {
    const message = row.messages.find((item) => cleanText(item?.content) && cleanText(item?.role) !== 'assistant');
    if (message) return message.content;
  }
  const directText = row.comment
    || row.content
    || row.text
    || row.instruction
    || row.input
    || row.output
    || '';
  if (directText) return directText;
  if (isTiebaLikeRow(row, options)) {
    return [row.title, row.detail]
      .map(cleanText)
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(' ');
  }
  return row.comment
    || row.content
    || row.text
    || row.instruction
    || row.input
    || row.output
    || '';
}

function rowPlatform(row = {}, fallback = '') {
  return cleanText(row.platform || row.source_platform || fallback).toLowerCase();
}

export function parseHuggingFaceRows(raw, options = {}) {
  const platform = cleanText(options.platform || 'huggingface').toLowerCase();
  const limit = Math.max(1, Math.min(Number(options.limit) || 500, 5000));
  const file = cleanText(options.file);
  let rows = [];

  if (/\.csv$/i.test(file)) {
    rows = parseCsv(raw);
  } else if (/\.jsonl$/i.test(file)) {
    rows = splitJsonl(raw);
  } else {
    try {
      const parsed = JSON.parse(String(raw || ''));
      rows = Array.isArray(parsed) ? parsed : Object.values(parsed || {}).flat();
    } catch {
      rows = splitJsonl(raw);
    }
  }

  const comments = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const detectedPlatform = rowPlatform(row, platform);
    if (platform && detectedPlatform && detectedPlatform !== platform) continue;
    const message = cleanText(firstTextField(row, options));
    if (!message) continue;
    if (!hasHanText(message)) continue;
    comments.push({
      message,
      platform: detectedPlatform || platform || 'huggingface',
      source: sourceForRow(options, row),
      sourceUrl: cleanText(row.url || row.sourceUrl || row.source || row.href),
      uid: cleanText(row.creator_id || row.user_id || row.uid || row.author || row.comment_id),
      uname: cleanText(row.creator_name || row.username || row.uname || row.user),
      dataset: cleanText(options.dataset),
      file,
    });
    if (comments.length >= limit) break;
  }
  return comments;
}

export function uniqueHuggingFaceComments(comments = []) {
  return [...new Map(
    comments
      .filter((comment) => cleanText(comment?.message))
      .map((comment) => [`${comment.platform || ''}\n${comment.sourceUrl || comment.source || ''}\n${comment.message}`, comment]),
  ).values()];
}

export function buildHuggingFaceCorpusUpdate(existing = {}, importedRows = [], run = {}, generatedAt = new Date().toISOString()) {
  const corpus = existing && Array.isArray(existing.comments)
    ? existing
    : { version: 1, updatedAt: null, runs: [], comments: [] };
  const before = uniqueHuggingFaceComments(corpus.comments || []);
  const comments = uniqueHuggingFaceComments([...before, ...importedRows]);
  const addedComments = Math.max(0, comments.length - before.length);
  if (addedComments === 0) return { changed: false, corpus, addedComments };
  return {
    changed: true,
    addedComments,
    corpus: {
      version: 1,
      updatedAt: generatedAt,
      runs: [...(corpus.runs || []).slice(-49), { ...run, addedComments, importedRows: importedRows.length }],
      comments,
    },
  };
}
