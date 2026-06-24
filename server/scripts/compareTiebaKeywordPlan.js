import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseTiebaThreadComments, parseTiebaThreads, threadFromTiebaUrl, tiebaThreadsToDiscoveryComments } from '../services/tiebaScraper.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['options'];

export const DEFAULT_PAYLOAD = {
  env: {
    TIEBA_MAX_QUERIES: '9',
    TIEBA_FORUM_PAGES: '2',
    TIEBA_THREAD_LIMIT: '3',
    TIEBA_THREAD_PAGES: '4',
    TIEBA_SCRAPER_MIN_DELAY_MS: '100',
    TIEBA_SCRAPER_JITTER_MS: '50',
    TIEBA_SCRAPER_BLOCK_COOLDOWN_MS: '1000',
    TIEBA_SCRAPER_REQUEST_TIMEOUT_MS: '5000',
    TIEBA_SCRAPER_OVERALL_TIMEOUT_MS: '6000',
    TIEBA_DISCOVERY_MODE: 'mobile',
    TIEBA_INCLUDE_DISCOVERY_TITLES: '1',
    TIEBA_TRAIN_DICTIONARY: '1',
  },
  argv: [
    '--query=懂的都懂',
    '--queries=贴吧梗;抽象话',
    '--thread-url=https://tieba.baidu.com/p/123456',
    '--max-queries=2',
    '--discovery-titles-only',
    '--new-terms',
  ],
};

export const DEFAULT_SCRAPE_PAYLOAD = {
  keyword: '懂的都懂',
  discoveryHtml: '<a href="/p/1234567890" title="懂的都懂讨论">懂的都懂讨论</a>',
  threadHtmlById: {
    1234567890:
      '<div class="l_post" data-field=\'{"content":{"post_id":"1"},"author":{"user_name":"alice"}}\'><div class="d_post_content">第一条贴吧评论</div></div>'
      + '<div class="l_post" data-field=\'{"content":{"post_id":"2"},"author":{"user_name":"bob"}}\'><div class="d_post_content">第二条贴吧评论</div></div>',
  },
};

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareTiebaKeywordPlanObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('node', ['server/scripts/runTiebaKeywordScrape.js', '--plan-json', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function runPythonPlan({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.tieba_keyword_plan', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function summarizeScrape(result = {}) {
  const threads = Array.isArray(result.threads) ? result.threads : [];
  const comments = Array.isArray(result.comments) ? result.comments : [];
  return {
    ok: result.ok === true,
    keyword: result.keyword || '',
    threadIds: threads.map((thread) => thread?.id).filter(Boolean),
    commentMessages: comments.map((comment) => comment?.message).filter(Boolean),
    commentText: result.commentText || '',
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    confidenceHint: result.confidenceHint || '',
  };
}

function buildJsScrapeFixture(payload = {}) {
  const keyword = String(payload.keyword || '').trim();
  const options = payload.options && typeof payload.options === 'object' ? payload.options : {};
  const threads = [];
  for (const thread of Array.isArray(payload.threads) ? payload.threads : []) {
    if (thread && typeof thread === 'object' && thread.id) threads.push({ ...thread });
  }
  for (const thread of parseTiebaThreads(payload.discoveryHtml || payload.html || '', keyword)) {
    threads.push(thread);
  }
  for (const url of Array.isArray(payload.threadUrls) ? payload.threadUrls : []) {
    const thread = threadFromTiebaUrl(url, keyword);
    if (thread) threads.push(thread);
  }
  const seenThreadIds = new Set();
  const uniqueThreads = threads.filter((thread) => {
    if (!thread?.id || seenThreadIds.has(thread.id)) return false;
    seenThreadIds.add(thread.id);
    return true;
  });
  let comments = [];
  if (options.discoveryTitlesOnly === true) {
    comments = tiebaThreadsToDiscoveryComments(uniqueThreads, keyword);
  } else {
    const htmlById = payload.threadHtmlById && typeof payload.threadHtmlById === 'object' ? payload.threadHtmlById : {};
    const seen = new Set();
    for (const thread of uniqueThreads) {
      for (const comment of parseTiebaThreadComments(htmlById[thread.id] || '', thread)) {
        const key = `${comment.rpid || ''}\n${comment.message || ''}`;
        const textKey = comment.message || '';
        if (seen.has(key) || seen.has(textKey)) continue;
        seen.add(key);
        seen.add(textKey);
        comments.push(comment);
      }
    }
    if (comments.length === 0 && options.includeDiscoveryTitles === true && threads.length > 0) {
      comments = tiebaThreadsToDiscoveryComments(uniqueThreads, keyword);
    }
  }
  return {
    ok: uniqueThreads.length > 0 || comments.length > 0,
    keyword,
    threads: uniqueThreads,
    comments,
    commentText: comments.map((comment) => comment.message).filter(Boolean).join('\n'),
    source: 'Tieba public thread scan',
    confidenceHint: comments.length >= 80 ? 'large Tieba sample' : comments.length >= 20 ? 'medium Tieba sample' : 'small Tieba sample',
    warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
  };
}

async function runPythonScrapeFixture({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.tieba_keyword_scrape', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function compareTiebaKeywordPlan({
  payload = DEFAULT_PAYLOAD,
  scrapePayload = DEFAULT_SCRAPE_PAYLOAD,
  runJs = runJsPlan,
  runPython = runPythonPlan,
  runJsScrape = async ({ payload: input }) => buildJsScrapeFixture(input),
  runPythonScrape = runPythonScrapeFixture,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'tieba-keyword-plan-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const scrapePayloadPath = join(tempDir, 'scrape-payload.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(scrapePayloadPath, JSON.stringify(scrapePayload, null, 2), 'utf8');
    const js = await runJs({ payload, payloadPath });
    const python = await runPython({ payload, payloadPath });
    const comparison = compareTiebaKeywordPlanObjects(python, js);
    const jsScrape = await runJsScrape({ payload: scrapePayload, payloadPath: scrapePayloadPath });
    const pythonScrape = await runPythonScrape({ payload: scrapePayload, payloadPath: scrapePayloadPath });
    const scrapeJs = summarizeScrape(jsScrape);
    const scrapePython = summarizeScrape(pythonScrape);
    const scrapeMismatches = Object.keys(scrapeJs)
      .filter((key) => JSON.stringify(scrapePython[key]) !== JSON.stringify(scrapeJs[key]))
      .map((key) => ({ key, python: scrapePython[key], js: scrapeJs[key] }));
    return {
      ok: comparison.ok && scrapeMismatches.length === 0,
      fixture: { payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
      scrape: {
        ok: scrapeMismatches.length === 0,
        fixture: { payloadPath: scrapePayloadPath },
        js: scrapeJs,
        python: scrapePython,
        mismatches: scrapeMismatches,
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareTiebaKeywordPlan();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
