import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH = 'server/data/bilibiliHistoryTagCorpus.json';

const DEFAULT_HISTORY_TAG_SEEDS = [
  '历史',
  '中国历史',
  '世界历史',
  '近代史',
  '古代史',
  '历史科普',
  '历史解说',
  '历史人物',
  '历史事件',
  '战争史',
  '军事历史',
  '考古',
  '文物',
  '博物馆',
  '明朝',
  '清朝',
  '三国',
  '秦汉',
  '唐朝',
  '宋朝',
  '民国',
];

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '')
    .toLowerCase();
}

function cleanTitle(value, fallback = '') {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim() || fallback;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function queryNeedles(searchQueries = [], targetTerms = []) {
  return uniqueBy(
    [...parseList(searchQueries), ...parseList(targetTerms)]
      .flatMap((item) => [item, ...String(item).split(/\s+/)])
      .map(cleanText)
      .filter((item) => item.length >= 2),
    (item) => item,
  );
}

function videoText(video = {}) {
  return cleanText([video.title, video.description, video.desc, video.dynamic, ...(video.tags || [])].filter(Boolean).join(' '));
}

function scoreHistoryVideo(video, needles) {
  const text = videoText(video);
  if (!text) return 0;
  let score = 0;
  for (const needle of needles) {
    if (text.includes(needle)) score += needle.length >= 4 ? 3 : 1;
  }
  if (Array.isArray(video.tags) && video.tags.some((tag) => cleanText(tag).includes('历史'))) score += 2;
  if (cleanText(video.sourceQuery).includes('历史')) score += 1;
  return score;
}

async function writeJsonAtomic(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export function defaultBilibiliHistoryTagSeeds() {
  return [...DEFAULT_HISTORY_TAG_SEEDS];
}

export async function readBilibiliHistoryTagCorpus(path = DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH) {
  try {
    const corpus = JSON.parse(await readFile(path, 'utf8'));
    return {
      version: 1,
      updatedAt: null,
      tags: [],
      videos: [],
      runs: [],
      ...corpus,
      tags: Array.isArray(corpus.tags) ? corpus.tags : [],
      videos: Array.isArray(corpus.videos) ? corpus.videos : [],
      runs: Array.isArray(corpus.runs) ? corpus.runs : [],
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { version: 1, updatedAt: null, tags: [], videos: [], runs: [] };
    throw error;
  }
}

export async function writeBilibiliHistoryTagCorpus(path, corpus) {
  await writeJsonAtomic(path, {
    version: 1,
    updatedAt: new Date().toISOString(),
    tags: Array.isArray(corpus.tags) ? corpus.tags : [],
    videos: Array.isArray(corpus.videos) ? corpus.videos : [],
    runs: Array.isArray(corpus.runs) ? corpus.runs : [],
  });
}

export function mergeBilibiliHistoryTagCorpus(current, update) {
  const tags = uniqueBy([...(current.tags || []), ...(update.tags || [])], (tag) => cleanText(tag.name || tag));
  const videos = uniqueBy(
    [...(current.videos || []), ...(update.videos || [])].map((video) => ({
      ...video,
      bvid: String(video.bvid || '').trim(),
      aid: video.aid == null ? '' : String(video.aid),
      title: cleanTitle(video.title, video.bvid),
      sourceUrl: video.sourceUrl || (video.bvid ? `https://www.bilibili.com/video/${video.bvid}/` : ''),
      tags: uniqueBy(parseList(video.tags), cleanText),
      sourceQuery: String(video.sourceQuery || '').trim(),
      replyCount: Number(video.replyCount || 0),
    })),
    (video) => video.bvid || video.sourceUrl,
  );
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tags,
    videos,
    runs: [...(current.runs || []), ...(update.runs || [])],
  };
}

export function historyTagVideosForSearch(corpus, searchQueries = [], targetTerms = [], limit = 20) {
  const needles = queryNeedles(searchQueries, targetTerms);
  const videos = Array.isArray(corpus?.videos) ? corpus.videos : [];
  const scored = videos
    .map((video) => ({ video, score: needles.length ? scoreHistoryVideo(video, needles) : scoreHistoryVideo(video, ['历史']) }))
    .filter((item) => item.video?.bvid && item.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.video.replyCount || 0) - Number(a.video.replyCount || 0));
  return uniqueBy(
    scored.slice(0, Math.max(1, Number(limit) || 20)).map(({ video }) => ({
      id: `video-1-${video.aid || video.bvid}`,
      kind: 'video',
      bvid: video.bvid,
      oid: String(video.aid || ''),
      replyType: 1,
      title: video.title || video.bvid,
      desc: video.description || video.desc || '',
      sourceUrl: video.sourceUrl || `https://www.bilibili.com/video/${video.bvid}/`,
      replyCount: Number(video.replyCount || 0),
      tags: Array.isArray(video.tags) ? video.tags : [],
      source: 'bilibili-history-tags',
    })),
    (video) => video.bvid,
  );
}

export async function scrapeBilibiliHistoryTags(options = {}, deps = {}) {
  const seeds = parseList(options.seeds).length ? parseList(options.seeds) : DEFAULT_HISTORY_TAG_SEEDS;
  const pages = Math.max(1, Math.min(Number(options.pages || 1), 10));
  const pageSize = Math.max(1, Math.min(Number(options.pageSize || 20), 50));
  const delayMs = Math.max(0, Number(options.delayMs || 0));
  const jitterMs = Math.max(0, Number(options.jitterMs || 0));
  const requestJson = deps.fetchJson;
  const waitFn = deps.waitFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  if (typeof requestJson !== 'function') throw new Error('scrapeBilibiliHistoryTags requires a fetchJson dependency.');

  const videos = [];
  const tags = seeds.map((name) => ({ name, source: 'seed' }));
  const warnings = [];

  for (const seed of seeds) {
    for (let page = 1; page <= pages; page += 1) {
      if (videos.length > 0 && delayMs > 0) {
        const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
        await waitFn(delayMs + jitter);
      }
      const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
      url.searchParams.set('search_type', 'video');
      url.searchParams.set('keyword', seed);
      url.searchParams.set('page', String(page));
      url.searchParams.set('page_size', String(pageSize));
      try {
        const payload = await requestJson(url.toString(), `https://search.bilibili.com/all?keyword=${encodeURIComponent(seed)}`);
        if (payload.code !== 0) throw new Error(payload.message || `Bilibili API code ${payload.code}`);
        for (const item of payload.data?.result || []) {
          if (!item?.bvid) continue;
          videos.push({
            bvid: item.bvid,
            aid: item.aid || item.id || '',
            title: cleanTitle(item.title, item.bvid),
            description: cleanTitle(item.description || item.desc || ''),
            sourceUrl: item.arcurl || `https://www.bilibili.com/video/${item.bvid}/`,
            replyCount: Number(item.review || item.comment || 0),
            tags: uniqueBy([seed, ...(parseList(item.tag || item.tags))], cleanText),
            sourceQuery: seed,
            scrapedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        warnings.push(`${seed} page ${page}: ${error.message}`);
        break;
      }
    }
  }

  return {
    tags: uniqueBy(tags, (tag) => cleanText(tag.name)),
    videos: uniqueBy(videos, (video) => video.bvid),
    runs: [
      {
        at: new Date().toISOString(),
        seeds,
        pages,
        pageSize,
        videosFound: uniqueBy(videos, (video) => video.bvid).length,
        warnings,
      },
    ],
    warnings,
  };
}
