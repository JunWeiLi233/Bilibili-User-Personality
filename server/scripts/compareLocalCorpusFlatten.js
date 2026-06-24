import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { flattenBilibiliCommentCorpus } from '../services/localCorpusEvidence.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['count', 'comments'];

export const DEFAULT_PAYLOAD = {
  _uidComments: {
    42: [
      {
        message: '本地语料评论',
        uname: 'tester',
        bvid: 'BVflat',
      },
    ],
  },
};

const DEFAULT_COMMENTS = [
  {
    message: '本地语料评论',
    platform: 'bilibili',
    source: 'Bilibili local UID discovery corpus: https://www.bilibili.com/video/BVflat/',
    uid: 'BVflat',
    uname: 'tester',
  },
];

export const LOCAL_CORPUS_FLATTEN_FIXTURES = {
  'uid-comment-map': {
    payload: DEFAULT_PAYLOAD,
    expected: { ok: true, count: 1, comments: DEFAULT_COMMENTS },
  },
  'top-level-comments': {
    payload: {
      comments: [
        {
          message: 'direct probe comment',
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVprobe/',
          uid: '123',
          uname: 'direct-user',
        },
        { message: '', source: 'ignored' },
      ],
    },
    expected: {
      ok: true,
      count: 1,
      comments: [
        {
          message: 'direct probe comment',
          platform: 'bilibili',
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BVprobe/',
          uid: '123',
          uname: 'direct-user',
        },
      ],
    },
  },
  'tieba-run-comments': {
    payload: {
      runs: [
        {
          results: [
            {
              comments: [
                {
                  message: 'discover: HTTP 403 from https://tieba.baidu.com/f?kw=dog',
                  sourceUrl: 'https://tieba.baidu.com/f?kw=dog',
                  platform: 'tieba',
                },
                {
                  message: 'tieba useful reply',
                  sourceUrl: 'https://tieba.baidu.com/p/10792024244',
                  platform: 'tieba',
                  uname: 'tieba-user',
                },
              ],
            },
          ],
        },
      ],
    },
    expected: {
      ok: true,
      count: 1,
      comments: [
        {
          message: 'tieba useful reply',
          platform: 'tieba',
          source: 'Tieba public thread scan: https://tieba.baidu.com/p/10792024244',
          uid: '',
          uname: 'tieba-user',
        },
      ],
    },
  },
  'user-history-comments': {
    payload: {
      users: {
        860: {
          uid: '860',
          uname: 'sample-user',
          commentText: 'first comment\nsecond comment',
          bvids: ['BVone', 'BVtwo'],
        },
        123: {
          name: 'aicu-user',
          comments: [{ message: 'aicu comment', oid: '9988' }],
          danmaku: [{ content: 'aicu danmaku', oid: '7766' }],
        },
      },
    },
    expected: {
      ok: true,
      count: 4,
      comments: [
        {
          message: 'first comment',
          platform: 'bilibili',
          source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVone/',
          uid: '860',
          uname: 'sample-user',
        },
        {
          message: 'second comment',
          platform: 'bilibili',
          source: 'Bilibili local scraped user corpus: https://www.bilibili.com/video/BVtwo/',
          uid: '860',
          uname: 'sample-user',
        },
        {
          message: 'aicu comment',
          platform: 'bilibili',
          source: 'Bilibili local AICU corpus: https://www.bilibili.com/video/av9988/',
          uid: '123',
          uname: 'aicu-user',
        },
        {
          message: 'aicu danmaku',
          platform: 'bilibili',
          source: 'Bilibili local AICU danmaku corpus: https://www.bilibili.com/video/av7766/',
          uid: '123',
          uname: 'aicu-user',
        },
      ],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(LOCAL_CORPUS_FLATTEN_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareLocalCorpusFlattenObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

async function readPayload(payloadPath) {
  try {
    return JSON.parse(await readFile(payloadPath, 'utf8'));
  } catch {
    return {};
  }
}

async function runJsLocalCorpusFlatten({ payloadPath }) {
  const payload = await readPayload(payloadPath);
  const comments = flattenBilibiliCommentCorpus(payload);
  return { ok: true, count: comments.length, comments };
}

async function runPythonLocalCorpusFlatten({ payloadPath }) {
  const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.local_corpus_flatten', '--payload', payloadPath], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function writeFixture(payloadPath, payload) {
  await writeFile(payloadPath, JSON.stringify(payload || {}, null, 2), 'utf8');
}

export async function compareLocalCorpusFlatten({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsLocalCorpusFlatten,
  runPython = runPythonLocalCorpusFlatten,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareLocalCorpusFlatten({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? LOCAL_CORPUS_FLATTEN_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedPayload = payload || resolvedFixture?.payload || DEFAULT_PAYLOAD;
  const tempDir = await mkdtemp(join(tmpdir(), 'local-flatten-compare-'));
  try {
    const payloadPath = resolvedPayload.payloadPath || join(tempDir, 'local-flatten.json');
    if (!resolvedPayload.payloadPath) await writeFixture(payloadPath, resolvedPayload);
    const context = {
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareLocalCorpusFlattenObjects(python, js);
    return {
      ok: comparison.ok,
      fixture: { name: resolvedName, payloadPath },
      js,
      python,
      mismatches: comparison.mismatches,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareLocalCorpusFlatten({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
