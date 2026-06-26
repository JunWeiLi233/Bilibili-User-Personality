import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function loadTop5() {
  const raw = await readFile(join(__dirname, 'top5_per_seed.json'), 'utf8');
  return JSON.parse(raw);
}

async function loadProgress() {
  try {
    const raw = await readFile(join(__dirname, 'scrape_progress.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { completed: [], lastSeed: null, totalVideos: 0, totalComments: 0, totalDanmaku: 0 };
  }
}

async function saveProgress(progress) {
  await writeFile(join(__dirname, 'scrape_progress.json'), JSON.stringify(progress, null, 2), 'utf8');
}

async function saveSeedResults(seed, results) {
  const dir = join(__dirname, 'seed_results');
  await mkdir(dir, { recursive: true });
  const safeName = seed.replace(/[<>:"/\\|?*]/g, '_');
  await writeFile(join(dir, `${safeName}.json`), JSON.stringify(results, null, 2), 'utf8');
}

async function main() {
  // Dynamic import of crawler
  const crawler = await import('../server/services/bilibiliCrawler.js');

  const top5 = await loadTop5();
  const seeds = Object.keys(top5);
  console.log(`Total seeds: ${seeds.length}`);

  const progress = await loadProgress();
  const completed = new Set(progress.completed || []);
  console.log(`Previously completed: ${completed.size} seeds`);

  let totalComments = progress.totalComments || 0;
  let totalDanmaku = progress.totalDanmaku || 0;
  let totalVideos = progress.totalVideos || 0;

  const remaining = seeds.filter(s => !completed.has(s));
  console.log(`Remaining: ${remaining.length} seeds`);

  for (let i = 0; i < remaining.length; i++) {
    const seed = remaining[i];
    const videos = top5[seed];

    console.log(`\n[${i+1}/${remaining.length}] Seed: ${seed} (${videos.length} videos)`);

    const seedResults = { seed, scrapedAt: new Date().toISOString(), videos: [] };

    for (let j = 0; j < videos.length; j++) {
      const v = videos[j];
      try {
        console.log(`  Video ${j+1}/${videos.length}: ${v.bvid} (replies: ${v.replyCount})`);
        const result = await crawler.fetchRepliesForVideo(v.bvid, {
          pages: 1,
          includeDanmaku: true,
        });

        if (result.ok) {
          const comments = result.comments || [];
          const regularComments = comments.filter(c => c.kind !== 'danmaku');
          const danmaku = comments.filter(c => c.kind === 'danmaku');

          seedResults.videos.push({
            bvid: v.bvid,
            title: v.title,
            replyCount: v.replyCount,
            comments: regularComments.length,
            danmaku: danmaku.length,
            commentMessages: regularComments.map(c => ({
              message: c.message?.slice(0, 200),
              time: c.time || c.ctime,
              likes: c.like || 0,
            })),
            danmakuMessages: danmaku.slice(0, 500).map(d => ({
              message: d.message?.slice(0, 200),
              time: d.time || d.ctime,
            })),
          });

          totalComments += regularComments.length;
          totalDanmaku += danmaku.length;
          console.log(`    -> ${regularComments.length} comments, ${danmaku.length} danmaku`);
        } else {
          console.log(`    -> FAILED: ${result.error}`);
          seedResults.videos.push({ bvid: v.bvid, error: result.error });
        }
      } catch (e) {
        console.log(`    -> ERROR: ${e.message}`);
        seedResults.videos.push({ bvid: v.bvid, error: e.message });
      }
    }

    totalVideos += videos.length;

    // Save per-seed results
    await saveSeedResults(seed, seedResults);

    // Update progress
    completed.add(seed);
    progress.completed = [...completed];
    progress.lastSeed = seed;
    progress.totalVideos = totalVideos;
    progress.totalComments = totalComments;
    progress.totalDanmaku = totalDanmaku;
    await saveProgress(progress);

    // Progress summary every 10 seeds
    if ((i + 1) % 10 === 0) {
      console.log(`\n--- Progress: ${completed.size}/${seeds.length} seeds | ${totalVideos} videos | ${totalComments} comments | ${totalDanmaku} danmaku ---`);
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Seeds: ${completed.size}/${seeds.length}`);
  console.log(`Videos: ${totalVideos}`);
  console.log(`Comments: ${totalComments}`);
  console.log(`Danmaku: ${totalDanmaku}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
