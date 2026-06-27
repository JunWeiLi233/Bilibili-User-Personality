/**
 * Cross-domain seed video scraper: gaming + tech domains.
 * Discovers top videos for gaming/tech keywords, scrapes comments,
 * extracts unique UIDs, and saves for downstream 100-user analysis.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const crawler = await import('../server/services/bilibiliCrawler.js');
const aicu = await import('../server/services/commentCoverage.js');

// Gaming + tech keywords on Bilibili
const SEED_KEYWORDS = ['游戏', '电竞', 'LOL', '原神', '王者荣耀', '科技', '数码', '评测', '编程', 'AI'];
const MAX_VIDEOS_PER_SEED = 5;
const MAX_COMMENTS_PER_VIDEO = 100;

const allUids = new Set();
const domainResults = {};

for (const keyword of SEED_KEYWORDS) {
  console.log(`\nSearching: ${keyword}`);
  try {
    const videos = await crawler.discoverVideosByKeyword(keyword, { maxVideos: MAX_VIDEOS_PER_SEED });
    const topVideos = (videos || []).slice(0, MAX_VIDEOS_PER_SEED);
    console.log(`  Found ${topVideos.length} videos`);

    const keywordResults = { keyword, videos: [], totalUids: 0 };

    for (const video of topVideos) {
      const bvid = video.bvid || video.sourceUrl?.match(/BV[\w]+/)?.[0];
      if (!bvid) continue;

      console.log(`  Scraping: ${bvid} (${video.title || 'no title'})`);
      try {
        const result = await crawler.fetchRepliesForVideo(bvid, { pages: 2, includeDanmaku: false });

        if (result.ok && result.comments) {
          const uids = result.comments
            .filter(c => c.mid || c.uid)
            .map(c => String(c.mid || c.uid));
          uids.forEach(uid => allUids.add(uid));

          keywordResults.videos.push({
            bvid,
            title: video.title || result.video?.title,
            comments: result.comments.length,
            uniqueUids: new Set(uids).size,
          });
          keywordResults.totalUids += uids.length;
          console.log(`    ${result.comments.length} comments, ${new Set(uids).size} unique UIDs`);
        } else {
          console.log(`    Skipped (error: ${result.error || 'no comments'})`);
        }
      } catch (e) {
        console.log(`    Error: ${e.message}`);
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 2000));
    }

    domainResults[keyword] = keywordResults;
  } catch (e) {
    console.log(`  Error searching: ${e.message}`);
  }

  // Rate limit between keywords
  await new Promise(r => setTimeout(r, 3000));
}

// Save results
const output = {
  scrapedAt: new Date().toISOString(),
  totalUniqueUids: allUids.size,
  uids: [...allUids],
  domainResults,
};

const outPath = join(__dirname, 'cross_domain_uids_gaming_tech.json');
writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

console.log(`\n=== Cross-Domain Scrape Complete ===`);
console.log(`Total unique UIDs: ${allUids.size}`);
console.log(`Domains: ${Object.keys(domainResults).length}`);
console.log(`Output: ${outPath}`);

// Print summary by keyword
for (const [kw, result] of Object.entries(domainResults)) {
  console.log(`  ${kw}: ${result.videos.length} videos, ${result.totalUids} comments`);
}
