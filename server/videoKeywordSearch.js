import { fetchRepliesForVideo } from './bilibiliCrawler.js';
import { trainKeywordDictionary as defaultTrainKeywordDictionary } from './deepseekKeywordTrainer.js';

export const DEFAULT_VIDEO_LINK =
  process.env.BILIBILI_DEFAULT_VIDEO_LINK ||
  'https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=d3f6474bdf9e6de8d027785f1120afd4';

export async function searchVideoKeywords(payload = {}, deps = {}) {
  const videoLink = String(payload.videoLink || payload.url || payload.bvid || deps.defaultVideoLink || DEFAULT_VIDEO_LINK).trim();
  const scan = await fetchRepliesForVideo(videoLink, { pages: payload.pages }, deps);

  if (!scan.ok) {
    return scan;
  }

  if (!scan.commentText.trim()) {
    return {
      ...scan,
      entries: [],
      keywordTraining: null,
      dictionary: null,
    };
  }

  const trainKeywordDictionary = deps.trainKeywordDictionary || defaultTrainKeywordDictionary;
  const keywordTraining = await trainKeywordDictionary({
    uid: scan.video.bvid,
    text: scan.commentText,
    source: `${scan.source}: ${scan.video.sourceUrl}`,
  });

  return {
    ...scan,
    entries: keywordTraining.entries || [],
    keywordTraining,
    dictionary: keywordTraining.dictionary || null,
  };
}
