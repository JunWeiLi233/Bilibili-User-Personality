import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resetBilibiliRequestState } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary, readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const PROGRESS_PATH = join(DATA_DIR, 'uid-discovery-progress.json');
const UID_COMMENTS_PATH = join(DATA_DIR, 'uid-discovery-comments.json');
const USER_DB_PATH = join(DATA_DIR, 'scraped-users-db.json');

const DELAY_MS = 600;
const LOCK_PATH = join(DATA_DIR, 'deepseekKeywordDictionary.json.lock');
const LOCK_RETRY_DELAY_MS = 5000;
const LOCK_MAX_RETRIES = 15;
const SAVE_EVERY = 100;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

process.on('uncaughtException', (err) => {
  console.error('Uncaught:', err.stack || err.message || err);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled:', err?.stack || err?.message || err);
});
process.on('exit', (code) => {
  console.log(`Process exiting with code ${code}`);
});

async function loadJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return fallback; }
}

async function saveJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
}

async function trainWithRetry(payload, options, maxRetries = LOCK_MAX_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await trainKeywordDictionary({ ...payload, multiagent: true }, { ...options, multiagent: true });
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('lock') || msg.includes('already running') || msg.includes('EPERM') || msg.includes('EBUSY') || msg.includes('rename')) {
        if (attempt <= 2 || attempt % 5 === 0) {
          console.log(`  Retry ${attempt}/${maxRetries}: ${msg.slice(0, 80)}...`);
        }
        await rm(LOCK_PATH, { recursive: true, force: true }).catch(() => {});
        await wait(LOCK_RETRY_DELAY_MS + Math.random() * 2000);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Lock retries exhausted');
}

// Direct fetch bypassing the crawler's rate limiter
async function directFetchJson(url, referer) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Referer': referer || 'https://www.bilibili.com',
      'Accept': 'application/json',
    },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// BVID to AID conversion
const XOR_CODE = 23442827791579n;
const MAX_AID = 1n << 51n;
const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
const DECODE_MAP = new Map();
for (let i = 0; i < ALPHABET.length; i++) DECODE_MAP.set(ALPHABET[i], BigInt(i));
const BASE = BigInt(ALPHABET.length);

function bvidToAid(bvid) {
  const chars = bvid.slice(2).split('').reverse();
  let result = 0n;
  for (const ch of chars) {
    const val = DECODE_MAP.get(ch);
    if (val === undefined) return null;
    result = result * BASE + val;
  }
  result = (result & MAX_AID) ^ XOR_CODE;
  return Number(result);
}

async function scanVideoComments(bvid, aid, uidCommentsMap) {
  // If no aid provided, resolve via view API
  if (!aid) {
    try {
      const viewData = await directFetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, 'https://www.bilibili.com');
      if (viewData.code === 0) aid = viewData.data?.aid;
    } catch {}
  }
  if (!aid) return 0;

  let totalComments = 0;
  let next = 0;
  for (let page = 0; page < 2; page++) {
    const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3&next=${next}&ps=20`;
    let data;
    try {
      data = await directFetchJson(url, `https://www.bilibili.com/video/${bvid}/`);
    } catch { break; }
    if (!data || data.code !== 0) break;

    const replies = data.data?.replies || [];
    for (const reply of replies) {
      const uid = String(reply.member?.mid || '');
      const message = reply.content?.message || '';
      const uname = reply.member?.uname || '';
      if (!uid || uid === '0' || !message) continue;
      if (!uidCommentsMap.has(uid)) uidCommentsMap.set(uid, []);
      uidCommentsMap.get(uid).push({ message, uname, bvid });
      totalComments++;

      // Also collect sub-replies
      for (const sub of reply.replies || []) {
        const subUid = String(sub.member?.mid || '');
        const subMsg = sub.content?.message || '';
        const subName = sub.member?.uname || '';
        if (!subUid || subUid === '0' || !subMsg) continue;
        if (!uidCommentsMap.has(subUid)) uidCommentsMap.set(subUid, []);
        uidCommentsMap.get(subUid).push({ message: subMsg, uname: subName, bvid });
        totalComments++;
      }
    }

    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end) break;
    next = cursor.next || 0;
    if (!next) break;
    await wait(200);
  }
  return totalComments;
}

