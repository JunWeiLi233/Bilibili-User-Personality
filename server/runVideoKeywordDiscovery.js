import { searchVideoKeywords } from './videoKeywordSearch.js';

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function printKeyword(entry) {
  const family = entry.family || 'unknown';
  const term = entry.term || '';
  const meaning = entry.meaning ? ` - ${entry.meaning}` : '';
  console.log(`- [${family}] ${term}${meaning}`);
}

const searchQueries = parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY);
const discoveryLimit = Number(process.env.BILIBILI_VIDEO_DISCOVERY_LIMIT || 6);
const pages = Number(process.env.BILIBILI_VIDEO_COMMENT_PAGES || 2);

const result = await searchVideoKeywords({
  searchQueries,
  discoveryLimit,
  pages,
});

if (!result.ok) {
  console.error(`Bilibili video keyword discovery failed: ${result.error}`);
  for (const warning of result.warnings || []) console.error(`warning: ${warning}`);
  process.exitCode = 1;
} else {
  console.log(`Search queries: ${(result.searchQueries || searchQueries).join(', ')}`);
  console.log(`Videos scanned: ${result.videos.length}`);
  for (const video of result.videos) {
    console.log(`- ${video.bvid}: ${video.title || video.sourceUrl}`);
  }
  console.log(`Comments collected: ${result.comments.length}`);
  console.log(`Dictionary entries returned: ${result.entries.length}`);
  if (result.keywordTraining) {
    console.log(`Model: ${result.keywordTraining.model || 'fallback'} (${result.keywordTraining.reasoningEffort || 'medium'})`);
    console.log(`Fallback: ${Boolean(result.keywordTraining.usedFallback)}`);
  }
  if (result.warnings?.length) {
    console.log('Warnings:');
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
  if (result.entries.length) {
    console.log('Keywords:');
    for (const entry of result.entries.slice(0, 30)) printKeyword(entry);
  }
}
