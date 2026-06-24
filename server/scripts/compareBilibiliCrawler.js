import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  collectReplyForUid,
  dedupePublicObjects,
  extractBvid,
  extractDynamicRecords,
  isBilibiliBlockResponse,
  normalizeBilibiliCookie,
  parseBvidPool,
  parseDanmakuXml,
} from '../services/bilibiliCrawler.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = [
  'bvids',
  'bvid',
  'blocked',
  'cookie',
  'objects',
  'targetReplies',
  'danmaku',
  'dynamicRecords',
];

export const BILIBILI_CRAWLER_FIXTURES = {
  'identity-block-cookie': {
    payload: {
      text: 'https://www.bilibili.com/video/BV19yGa61Ee6/ BV1xx411c7mD',
      payload: { code: -412 },
      cookie: ' SESSDATA=abc ; invalid ; DedeUserID=42 ',
    },
  },
  'objects-and-reply': {
    payload: {
      text: 'BV19yGa61Ee6',
      payload: { code: 0 },
      objects: [
        { kind: 'video', bvid: 'BV19yGa61Ee6', oid: '1', replyType: '1' },
        { kind: 'video', bvid: 'BV19yGa61Ee6', oid: '1', replyType: 1 },
        { kind: 'dynamic', oid: 'dyn-1', replyType: 17 },
      ],
      reply: {
        rpid: 100,
        mid: 42,
        member: { mid: 42, uname: 'tester' },
        content: { message: 'hello [doge]' },
        ctime: 1710000000,
        like: 7,
        replies: [
          {
            rpid: 101,
            mid: 43,
            member: { mid: 43, uname: 'other' },
            content: { message: 'ignored' },
          },
        ],
      },
      targetUid: 42,
      object: {
        kind: 'video',
        bvid: 'BV19yGa61Ee6',
        oid: '1',
        replyType: 1,
        title: 'fixture video',
        sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      },
    },
  },
  'danmaku-and-dynamics': {
    payload: {
      danmakuXml: '<i><d p="1,1,25,16777215,1710000000,0,12345,0">emoji [doge] &amp; satire</d></i>',
      video: {
        bvid: 'BV19yGa61Ee6',
        oid: '1',
        replyType: 1,
        title: 'fixture video',
        sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
        cid: '456',
      },
      uid: '42',
      dynamicItems: [
        {
          id_str: 'dyn100',
          basic: { comment_type: 17, comment_id_str: '900' },
          modules: {
            module_author: { pub_ts: 1710000001, name: 'tester' },
            module_dynamic: { desc: { text: 'dynamic satire [doge]' } },
            module_stat: { comment: { count: 3 } },
          },
        },
      ],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(BILIBILI_CRAWLER_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareBilibiliCrawlerObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS
    .filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key]))
    .map((key) => ({ key, python: python[key], js: js[key] }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function runJsBilibiliCrawler({ payload }) {
  const text = payload?.text || payload?.input || '';
  const blockPayload = payload?.payload && typeof payload.payload === 'object' ? payload.payload : {};
  const result = {
    ok: true,
    bvids: parseBvidPool(text),
    bvid: extractBvid(text),
    blocked: isBilibiliBlockResponse(blockPayload),
  };

  if ('cookie' in (payload || {})) {
    result.cookie = normalizeBilibiliCookie(payload.cookie);
  }
  if (Array.isArray(payload?.objects)) {
    result.objects = dedupePublicObjects(payload.objects);
  }
  if (payload?.reply && typeof payload.reply === 'object') {
    const bucket = [];
    collectReplyForUid(payload.reply, payload.targetUid, payload.object && typeof payload.object === 'object' ? payload.object : {}, bucket);
    result.targetReplies = bucket;
  }
  if ('danmakuXml' in (payload || {})) {
    result.danmaku = parseDanmakuXml(payload.danmakuXml, payload.video && typeof payload.video === 'object' ? payload.video : {});
  }
  if (Array.isArray(payload?.dynamicItems)) {
    result.dynamicRecords = extractDynamicRecords(payload.dynamicItems, payload.uid);
  }

  return result;
}

async function runPythonBilibiliCrawler({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.bilibili_crawler', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function resolvePayload({ payload, fixture } = {}) {
  if (payload) return { name: fixture?.name || 'custom', payload, expected: fixture?.expected };
  const name = typeof fixture === 'string' ? fixture : fixture?.name || DEFAULT_FIXTURE_NAMES[0];
  const resolved = BILIBILI_CRAWLER_FIXTURES[name] || BILIBILI_CRAWLER_FIXTURES[DEFAULT_FIXTURE_NAMES[0]];
  return { name, payload: resolved.payload, expected: resolved.expected };
}

async function compareBilibiliCrawlerSingle({ payload, fixture, runJs = runJsBilibiliCrawler, runPython = runPythonBilibiliCrawler } = {}) {
  const resolved = resolvePayload({ payload, fixture });
  const tempDir = await mkdtemp(join(tmpdir(), 'bilibili-crawler-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolved.payload || {}, null, 2), 'utf8');
    const context = {
      payload: resolved.payload,
      payloadPath,
      fixture: { name: resolved.name, expected: resolved.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareBilibiliCrawlerObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolved.name, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function compareBilibiliCrawler({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsBilibiliCrawler,
  runPython = runPythonBilibiliCrawler,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareBilibiliCrawlerSingle({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }
  return compareBilibiliCrawlerSingle({ payload, fixture, runJs, runPython });
}

async function main() {
  const result = await compareBilibiliCrawler({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