async function collectVideoQueue(scannedSet) {
  const queue = []; // Each entry: { bvid, aid }
  const seen = new Set(scannedSet);

  // Source 1: Popular videos
  console.log('Collecting popular videos...');
  for (let page = 1; page <= 30; page++) {
    try {
      const data = await directFetchJson(`https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=20`, 'https://www.bilibili.com/v/popular/all');
      if (data.code === 0 && data.data?.list?.length > 0) {
        for (const item of data.data.list) {
          if (item.bvid && !seen.has(item.bvid)) { queue.push({ bvid: item.bvid, aid: item.aid }); seen.add(item.bvid); }
        }
      } else break;
    } catch { break; }
    await wait(300);
  }
  console.log(`  Popular: ${queue.length} videos`);

  // Source 2: Ranking by category
  const rankingCategories = [
    0, 1, 3, 4, 5, 36, 119, 129, 155, 160, 165, 167, 168,
    176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188,
    202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214,
    215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227,
    228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240,
    241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253,
    254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266,
    267, 268, 269,
  ];
  console.log('Collecting ranking by category...');
  for (const rid of rankingCategories) {
    try {
      const data = await directFetchJson(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${rid}&type=all`, 'https://www.bilibili.com/v/popular/rank/all');
      if (data.code === 0 && data.data?.list) {
        for (const item of data.data.list) {
          if (item.bvid && !seen.has(item.bvid)) { queue.push({ bvid: item.bvid, aid: item.aid }); seen.add(item.bvid); }
        }
      }
    } catch {}
    await wait(300);
  }
  console.log(`  Ranking done: ${queue.length} total videos`);

  // Source 3: Search
  const searchKeywords = [
    '游戏', '音乐', '动画', '科技', '美食', '生活', '搞笑', '知识',
    '影视', '舞蹈', '绘画', 'vlog', '日常', '测评', '教程', '编程',
    '电影', '动漫', '新闻', '体育', '旅行', '时尚', '汽车', '宠物',
    '健身', '读书', '历史', '天文', '物理', '化学', '数学', '英语',
    '日本', '美国', '中国', '韩国', '旅游', '摄影', '设计', '心理',
    '哲学', '经济', '法律', '医学', '生物', '编程入门', '游戏攻略',
    '音乐翻唱', '美食制作', '健身教程', '减肥', '考研', '留学',
    '电竞', '手游', '独立游戏', '说唱', '摇滚', '古典音乐',
    '漫画', '网文', '科幻', '人工智能', '机器学习', '区块链',
    '无人机', 'VR', 'ASMR', '吃播', '开箱', '挑战',
    '篮球', '足球', '钢琴', '吉他', '素描', '油画',
    '韩剧', '美剧', '恐怖片', '喜剧片', '纪录片', '综艺',
    '相声', '脱口秀', '演讲', '数学题', '英语口语',
    '穿搭', '护肤', '化妆', '宠物猫', '宠物狗', '养花',
    '3D打印', '量子', '太空', '机器人',
  ];
  console.log(`Collecting search results for ${searchKeywords.length} keywords...`);
  let searchAdded = 0;
  for (const keyword of searchKeywords) {
    try {
      const data = await directFetchJson(
        `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&order=click&page=1`,
        'https://search.bilibili.com'
      );
      if (data.code === 0 && data.data?.result) {
        for (const item of data.data.result) {
          if (item.bvid && !seen.has(item.bvid)) { queue.push({ bvid: item.bvid, aid: item.aid }); seen.add(item.bvid); searchAdded++; }
        }
      }
    } catch {}
    await wait(300);
  }
  console.log(`  Search: ${searchAdded} new, ${queue.length} total videos`);

  return queue;
}

async function main() {
  const progress = await loadJson(PROGRESS_PATH, {
    scannedBvids: [],
    processedUids: {},
    stats: { videosScanned: 0, uidsFound: 0, uidsAnalyzed: 0, commentsCollected: 0, errors: 0 },
    phase: 'discovery',
    lastUpdated: null,
  });

  const userDb = await loadJson(USER_DB_PATH, { users: {} });

  console.log('=== UID Discovery Scraper v4 (fast) ===');
  console.log(`Previously: ${progress.scannedBvids.length} videos scanned\n`);

  const scannedSet = new Set(progress.scannedBvids);
  // Load uidComments from separate file to avoid progress file corruption
  const savedComments = await loadJson(UID_COMMENTS_PATH, null);
  const uidComments = new Map(
    savedComments ? Object.entries(savedComments) : []
  );

  // Skip Phase 1+2 if resuming from analysis phase with comments data
  if (progress.phase === 'analysis' && uidComments.size > 0) {
    console.log(`Resuming from analysis phase with ${uidComments.size} UIDs, skipping Phase 1+2\n`);
  } else {
  // Phase 1: Collect video queue
  console.log('=== Phase 1: Building video queue ===');
  const videoQueue = await collectVideoQueue(scannedSet);
  console.log(`\nTotal unique videos to scan: ${videoQueue.length}\n`);

  progress.phase = 'scanning';
  progress.videoQueueSize = videoQueue.length;
  await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });

  // Phase 2: Scan videos for comments (using direct fetch for speed)
  console.log('=== Phase 2: Scanning videos for comments ===');
  let consecutiveErrors = 0;
  for (let i = 0; i < videoQueue.length; i++) {
    const entry = videoQueue[i];
    const bvid = entry.bvid;
    if (scannedSet.has(bvid)) continue;

    const count = await scanVideoComments(bvid, entry.aid || 0, uidComments);
    scannedSet.add(bvid);
    progress.stats.videosScanned++;
    progress.stats.commentsCollected += count;

    if (count === 0) consecutiveErrors++;
    else consecutiveErrors = 0;

    if (consecutiveErrors >= 20) {
      console.log('  20 consecutive empty results, backing off 15s...');
      await wait(15000);
      consecutiveErrors = 0;
    }

    if (i % SAVE_EVERY === 0 && i > 0) {
      console.log(`  ${i}/${videoQueue.length}: ${progress.stats.videosScanned} videos, ${uidComments.size} UIDs, ${progress.stats.commentsCollected} comments`);
      progress.scannedBvids = [...scannedSet];
      progress.stats.uidsFound = uidComments.size;
      await saveJson(UID_COMMENTS_PATH, Object.fromEntries([...uidComments].map(([uid, c]) => [uid, c])));
      await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
    }

    await wait(DELAY_MS);
  }

  // Save Phase 2 results
  progress.scannedBvids = [...scannedSet];
  progress.stats.uidsFound = uidComments.size;
  await saveJson(UID_COMMENTS_PATH, Object.fromEntries([...uidComments].map(([uid, c]) => [uid, c])));
  await saveJson(PROGRESS_PATH, { ...progress, phase: 'analysis', lastUpdated: new Date().toISOString() });
  } // end else (skip Phase 1+2 check)

  // Phase 3: Analyze each UID's comments
  console.log(`\n=== Phase 3: Analyzing ${uidComments.size} UIDs ===`);
  let analyzed = 0;
  let skipped = 0;

  for (const [uid, comments] of uidComments) {
    if (progress.processedUids[uid]) { skipped++; continue; }

    const commentText = comments.map(c => c.message).filter(Boolean).join('\n');
    if (!commentText.trim()) {
      progress.processedUids[uid] = 'no_text';
      skipped++;
      continue;
    }

    userDb.users[uid] = {
      uid,
      uname: comments[0]?.uname || '',
      commentCount: comments.length,
      commentText: commentText.slice(0, 5000),
      bvids: [...new Set(comments.map(c => c.bvid))],
      scrapedAt: new Date().toISOString(),
    };

    try {
      await trainWithRetry({
        text: commentText,
        uid,
        source: `UID ${uid} (${comments[0]?.uname || ''}) - ${comments.length} comments from ${new Set(comments.map(c => c.bvid)).size} videos`,
      }, { existingTermsOnly: false });

      progress.processedUids[uid] = 'success';
      analyzed++;
      progress.stats.uidsAnalyzed++;
    } catch (e) {
      progress.processedUids[uid] = 'error';
      progress.stats.errors++;
    }

    if (analyzed % 10 === 0) {
      console.log(`  Analyzed ${analyzed}/${uidComments.size - skipped} UIDs...`);
      await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
      await saveJson(USER_DB_PATH, userDb);
    }
  }

  // Final save
  await saveJson(PROGRESS_PATH, { ...progress, lastUpdated: new Date().toISOString() });
  await saveJson(USER_DB_PATH, userDb);

  console.log('\n=== DONE ===');
  console.log(`Videos scanned: ${progress.stats.videosScanned}`);
  console.log(`Comments collected: ${progress.stats.commentsCollected}`);
  console.log(`Unique UIDs found: ${progress.stats.uidsFound}`);
  console.log(`UIDs analyzed: ${progress.stats.uidsAnalyzed}`);
  console.log(`Errors: ${progress.stats.errors}`);

  try {
    const dict = await readKeywordDictionary();
    console.log(`Dictionary: ${dict.entries.length} entries`);
  } catch {}
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
