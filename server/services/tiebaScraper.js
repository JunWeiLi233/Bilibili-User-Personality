const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1';
const TIEBA_BASE = 'https://tieba.baidu.com';
const TIEBA_BLOCK_STATUSES = new Set([403, 429, 503]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function readTiebaConfig(options = {}, env = process.env) {
  return {
    minDelayMs: Math.max(0, Number(options.minDelayMs ?? env.TIEBA_SCRAPER_MIN_DELAY_MS ?? 5000)),
    jitterMs: Math.max(0, Number(options.jitterMs ?? env.TIEBA_SCRAPER_JITTER_MS ?? 3000)),
    blockCooldownMs: Math.max(0, Number(options.blockCooldownMs ?? env.TIEBA_SCRAPER_BLOCK_COOLDOWN_MS ?? 120000)),
    requestTimeoutMs: Math.max(0, Number(options.requestTimeoutMs ?? env.TIEBA_SCRAPER_REQUEST_TIMEOUT_MS ?? 30000)),
    discoveryMode: String(options.discoveryMode ?? env.TIEBA_DISCOVERY_MODE ?? 'desktop').trim().toLowerCase(),
  };
}

function decodeHtml(value) {
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

function cleanText(value) {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTiebaSafetyVerificationPage(html) {
  const text = String(html || '');
  return /百度安全验证|BIOC_OPTIONS|seccaptcha|tb_pc_frs_bfe/i.test(text);
}

function assertNotTiebaSafetyVerification(html, url) {
  if (!isTiebaSafetyVerificationPage(html)) return;
  const error = new Error(`Tieba safety verification page returned from ${url}`);
  error.tiebaBlocked = true;
  throw error;
}

function normalizeTiebaCharset(value = '') {
  const charset = String(value || '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!charset) return '';
  if (['gbk', 'gb2312', 'gb18030'].includes(charset)) return 'gb18030';
  if (['utf-8', 'utf8'].includes(charset)) return 'utf-8';
  return charset;
}

function sniffTiebaCharset(buffer, contentType = '') {
  const headerCharset = /charset=([^;\s]+)/i.exec(String(contentType || ''))?.[1];
  if (headerCharset) return normalizeTiebaCharset(headerCharset);
  const ascii = new TextDecoder('latin1').decode(buffer).slice(0, 4096);
  const metaCharset =
    /<meta\b[^>]*charset=["']?([^"'\s/>]+)/i.exec(ascii)?.[1] ||
    /<meta\b[^>]*content=["'][^"']*charset=([^"';\s]+)/i.exec(ascii)?.[1];
  return normalizeTiebaCharset(metaCharset) || 'utf-8';
}

export function decodeTiebaHtmlResponse(buffer, contentType = '') {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer || []);
  const charset = sniffTiebaCharset(bytes, contentType);
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

function cleanTitle(value, fallback = '') {
  return cleanText(value || fallback).slice(0, 160);
}

function absoluteTiebaThreadUrl(id) {
  return `${TIEBA_BASE}/p/${encodeURIComponent(String(id))}`;
}

function mobileTiebaThreadFetchUrl(value, id) {
  const text = String(value || '').trim();
  if (!text || !/c\.tieba\.baidu\.com\/p\//i.test(text)) return '';
  try {
    const url = new URL(text);
    if (url.hostname !== 'c.tieba.baidu.com') return '';
    url.pathname = `/p/${encodeURIComponent(String(id))}`;
    url.searchParams.set('mo_device', '1');
    return url.toString();
  } catch {
    return '';
  }
}

export function threadFromTiebaUrl(value, keyword = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const match = /(?:^|\/p\/)(\d{4,})(?:\D|$)/.exec(text);
  if (!match) return null;
  const id = match[1];
  const thread = {
    id,
    kind: 'tieba-thread',
    title: `Tieba thread ${id}`,
    keyword: String(keyword || ''),
    sourceUrl: absoluteTiebaThreadUrl(id),
  };
  const fetchUrl = mobileTiebaThreadFetchUrl(text, id);
  if (fetchUrl) thread.fetchUrl = fetchUrl;
  return thread;
}

function parseDataField(value) {
  const decoded = decodeHtml(value);
  try {
    return JSON.parse(decoded);
  } catch {
    try {
      return JSON.parse(decoded.replace(/\\"/g, '"'));
    } catch {
      return {};
    }
  }
}

function extractFirst(pattern, text) {
  const match = pattern.exec(text);
  return match ? match[1] : '';
}

function extractDataField(block) {
  return (
    extractFirst(/\bdata-field='([^']*)'/i, block) ||
    extractFirst(/\bdata-field="([^"]*)"/i, block)
  );
}

export function parseTiebaThreads(html, keyword = '') {
  const text = String(html || '');
  const threads = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["'](?:https?:\/\/tieba\.baidu\.com)?\/p\/(\d+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const id = String(match[1] || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const tag = match[0];
    const titleAttr = extractFirst(/\btitle=["']([^"']+)["']/i, tag);
    const title = cleanTitle(titleAttr || match[2], `Tieba thread ${id}`);
    threads.push({
      id,
      kind: 'tieba-thread',
      title,
      keyword: String(keyword || ''),
      sourceUrl: absoluteTiebaThreadUrl(id),
    });
  }
  return threads;
}

function parseLPostBlocks(html) {
  const blocks = [];
  const pattern = /<div\b[^>]*class=["'][^"']*\bl_post\b[^"']*["'][^>]*[\s\S]*?(?=<div\b[^>]*class=["'][^"']*\bl_post\b|$)/gi;
  let match;
  while ((match = pattern.exec(String(html || '')))) {
    blocks.push(match[0]);
  }
  return blocks;
}

function postIdFromBlock(block, dataField, index) {
  return String(
    dataField?.content?.post_id ||
      dataField?.content?.post_no ||
      dataField?.post_id ||
      extractFirst(/\bdata-pid=["']?(\d+)/i, block) ||
      index + 1,
  );
}

function postAuthorFromBlock(block, dataField) {
  return String(
    dataField?.author?.user_name ||
      dataField?.author?.name ||
      dataField?.author?.user_nickname ||
      extractFirst(/\busername=["']([^"']+)["']/i, block) ||
      '',
  ).trim();
}

function postMessageFromBlock(block) {
  const explicit =
    extractFirst(/<div\b[^>]*class=["'][^"']*\bd_post_content\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i, block) ||
    extractFirst(/<cc\b[^>]*>([\s\S]*?)<\/cc>/i, block);
  return cleanText(explicit || block);
}

export function parseTiebaThreadComments(html, thread = {}) {
  const comments = [];
  const seen = new Set();
  const blocks = parseLPostBlocks(html);
  blocks.forEach((block, index) => {
    const dataFieldRaw = extractDataField(block);
    const dataField = dataFieldRaw ? parseDataField(dataFieldRaw) : {};
    const postId = postIdFromBlock(block, dataField, index);
    const message = postMessageFromBlock(block);
    if (!message) return;
    const rpid = `tieba-${thread.id || 'unknown'}-${postId}`;
    if (seen.has(rpid)) return;
    seen.add(rpid);
    comments.push({
      sourceKind: 'tieba-thread',
      sourceTitle: thread.title || '',
      sourceUrl: thread.sourceUrl || (thread.id ? absoluteTiebaThreadUrl(thread.id) : TIEBA_BASE),
      rpid,
      like: 0,
      ctime: 0,
      uname: postAuthorFromBlock(block, dataField),
      mid: '',
      message,
      platform: 'tieba',
    });
  });
  return comments;
}

export function tiebaThreadsToDiscoveryComments(threads = [], keyword = '') {
  const comments = [];
  const seen = new Set();
  for (const thread of Array.isArray(threads) ? threads : []) {
    const title = cleanText(thread?.title);
    if (!title || /^Tieba thread \d+$/i.test(title)) continue;
    const id = String(thread?.id || '').trim();
    const key = `${id}\n${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    comments.push({
      sourceKind: 'tieba-discovery',
      sourceTitle: title,
      sourceUrl: thread?.sourceUrl || (id ? absoluteTiebaThreadUrl(id) : TIEBA_BASE),
      rpid: `tieba-discovery-${id || comments.length + 1}`,
      like: 0,
      ctime: 0,
      uname: '',
      mid: '',
      message: title,
      platform: 'tieba',
      keyword: String(keyword || thread?.keyword || ''),
    });
  }
  return comments;
}

async function fetchTextWithTimeout(fetchImpl, url, init, timeoutMs) {
  if (!timeoutMs || typeof AbortController === 'undefined') {
    const response = await fetchImpl(url, init);
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    const buffer = await response.arrayBuffer();
    return decodeTiebaHtmlResponse(buffer, response.headers?.get?.('content-type') || '');
  }
  const controller = new AbortController();
  const callerSignal = init?.signal;
  const signal =
    callerSignal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([callerSignal, controller.signal])
      : callerSignal || controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetchImpl(url, { ...init, signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    const buffer = await response.arrayBuffer();
    return decodeTiebaHtmlResponse(buffer, response.headers?.get?.('content-type') || '');
  } finally {
    clearTimeout(timer);
  }
}

async function defaultFetchText(url, referer, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const mobile = String(url || '').includes('/mo/');
  const signal =
    options.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([options.signal])
      : options.signal;
  try {
    const html = await fetchTextWithTimeout(
      fetchImpl,
      url,
      {
        ...(signal ? { signal } : {}),
        headers: {
          'user-agent': options.userAgent || (mobile ? MOBILE_USER_AGENT : DEFAULT_USER_AGENT),
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
          referer,
        },
      },
      options.requestTimeoutMs,
    );
    assertNotTiebaSafetyVerification(html, url);
    return html;
  } catch (error) {
    if ([...TIEBA_BLOCK_STATUSES].some((status) => String(error.message).includes(`HTTP ${status}`))) {
      error.tiebaBlocked = true;
    }
    throw error;
  }
}

function buildTiebaDiscoveryUrl(query, page, mode = 'mobile') {
  const normalizedMode = String(mode || 'mobile').toLowerCase();
  if (normalizedMode === 'desktop') {
    const url = new URL(`${TIEBA_BASE}/f`);
    url.searchParams.set('kw', query);
    url.searchParams.set('pn', String(page * 50));
    return url;
  }
  const url = new URL(`${TIEBA_BASE}/mo/q/m`);
  url.searchParams.set('kw', query);
  if (page > 0) url.searchParams.set('pn', String(page + 1));
  return url;
}

async function scheduleRequest(config, deps = {}) {
  const waitFn = deps.waitFn || wait;
  const randomFn = deps.randomFn || Math.random;
  const delay = config.minDelayMs + Math.floor(randomFn() * config.jitterMs);
  if (delay > 0) await waitFn(delay);
}

async function withTimeout(run, timeoutMs, message) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  if (!ms) return run({});
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timer;
  try {
    return await Promise.race([
      run(controller ? { signal: controller.signal } : {}),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller?.abort();
          reject(new Error(message));
        }, ms);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function discoverTiebaThreads(keyword, options = {}, deps = {}) {
  const query = String(keyword || '').trim();
  if (!query) return [];
  const config = readTiebaConfig(options, options.env || process.env);
  const fetchText = deps.fetchText || defaultFetchText;
  const pages = boundedInt(options.pages, 1, 1, 10);
  const limit = boundedInt(options.limit, 10, 1, 50);
  const threads = [];
  const seen = new Set();

  for (let page = 0; page < pages && threads.length < limit; page += 1) {
    if (page > 0) await scheduleRequest(config, deps);
    const url = buildTiebaDiscoveryUrl(query, page, config.discoveryMode);
    const html = await fetchText(url.toString(), `${TIEBA_BASE}/`, { requestTimeoutMs: config.requestTimeoutMs, signal: options.signal });
    assertNotTiebaSafetyVerification(html, url.toString());
    for (const thread of parseTiebaThreads(html, query)) {
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      threads.push(thread);
      if (threads.length >= limit) break;
    }
  }
  return threads;
}

export async function fetchTiebaThreadComments(thread, options = {}, deps = {}) {
  const id = String(thread?.id || '').trim();
  if (!id) return [];
  const config = readTiebaConfig(options, options.env || process.env);
  const fetchText = deps.fetchText || defaultFetchText;
  const pages = boundedInt(options.pages, 1, 1, 10);
  const comments = [];
  const seen = new Set();

  for (let page = 1; page <= pages; page += 1) {
    if (page > 1) await scheduleRequest(config, deps);
    const url = new URL(thread.fetchUrl || absoluteTiebaThreadUrl(id));
    url.searchParams.set('pn', String(page));
    const html = await fetchText(url.toString(), thread.sourceUrl || `${TIEBA_BASE}/`, { requestTimeoutMs: config.requestTimeoutMs, signal: options.signal });
    assertNotTiebaSafetyVerification(html, url.toString());
    for (const comment of parseTiebaThreadComments(html, thread)) {
      if (seen.has(comment.rpid)) continue;
      seen.add(comment.rpid);
      comments.push(comment);
    }
  }
  return comments;
}

export async function scrapeTiebaThreadUrls(urls = [], options = {}, deps = {}) {
  const config = readTiebaConfig(options, options.env || process.env);
  const warnings = [];
  const comments = [];
  const threads = [];
  const seenThreads = new Set();
  const seenComments = new Set();

  for (const value of Array.isArray(urls) ? urls : []) {
    const thread = threadFromTiebaUrl(value, options.keyword || '');
    if (!thread || seenThreads.has(thread.id)) continue;
    seenThreads.add(thread.id);
    if (threads.length > 0) await scheduleRequest(config, deps);
    threads.push(thread);
    try {
      const threadComments = await fetchTiebaThreadComments(thread, options, deps);
      for (const comment of threadComments) {
        const key = `${comment.sourceUrl || ''}\n${comment.rpid || ''}\n${comment.message || ''}`;
        if (seenComments.has(key)) continue;
        seenComments.add(key);
        comments.push(comment);
      }
    } catch (error) {
      warnings.push(`${thread.sourceUrl}: ${error.message}`);
      if (error.tiebaBlocked && config.blockCooldownMs > 0) {
        await (deps.waitFn || wait)(config.blockCooldownMs);
      }
    }
  }

  return {
    ok: comments.length > 0 && warnings.length === 0,
    threads,
    comments,
    commentText: comments.map((comment) => comment.message).join('\n'),
    warnings,
  };
}

export async function scrapeTiebaKeyword(keyword, options = {}, deps = {}) {
  const config = readTiebaConfig(options, options.env || process.env);
  const overallTimeoutMs = Math.max(0, Number(options.overallTimeoutMs ?? options.queryTimeoutMs ?? process.env.TIEBA_SCRAPER_OVERALL_TIMEOUT_MS ?? 0) || 0);
  const warnings = [];
  let threads = [];
  try {
    threads = await withTimeout(
      (timeoutOptions) => discoverTiebaThreads(
        keyword,
        { ...options, ...timeoutOptions, pages: options.forumPages ?? options.pages, limit: options.threadLimit },
        deps,
      ),
      overallTimeoutMs,
      `Tieba discovery for "${keyword}" timed out after ${overallTimeoutMs}ms`,
    );
  } catch (error) {
    warnings.push(`discover: ${error.message}`);
    if (error.tiebaBlocked && config.blockCooldownMs > 0) await (deps.waitFn || wait)(config.blockCooldownMs);
  }

  const comments = [];
  const seen = new Set();
  if (options.discoveryTitlesOnly === true) {
    for (const comment of tiebaThreadsToDiscoveryComments(threads, keyword)) {
      const key = `${comment.rpid}\n${comment.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      comments.push(comment);
    }
  } else {
  for (const thread of threads) {
    await scheduleRequest(config, deps);
    try {
      const threadComments = await withTimeout(
        (timeoutOptions) => fetchTiebaThreadComments(thread, { ...options, ...timeoutOptions, pages: options.threadPages ?? 1 }, deps),
        overallTimeoutMs,
        `Tieba thread scan for "${thread.sourceUrl}" timed out after ${overallTimeoutMs}ms`,
      );
      for (const comment of threadComments) {
        const key = `${comment.rpid}\n${comment.message}`;
        const textKey = comment.message;
        if (seen.has(key) || seen.has(textKey)) continue;
        seen.add(key);
        seen.add(textKey);
        comments.push(comment);
      }
    } catch (error) {
      warnings.push(`${thread.sourceUrl}: ${error.message}`);
      if (error.tiebaBlocked && config.blockCooldownMs > 0) await (deps.waitFn || wait)(config.blockCooldownMs);
    }
  }
  }

  if (comments.length === 0 && options.includeDiscoveryTitles === true && threads.length > 0) {
    for (const comment of tiebaThreadsToDiscoveryComments(threads, keyword)) {
      const key = `${comment.rpid}\n${comment.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      comments.push(comment);
    }
  }

  return {
    ok: threads.length > 0 || comments.length > 0,
    keyword: String(keyword || '').trim(),
    threads,
    comments,
    commentText: comments.map((comment) => comment.message).filter(Boolean).join('\n'),
    source: 'Tieba public thread scan',
    confidenceHint: comments.length >= 80 ? 'large Tieba sample' : comments.length >= 20 ? 'medium Tieba sample' : 'small Tieba sample',
    warnings,
  };
}
