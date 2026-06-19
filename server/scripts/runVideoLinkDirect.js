// Direct video / favorite / UID-space keyword harvesting. Called from run-bilibili-video.ps1.
// No server needed.

import { analyzeUid } from '../services/bilibiliCrawler.js';
import { searchVideoKeywords } from '../services/videoKeywordSearch.js';
import { trainKeywordDictionary } from '../services/deepseekKeywordTrainer.js';

const args = process.argv.slice(2);
const params = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--video-link' || args[i] === '-v') params.videoLink = args[++i];
  else if (args[i] === '--favorite-link' || args[i] === '-f') params.favoriteLink = args[++i];
  else if (args[i] === '--uid' || args[i] === '-u') params.uid = args[++i];
  else if (args[i] === '--cookie' || args[i] === '-c') params.bilibiliCookie = args[++i];
  else if (args[i] === '--pages' || args[i] === '-p') params.pages = Number(args[++i]) || 2;
}

if (!params.videoLink && !params.favoriteLink && !params.uid) {
  console.error('Usage: node server/runVideoLinkDirect.js (--video-link <url> | --favorite-link <url> | --uid <uid>) [--cookie <str>] [--pages <n>]');
  process.exit(1);
}

const start = Date.now();
const cookie = params.bilibiliCookie;

if (params.uid) {
  // ── UID / space scraping ──
  console.log(`Processing UID: ${params.uid}`);
  const result = await analyzeUid({
    uid: params.uid,
    pagesPerObject: params.pages || 2,
    ...(cookie ? { bilibiliCookie: cookie } : {}),
  });

  console.log(`Objects found: ${result.objects?.length || 0}`);
  console.log(`Comments collected: ${result.comments?.length || 0}`);
  console.log(`Statements: ${result.statements?.length || 0}`);
  const text = result.commentText || '';
  console.log(`Comment text length: ${text.length} chars`);

  if (text) {
    const trainResult = await trainKeywordDictionary({
      source: `Bilibili UID ${params.uid}`,
      uid: params.uid,
      text,
      fullText: text,
      existingTermsOnly: true,
      multiagent: true,
    });
    if (trainResult.ok) {
      console.log(`Dictionary trained: ${trainResult.entries?.length || 0} keywords`);
    }
  }
} else {
  // ── Video / favorite link scraping ──
  console.log(params.videoLink
    ? `Processing video: ${params.videoLink}`
    : `Processing favorite: ${params.favoriteLink}`);

  const result = await searchVideoKeywords({
    ...(params.videoLink ? { videoLink: params.videoLink } : {}),
    ...(params.favoriteLink ? { favoriteLink: params.favoriteLink } : {}),
    ...(cookie ? { bilibiliCookie: cookie } : {}),
    pages: params.pages,
  });

  console.log(`Videos scanned: ${result.videos?.length || 0}`);
  console.log(`Comments collected: ${result.comments?.length || 0}`);
  console.log(`Comment text length: ${(result.commentText || '').length} chars`);

  if (result.commentText) {
    const trainResult = await trainKeywordDictionary({
      source: params.videoLink || params.favoriteLink || 'Bilibili direct link',
      uid: '',
      text: result.commentText,
      fullText: result.commentText,
      existingTermsOnly: true,
      multiagent: true,
    });
    if (trainResult.ok) {
      console.log(`Dictionary trained: ${trainResult.entries?.length || 0} keywords`);
    }
  }
}

console.log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
