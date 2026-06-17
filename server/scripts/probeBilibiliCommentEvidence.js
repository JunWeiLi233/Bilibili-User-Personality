import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { readKeywordDictionary, mergeEntriesIntoDictionary } from '../services/deepseekKeywordTrainer.js';
import {
  buildBilibiliWebHeaders,
  buildBilibiliReplyUrl,
  buildBilibiliReplyPageUrl,
  buildBilibiliSearchUrls,
  buildBilibiliViewUrl,
  boundedProbeVideosPerQuery,
  collectScannedProbeVideoKeys,
  buildEvidenceSourceVideosForActions,
  buildFreshEvidenceEntriesFromComments,
  buildProbeCorpus,
  collectBilibiliDanmakuMessages,
  collectBilibiliReplyMessages,
  filterUnscannedProbeVideos,
  makeSyntheticBilibiliCookie,
  nextReplyCursor,
  probeVideoKey,
  rankProbeVideosForAction,
} from '../services/directBilibiliEvidenceProbe.js';
import { DEFAULT_COVERAGE_AUDIT_REPORT_PATH } from '../utils/paths.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    auditPath: env.BILIBILI_COVERAGE_AUDIT_REPORT_PATH || DEFAULT_COVERAGE_AUDIT_REPORT_PATH,
    maxActions: boundedInt(env.BILIBILI_DIRECT_PROBE_MAX_ACTIONS, 4, 1, 50),
    offset: boundedInt(env.BILIBILI_DIRECT_PROBE_OFFSET, 0, 0, 1000),
    videosPerQuery: boundedProbeVideosPerQuery(env.BILIBILI_DIRECT_PROBE_VIDEOS_PER_QUERY, 5),
    searchPages: boundedInt(env.BILIBILI_DIRECT_PROBE_SEARCH_PAGES, 1, 1, 10),
    replyPages: boundedInt(env.BILIBILI_DIRECT_PROBE_REPLY_PAGES, 2, 1, 5),
    replyStartPage: boundedInt(env.BILIBILI_DIRECT_PROBE_REPLY_START_PAGE, 1, 1, 20),
    replyPageSize: boundedInt(env.BILIBILI_DIRECT_PROBE_REPLY_PAGE_SIZE, 20, 1, 20),
    replyMode: ['cursor', 'page', 'both'].includes(env.BILIBILI_DIRECT_PROBE_REPLY_MODE) ? env.BILIBILI_DIRECT_PROBE_REPLY_MODE : 'cursor',
    sourceVideosPerAction: boundedInt(env.BILIBILI_DIRECT_PROBE_SOURCE_VIDEOS_PER_ACTION, 6, 0, 50),
    explicitQueries: [],
    explicitAids: [],
    delayMs: boundedInt(env.BILIBILI_DIRECT_PROBE_DELAY_MS, 3000, 1000, 60000),
    jitterMs: boundedInt(env.BILIBILI_DIRECT_PROBE_JITTER_MS, 1500, 0, 60000),
    requestTimeoutMs: boundedInt(env.BILIBILI_DIRECT_PROBE_REQUEST_TIMEOUT_MS, 12000, 3000, 120000),
    outputPath: env.BILIBILI_DIRECT_PROBE_OUTPUT || 'server/data/bilibiliDirectProbeCorpus.json',
    includeDanmaku: env.BILIBILI_DIRECT_PROBE_INCLUDE_DANMAKU === '1',
    rescanSourceVideos: env.BILIBILI_DIRECT_PROBE_RESCAN_SOURCE_VIDEOS === '1',
    write: env.BILIBILI_DIRECT_PROBE_WRITE === '1',
  };
  for (const arg of argv) {
    if (arg.startsWith('--audit=')) options.auditPath = arg.slice('--audit='.length).trim();
    else if (arg.startsWith('--max-actions=')) options.maxActions = boundedInt(arg.slice('--max-actions='.length), options.maxActions, 1, 50);
    else if (arg.startsWith('--offset=')) options.offset = boundedInt(arg.slice('--offset='.length), options.offset, 0, 1000);
    else if (arg.startsWith('--videos=')) options.videosPerQuery = boundedProbeVideosPerQuery(arg.slice('--videos='.length), options.videosPerQuery);
    else if (arg.startsWith('--search-pages=')) options.searchPages = boundedInt(arg.slice('--search-pages='.length), options.searchPages, 1, 10);
    else if (arg.startsWith('--reply-pages=')) options.replyPages = boundedInt(arg.slice('--reply-pages='.length), options.replyPages, 1, 5);
    else if (arg.startsWith('--reply-start-page=')) options.replyStartPage = boundedInt(arg.slice('--reply-start-page='.length), options.replyStartPage, 1, 20);
    else if (arg.startsWith('--reply-page-size=')) {
      options.replyPageSize = boundedInt(arg.slice('--reply-page-size='.length), options.replyPageSize, 1, 20);
    }
    else if (arg.startsWith('--reply-mode=')) {
      const mode = arg.slice('--reply-mode='.length).trim();
      if (['cursor', 'page', 'both'].includes(mode)) options.replyMode = mode;
    }
    else if (arg.startsWith('--source-videos=')) {
      options.sourceVideosPerAction = boundedInt(arg.slice('--source-videos='.length), options.sourceVideosPerAction, 0, 50);
    }
    else if (arg.startsWith('--query=')) {
      options.explicitQueries.push({
        query: arg.slice('--query='.length).trim(),
        term: '',
      });
    }
    else if (arg.startsWith('--term=')) {
      const term = arg.slice('--term='.length).trim();
      if (options.explicitQueries.length) options.explicitQueries[options.explicitQueries.length - 1].term = term;
      else options.explicitQueries.push({ query: term, term });
    }
    else if (arg.startsWith('--aid=')) options.explicitAids.push(arg.slice('--aid='.length).trim());
    else if (arg.startsWith('--aids=')) {
      options.explicitAids.push(...arg.slice('--aids='.length).split(/[,;|]/).map((item) => item.trim()));
    }
    else if (arg.startsWith('--delay-ms=')) options.delayMs = boundedInt(arg.slice('--delay-ms='.length), options.delayMs, 1000, 60000);
    else if (arg.startsWith('--jitter-ms=')) options.jitterMs = boundedInt(arg.slice('--jitter-ms='.length), options.jitterMs, 0, 60000);
    else if (arg.startsWith('--request-timeout-ms=')) {
      options.requestTimeoutMs = boundedInt(arg.slice('--request-timeout-ms='.length), options.requestTimeoutMs, 3000, 120000);
    } else if (arg.startsWith('--output=')) options.outputPath = arg.slice('--output='.length).trim();
    else if (arg === '--include-danmaku') options.includeDanmaku = true;
    else if (arg === '--rescan-source-videos') options.rescanSourceVideos = true;
    else if (arg === '--write') options.write = true;
  }
  options.explicitQueries = options.explicitQueries
    .map((item) => ({
      term: String(item.term || item.query || '').trim(),
      query: String(item.query || item.term || '').trim(),
    }))
    .filter((item) => item.query);
  options.explicitAids = [...new Set(options.explicitAids.map((aid) => aid.replace(/^av/i, '').trim()).filter((aid) => /^\d+$/.test(aid)))];
  return options;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readJsonIfExists(path, fallback) {
  try {
    return await readJson(path);
  } catch {
    return fallback;
  }
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function fetchJson(url, referer, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetch(url, {
      headers: buildBilibiliWebHeaders(referer, { cookie: options.cookie }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(`code ${payload.code}: ${payload.message || 'Bilibili API error'}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, referer, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const response = await fetch(url, {
      headers: buildBilibiliWebHeaders(referer, { cookie: options.cookie }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function discoverVideos(query, options) {
  const videos = [];
  const seen = new Set();
  const excluded = options.excludedVideoKeys instanceof Set ? options.excludedVideoKeys : new Set();
  for (const url of buildBilibiliSearchUrls(query, { pages: options.searchPages, pageSize: 20 })) {
    if (videos.length >= options.videosPerQuery) break;
    const data = await fetchJson(url.toString(), `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`, options);
    for (const video of data.data?.result || []) {
      const candidate = {
        bvid: video.bvid,
        aid: video.aid || video.id,
        title: video.title || video.bvid,
      };
      const key = probeVideoKey(candidate);
      if (!video?.bvid || !key || seen.has(key) || excluded.has(key) || Number(video.review || video.comment || 0) <= 0) continue;
      seen.add(key);
      videos.push(candidate);
      if (videos.length >= options.videosPerQuery) break;
    }
    if (videos.length < options.videosPerQuery && options.searchPages > 1) {
      await wait(options.delayMs + Math.floor(Math.random() * options.jitterMs));
    }
  }
  return videos;
}

function mergeVideos(primary = [], fallback = [], limit = 20) {
  const videos = [];
  const seen = new Set();
  for (const video of [...primary, ...fallback]) {
    const key = video.bvid ? `bvid:${video.bvid}` : `aid:${video.aid}`;
    if ((!video.bvid && !video.aid) || seen.has(key)) continue;
    seen.add(key);
    videos.push(video);
    if (videos.length >= limit) break;
  }
  return videos;
}

async function fetchVideoComments(video, options) {
  const comments = [];
  let target = video;
  if (!target.aid) {
    const viewUrl = buildBilibiliViewUrl(target);
    if (!viewUrl) throw new Error('missing video aid/bvid');
    const view = await fetchJson(
      viewUrl.toString(),
      target.bvid ? `https://www.bilibili.com/video/${target.bvid}/` : 'https://www.bilibili.com/',
      options,
    );
    if (!view.data?.aid) throw new Error('missing video aid from view response');
    target = {
      ...target,
      aid: view.data.aid,
      bvid: target.bvid || view.data.bvid,
    };
  }
  if (options.replyMode === 'cursor' || options.replyMode === 'both') {
    let cursor = 0;
    for (let page = 0; page < options.replyPages; page += 1) {
      await wait(options.delayMs + Math.floor(Math.random() * options.jitterMs));
      const url = buildBilibiliReplyUrl(target, cursor, options.replyPageSize);
      if (!url) throw new Error('missing video aid for replies');
      const data = await fetchJson(
        url.toString(),
        target.bvid ? `https://www.bilibili.com/video/${target.bvid}/` : `https://www.bilibili.com/video/av${target.aid}/`,
        options,
      );
      collectBilibiliReplyMessages(data.data?.replies || [], target, comments);
      const nextCursor = nextReplyCursor(data, cursor);
      if (nextCursor === null) break;
      cursor = nextCursor;
    }
  }
  if (options.replyMode === 'page' || options.replyMode === 'both') {
    const startPage = Math.max(1, Number(options.replyStartPage) || 1);
    const endPage = startPage + options.replyPages - 1;
    for (let page = startPage; page <= endPage; page += 1) {
      await wait(options.delayMs + Math.floor(Math.random() * options.jitterMs));
      const url = buildBilibiliReplyPageUrl(target, page, options.replyPageSize);
      if (!url) throw new Error('missing video aid for page replies');
      const data = await fetchJson(
        url.toString(),
        target.bvid ? `https://www.bilibili.com/video/${target.bvid}/` : `https://www.bilibili.com/video/av${target.aid}/`,
        options,
      );
      collectBilibiliReplyMessages(data.data?.replies || [], target, comments);
      if (!data.data?.replies?.length) break;
    }
  }
  return comments;
}

async function fetchVideoDanmaku(video, options) {
  const viewUrl = buildBilibiliViewUrl(video);
  if (!viewUrl) throw new Error('missing video aid/bvid');
  const view = await fetchJson(
    viewUrl.toString(),
    video.bvid ? `https://www.bilibili.com/video/${video.bvid}/` : `https://www.bilibili.com/video/av${video.aid}/`,
    options,
  );
  const cid = view.data?.cid || view.data?.pages?.[0]?.cid;
  if (!cid) return [];
  await wait(options.delayMs + Math.floor(Math.random() * options.jitterMs));
  const xml = await fetchText(
    `https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`,
    video.bvid ? `https://www.bilibili.com/video/${video.bvid}/` : `https://www.bilibili.com/video/av${video.aid}/`,
    options,
  );
  return collectBilibiliDanmakuMessages(xml, { ...video, cid });
}

const options = parseArgs();
const audit = await readJson(options.auditPath);
const existingCorpus = await readJsonIfExists(options.outputPath, { version: 1, comments: [], runs: [] });
const scannedVideoKeys = collectScannedProbeVideoKeys(existingCorpus);
const dictionary = await readKeywordDictionary();
const actions = options.explicitQueries.length
  ? options.explicitQueries.slice(0, options.maxActions)
  : (audit.nextActions || [])
    .slice(options.offset, options.offset + options.maxActions)
    .map((action) => ({
      term: String(action.term || '').trim(),
      query: String(action.nextQuery || action.query || action.term || '').trim(),
    }))
    .filter((action) => action.query);
if (options.explicitAids.length) {
  actions.unshift({
    term: 'explicit Bilibili AIDs',
    query: 'explicit Bilibili AIDs',
    explicitVideos: options.explicitAids.map((aid) => ({ aid, title: `explicit aid ${aid}` })),
  });
}
const cookie = makeSyntheticBilibiliCookie();
const sourceVideosByTerm = buildEvidenceSourceVideosForActions(dictionary, actions, {
  maxPerAction: options.sourceVideosPerAction,
  corpus: existingCorpus,
});
const allComments = [];
const scannedVideos = [];
const warnings = [];

console.log('Direct Bilibili comment evidence probe');
console.log(
  `Actions: ${actions.length}, search pages/query: ${options.searchPages}, videos/query: ${options.videosPerQuery}, source videos/query: ${options.sourceVideosPerAction}, reply pages/video: ${options.replyPages}`,
);
console.log(`Reply mode: ${options.replyMode}`);
console.log(`Reply page size: ${options.replyPageSize}`);

for (const action of actions) {
  console.log(`- ${action.term || '(unknown term)'}: ${action.query}`);
  let videos = [];
  const sourceVideos = filterUnscannedProbeVideos(sourceVideosByTerm.get(action.term) || [], scannedVideoKeys);
  const unfilteredSourceVideos = sourceVideosByTerm.get(action.term) || [];
  const selectedSourceVideos = options.rescanSourceVideos ? unfilteredSourceVideos : sourceVideos;
  const explicitVideos = Array.isArray(action.explicitVideos) ? action.explicitVideos : [];
  if (selectedSourceVideos.length) console.log(`  existing source videos: ${selectedSourceVideos.length}${options.rescanSourceVideos ? ' (rescan enabled)' : ''}`);
  if (explicitVideos.length) console.log(`  explicit videos: ${explicitVideos.length}`);
  try {
    const searchVideos = explicitVideos.length ? [] : await discoverVideos(action.query, { ...options, cookie, excludedVideoKeys: scannedVideoKeys });
    const rankedSearchVideos = rankProbeVideosForAction(searchVideos, action);
    videos = mergeVideos([...explicitVideos, ...selectedSourceVideos], rankedSearchVideos, options.videosPerQuery + selectedSourceVideos.length + explicitVideos.length);
  } catch (error) {
    warnings.push(`${action.query}: search ${error.message}`);
    console.log(`  search failed: ${error.message}`);
    videos = [...explicitVideos, ...selectedSourceVideos];
    if (!videos.length) continue;
  }
  console.log(`  videos: ${videos.length}`);
  for (const video of videos) {
    const videoKey = probeVideoKey(video);
    if (videoKey) scannedVideoKeys.add(videoKey);
    scannedVideos.push({
      key: videoKey,
      term: action.term,
      query: action.query,
      bvid: video.bvid,
      aid: video.aid,
      title: video.title,
    });
    try {
      const comments = await fetchVideoComments(video, { ...options, cookie });
      allComments.push(...comments);
      console.log(`  ${video.bvid}: ${comments.length} comment(s)`);
    } catch (error) {
      warnings.push(`${action.query} ${video.bvid}: replies ${error.message}`);
      console.log(`  ${video.bvid}: replies failed: ${error.message}`);
    }
    if (options.includeDanmaku || action.query.includes('弹幕')) {
      try {
        const danmaku = await fetchVideoDanmaku(video, { ...options, cookie });
        allComments.push(...danmaku);
        console.log(`  ${video.bvid}: ${danmaku.length} danmaku item(s)`);
      } catch (error) {
        warnings.push(`${action.query} ${video.bvid}: danmaku ${error.message}`);
        console.log(`  ${video.bvid}: danmaku failed: ${error.message}`);
      }
    }
  }
}

const entries = buildFreshEvidenceEntriesFromComments(dictionary, allComments, {
  targetEvidence: 3,
  maxSamplesPerTerm: 3,
  targetTerms: actions.map((action) => action.term),
  requireCommentBackedEvidence: true,
});
console.log(`Comments collected: ${allComments.length}`);
console.log(`Fresh weak-term evidence entries: ${entries.length}`);
for (const entry of entries) console.log(`- [${entry.family}] ${entry.term}: ${entry.evidenceSources.length} sample(s)`);
if (warnings.length) {
  console.log('Warnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

if (!options.write) {
  console.log('Dry run only. Pass --write to merge evidence into the dictionary.');
  process.exit(0);
}

const corpus = buildProbeCorpus(existingCorpus, allComments, {
  at: new Date().toISOString(),
  actions,
  videos: scannedVideos,
  warnings,
});
await writeJson(options.outputPath, corpus);
console.log(`Probe corpus comments: ${corpus.comments.length}`);
console.log(`Probe corpus: ${options.outputPath}`);

if (entries.length) {
  const before = dictionary.entries?.length || 0;
  const next = await mergeEntriesIntoDictionary(entries);
  console.log(`Dictionary entries before: ${before}`);
  console.log(`Dictionary entries after: ${next.entries?.length || 0}`);
}
