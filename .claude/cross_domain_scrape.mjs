/**
 * Cross-domain seed video scraper: gaming + tech domains.
 * Discovers top videos for gaming/tech keywords, scrapes comments,
 * extracts unique UIDs, and saves for downstream 100-user analysis.
 * Fixed: uses createRequire for proper cookie propagation.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const BILIBILI_COOKIE = process.env.BILIBILI_COOKIE || "";
const crawler = require_("../server/services/bilibiliCrawler.js");
const cookieDeps = crawler.depsWithBilibiliCookie({}, BILIBILI_COOKIE);

const SEED_KEYWORDS = ["游戏", "电竞", "LOL", "原神", "王者荣耀", "科技", "数码", "评测", "编程", "AI"];
const MAX_VIDEOS_PER_SEED = 5;

const allUids = new Set();
const domainResults = {};

for (const keyword of SEED_KEYWORDS) {
  console.log(`\nSearching: ${keyword}`);
  try {
    const videos = await crawler.discoverVideosByKeyword(keyword, 5, cookieDeps);
    const topVideos = (videos || []).slice(0, MAX_VIDEOS_PER_SEED);
    console.log(`  Found ${topVideos.length} videos`);

    const keywordResults = { keyword, videos: [], totalUids: 0 };

    for (const video of topVideos) {
      const bvid = video.bvid || (video.sourceUrl || "").match(/BV[\w]+/)?.[0];
      if (!bvid) continue;

      console.log(`  Scraping: ${bvid} (${(video.title || "no title").substring(0, 40)})`);
      try {
        const result = await crawler.fetchRepliesForVideo(bvid, { pages: 2, includeDanmaku: false }, cookieDeps);

        if (result.ok && result.comments) {
          const uids = result.comments
            .filter((c) => c.mid || c.uid)
            .map((c) => String(c.mid || c.uid));
          uids.forEach((uid) => allUids.add(uid));

          keywordResults.videos.push({
            bvid,
            title: video.title || result.video?.title,
            comments: result.comments.length,
            uniqueUids: new Set(uids).size,
          });
          keywordResults.totalUids += uids.length;
          console.log(`    ${result.comments.length} comments, ${new Set(uids).size} unique UIDs`);
        } else {
          console.log(`    Skipped (${result.error || "no comments"})`);
        }
      } catch (e) {
        console.log(`    Error scraping: ${e.message}`);
      }
    }

    domainResults[keyword] = keywordResults;
    console.log(`  ${keyword}: ${keywordResults.videos.length} videos, ${keywordResults.totalUids} UIDs`);
  } catch (e) {
    console.log(`  Error searching: ${e.message}`);
    domainResults[keyword] = { keyword, videos: [], totalUids: 0, error: e.message };
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  totalUniqueUids: allUids.size,
  uniqueUids: [...allUids],
  domains: Object.keys(domainResults).length,
  domainResults,
};

const outputPath = join(__dirname, "cross_domain_uids_gaming_tech.json");
writeFileSync(outputPath, JSON.stringify(output, null, 2));

console.log(`\n=== Cross-Domain Scrape Complete ===`);
console.log(`Total unique UIDs: ${allUids.size}`);
console.log(`Domains: ${Object.keys(domainResults).length}`);
console.log(`Output: ${outputPath}`);
for (const [k, v] of Object.entries(domainResults)) {
  console.log(`  ${k}: ${v.videos.length} videos, ${v.totalUids} comments`);
}
