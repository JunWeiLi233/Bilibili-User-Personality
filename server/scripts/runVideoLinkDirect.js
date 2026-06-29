// Direct video / favorite / UID-space keyword harvesting. Called from run-bilibili-video.ps1.
// No server needed.

import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { analyzeUid } from '../services/bilibiliCrawler.js';
import { trainKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { isProcessed, markProcessed } from '../services/scraperMemory.js';
import { searchVideoKeywords } from '../services/videoKeywordSearch.js';

const execFileAsync = promisify(execFile);

const USAGE = 'Usage: node server/runVideoLinkDirect.js (--video-link <url> | --favorite-link <url> | --uid <uid>) [--cookie <str>] [--pages <n>]';

function jsNumberOrDefault(value, fallback) {
  const number = Number(value);
  return number || fallback;
}

export function parseVideoLinkDirectArgs(argv = process.argv.slice(2)) {
  const params = { pages: 2 };
  const control = { dryRunPlanJson: false, jsPlan: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--video-link' || arg === '-v') params.videoLink = argv[++i];
    else if (arg === '--favorite-link' || arg === '-f') params.favoriteLink = argv[++i];
    else if (arg === '--uid' || arg === '-u') params.uid = argv[++i];
    else if (arg === '--cookie' || arg === '-c') params.bilibiliCookie = argv[++i];
    else if (arg === '--pages' || arg === '-p') params.pages = jsNumberOrDefault(argv[++i], 2);
    else if (arg === '--dry-run-plan-json' || arg === '--plan-json') control.dryRunPlanJson = true;
    else if (arg === '--js-plan') control.jsPlan = true;
    else if (arg === '--skip-memory') params.skipMemory = true;
  }
  return { params, control };
}

function planMode(params = {}) {
  if (params.uid) return 'uid';
  if (params.videoLink) return 'video';
  if (params.favoriteLink) return 'favorite';
  return '';
}

export function buildVideoLinkDirectPlan(payload = {}) {
  const { params } = parseVideoLinkDirectArgs(Array.isArray(payload.argv) ? payload.argv : []);
  const mode = planMode(params);
  if (!mode) {
    return {
      ok: false,
      error: 'missing-target',
      usage: 'runVideoLinkDirect requires --video-link, --favorite-link, or --uid.',
    };
  }
  return {
    ok: true,
    mode,
    input: {
      uid: params.uid || '',
      videoLink: params.videoLink || '',
      favoriteLink: params.favoriteLink || '',
      pages: params.pages,
      hasCookie: Boolean(params.bilibiliCookie),
    },
    collect: mode === 'uid'
      ? {
        function: 'analyzeUid',
        pagesPerObject: params.pages,
        forwardsCookie: Boolean(params.bilibiliCookie),
      }
      : {
        function: 'searchVideoKeywords',
        pages: params.pages,
        forwardsCookie: Boolean(params.bilibiliCookie),
      },
    training: mode === 'uid'
      ? {
        existingTermsOnly: true,
        multiagent: true,
        source: `Bilibili UID ${params.uid || ''}`,
        uid: params.uid || '',
      }
      : {
        existingTermsOnly: true,
        multiagent: true,
        source: params.videoLink || params.favoriteLink || 'Bilibili direct link',
        uid: '',
      },
  };
}

function stripControlArgs(argv = []) {
  return argv.filter((arg) => arg !== '--dry-run-plan-json' && arg !== '--plan-json' && arg !== '--js-plan');
}

async function runPythonVideoLinkDirectPlan({ argv }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'video-link-direct-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify({ argv }, null, 2), 'utf8');
    const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.video_link_direct_plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runCollection({
  params,
  analyzeUidRunner,
  searchVideoKeywordsRunner,
  trainKeywordDictionaryRunner,
  log,
}) {
  const start = Date.now();
  const cookie = params.bilibiliCookie;

  if (params.uid) {
    const uidStr = String(params.uid);
    if (!params.skipMemory && isProcessed('uid', uidStr)) {
      log(`UID ${uidStr} already processed (scraper memory) — skipping`);
      return { exitCode: 0, skipped: true, collected: false };
    }
    log(`Processing UID: ${uidStr}`);
    const result = await analyzeUidRunner({
      uid: params.uid,
      pagesPerObject: params.pages || 2,
      ...(cookie ? { bilibiliCookie: cookie } : {}),
    });

    const collected = result.ok === true;
    log(`Objects found: ${result.objects?.length || 0}`);
    log(`Comments collected: ${result.comments?.length || 0}`);
    log(`Statements: ${result.statements?.length || 0}`);
    const text = result.commentText || '';
    log(`Comment text length: ${text.length} chars`);

    if (text) {
      const trainResult = await trainKeywordDictionaryRunner({
        source: `Bilibili UID ${params.uid}`,
        uid: params.uid,
        text,
        fullText: text,
        existingTermsOnly: true,
        multiagent: true,
      });
      if (trainResult.ok) {
        log(`Dictionary trained: ${trainResult.entries?.length || 0} keywords`);
      }
    }
    log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    return { exitCode: 0, collected };
  } else if (params.videoLink) {
    const bvidMatch = params.videoLink.match(/BV[a-zA-Z0-9]{10}/);
    const videoId = bvidMatch ? bvidMatch[0] : params.videoLink;
    if (!params.skipMemory && isProcessed('video', videoId)) {
      log(`Video ${videoId} already processed (scraper memory) — skipping`);
      return { exitCode: 0, skipped: true, collected: false };
    }
    log(`Processing video: ${params.videoLink}`);

    const result = await searchVideoKeywordsRunner({
      videoLink: params.videoLink,
      ...(cookie ? { bilibiliCookie: cookie } : {}),
      pages: params.pages,
    });

    const collected = (result.videos?.length || 0) > 0 || (result.comments?.length || 0) > 0;
    log(`Videos scanned: ${result.videos?.length || 0}`);
    log(`Comments collected: ${result.comments?.length || 0}`);
    log(`Comment text length: ${(result.commentText || '').length} chars`);

    if (result.commentText) {
      const trainResult = await trainKeywordDictionaryRunner({
        source: params.videoLink || 'Bilibili direct link',
        uid: '',
        text: result.commentText,
        fullText: result.commentText,
        existingTermsOnly: true,
        multiagent: true,
      });
      if (trainResult.ok) {
        log(`Dictionary trained: ${trainResult.entries?.length || 0} keywords`);
      }
    }
    log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    return { exitCode: 0, collected };
  } else if (params.favoriteLink) {
    const favMatch = params.favoriteLink.match(/[?&]id=(\d+)/) || params.favoriteLink.match(/favlist.*?(\d+)/);
    const favId = favMatch ? favMatch[1] : params.favoriteLink;
    if (!params.skipMemory && isProcessed('favorite', favId)) {
      log(`Favorite list ${favId} already processed (scraper memory) — skipping`);
      return { exitCode: 0, skipped: true, collected: false };
    }
    log(`Processing favorite: ${params.favoriteLink}`);

    const result = await searchVideoKeywordsRunner({
      favoriteLink: params.favoriteLink,
      ...(cookie ? { bilibiliCookie: cookie } : {}),
      pages: params.pages,
    });

    const collected = (result.videos?.length || 0) > 0 || (result.comments?.length || 0) > 0;
    log(`Videos scanned: ${result.videos?.length || 0}`);
    log(`Comments collected: ${result.comments?.length || 0}`);
    log(`Comment text length: ${(result.commentText || '').length} chars`);

    if (result.commentText) {
      const trainResult = await trainKeywordDictionaryRunner({
        source: params.favoriteLink || 'Bilibili direct link',
        uid: '',
        text: result.commentText,
        fullText: result.commentText,
        existingTermsOnly: true,
        multiagent: true,
      });
      if (trainResult.ok) {
        log(`Dictionary trained: ${trainResult.entries?.length || 0} keywords`);
      }
    }
    log(`Done in ${((Date.now() - start) / 1000).toFixed(1)}s`);
    return { exitCode: 0, collected };
  } else {
    log('No link type detected — nothing to process');
    return { exitCode: 0, skipped: true, collected: false };
  }
}

export async function runVideoLinkDirectCommand({
  argv = process.argv.slice(2),
  runPythonPlan = runPythonVideoLinkDirectPlan,
  analyzeUidRunner = analyzeUid,
  searchVideoKeywordsRunner = searchVideoKeywords,
  trainKeywordDictionaryRunner = trainKeywordDictionary,
  log = console.log,
  error = console.error,
} = {}) {
  const { params, control } = parseVideoLinkDirectArgs(argv);
  const commandArgv = stripControlArgs(argv);

  if (control.dryRunPlanJson) {
    const plan = control.jsPlan
      ? buildVideoLinkDirectPlan({ argv: commandArgv })
      : await runPythonPlan({ argv: commandArgv });
    log(JSON.stringify(plan, null, 2));
    return { exitCode: plan.ok ? 0 : 1, plan };
  }

  if (!params.videoLink && !params.favoriteLink && !params.uid) {
    error(USAGE);
    return { exitCode: 1 };
  }

  const result = await runCollection({
    params,
    analyzeUidRunner,
    searchVideoKeywordsRunner,
    trainKeywordDictionaryRunner,
    log,
  });

  // Record successfully-processed link only when data was actually collected.
  // exitCode 0 alone is not enough — session-invalid runs also exit 0 but harvest nothing.
  if (!params.skipMemory && result.collected) {
    try {
      if (params.uid) {
        markProcessed('uid', params.uid, { source: 'runVideoLinkDirect' });
      } else if (params.videoLink) {
        const bvidMatch = params.videoLink.match(/BV[a-zA-Z0-9]{10}/);
        const identifier = bvidMatch ? bvidMatch[0] : params.videoLink;
        markProcessed('video', identifier, { source: 'runVideoLinkDirect' });
      } else if (params.favoriteLink) {
        const favMatch = params.favoriteLink.match(/[?&]id=(\d+)/) || params.favoriteLink.match(/favlist.*?(\d+)/);
        const identifier = favMatch ? favMatch[1] : params.favoriteLink;
        markProcessed('favorite', identifier, { source: 'runVideoLinkDirect' });
      }
    } catch {
      // Memory recording is non-fatal — don't fail the run if it errors.
    }
  }

  return result;
}

async function main() {
  const result = await runVideoLinkDirectCommand();
  return result.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
