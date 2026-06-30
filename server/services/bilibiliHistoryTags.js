import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const DEFAULT_BILIBILI_HISTORY_TAG_CORPUS_PATH = 'server/data/bilibiliHistoryTagCorpus.json';

// Expanded via browser-harness Bilibili tag discovery (2026-06-25)
// 189 curated history-relevant seeds: dynasties, figures, events, wars, archaeology, genres
const DEFAULT_HISTORY_TAG_SEEDS = [
  '一战',
  '七下历史',
  '三国',
  '上高会战',
  '世界历史',
  '世界古代史',
  '世界近代史',
  '中世纪',
  '中东',
  '中华',
  '中华上下五千年',
  '中国',
  '中国历代疆域变化',
  '中国历史',
  '中国历史动画',
  '中国古代史',
  '中国文化',
  '中国现代史',
  '中国近代史',
  '中国风',
  '中外历史纲要',
  '中晚唐',
  '中考历史',
  '乌克兰',
  '乾隆',
  '二战',
  '五代十国',
  '亚历山大大帝',
  '人文历史',
  '人文历史档案馆',
  '人文历史档案馆2022第二季',
  '会津战争',
  '伯罗奔尼撒战争',
  '俄乌冲突',
  '俄乌战争',
  '俄罗斯',
  '儒家思想',
  '八下历史',
  '军事',
  '军事历史',
  '冷战',
  '初中历史',
  '华夏',
  '南北朝',
  '博物馆',
  '历史',
  '历史事件',
  '历史人物',
  '历史剧',
  '历史动画',
  '历史地图',
  '历史复习',
  '历史故事',
  '历史知识',
  '历史科普',
  '历史老师',
  '历史解说',
  '历史课本',
  '历史课程',
  '古代史',
  '古墓',
  '古希腊',
  '古文复兴运动',
  '古装剧',
  '史图馆',
  '史记',
  '周朝',
  '唐代',
  '唐朝',
  '商朝',
  '嘉靖',
  '国际关系',
  '国际关系史',
  '国际形势',
  '地图',
  '地方',
  '地理',
  '夏朝',
  '多尔衮',
  '大唐',
  '大唐兴亡三百年',
  '大明',
  '大明王朝1566',
  '大清',
  '孙中山',
  '安史之乱',
  '宋史',
  '宋夏战争',
  '宋朝',
  '宗教',
  '岳飞',
  '幕末',
  '庆历新政',
  '康熙',
  '开元盛世',
  '德国',
  '德川庆喜',
  '战争',
  '战争史',
  '战役',
  '战略',
  '抗日战争',
  '拿破仑',
  '文化',
  '文化自信',
  '文化遗产',
  '文明',
  '文物',
  '新选组',
  '日本',
  '日本战国',
  '明史',
  '明朝',
  '晋朝',
  '晚唐',
  '曾国藩',
  '朝代',
  '李世民',
  '李渊',
  '李隆基',
  '杯酒释兵权',
  '架空历史',
  '梦华录',
  '梦回唐朝',
  '欧洲',
  '武则天',
  '殷墟',
  '民国',
  '汉代',
  '汉朝',
  '河姆渡',
  '法国',
  '法门寺',
  '波黑',
  '洪秀全',
  '海瑞',
  '清史',
  '清平乐',
  '清朝',
  '爆笑中国历史',
  '玄武门之变',
  '甲午战争',
  '疆域',
  '皇帝',
  '盛唐',
  '看动画学历史知识',
  '科技考古',
  '秦代',
  '秦始皇',
  '秦始皇陵',
  '秦汉',
  '穿越',
  '第一次世界大战',
  '箱馆战争',
  '红山文化',
  '织田信长',
  '统治',
  '考古',
  '考古专业',
  '考古学',
  '良渚文化',
  '苏轼',
  '英国',
  '英荷战争',
  '范仲淹',
  '觉醒年代',
  '解放军',
  '讲历史张老师全121集',
  '贞观之治',
  '资本主义萌芽',
  '赵匡胤',
  '赵构',
  '辛亥革命',
  '近代史',
  '通俗历史',
  '金沙',
  '陵西大墓',
  '隋朝',
  '雅典',
  '雍正',
  '马王堆',
  '高一历史',
  '高三历史',
  '高中历史',
  '高二历史',
  '高考历史',
  '鸟羽伏见之战',
  '鸦片战争',
  '元朝',
  '春秋',
  '战国',
  '楚汉',
  '蒙古帝国',
  '丝绸之路',
  '敦煌',
  '黄袍加身',
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
  // Bilibili API titles are plain text — only XML character entities need decoding.
  return String(value || '')
    .replace(/&(?:quot|amp|#39);/g, (entity) => ({ '&quot;': '"', '&amp;': '&', '&#39;': "'" })[entity] || entity)
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
