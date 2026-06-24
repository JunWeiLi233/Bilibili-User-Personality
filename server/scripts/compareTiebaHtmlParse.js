import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { parseTiebaThreadComments, parseTiebaThreads, tiebaThreadsToDiscoveryComments } from '../services/tiebaScraper.js';

const execFileAsync = promisify(execFile);

const RESULT_KEYS = ['mode', 'threads', 'comments', 'blocked', 'warnings'];

export const DEFAULT_PAYLOAD = {
  mode: 'threads',
  keyword: 'sample',
  html: '<a href="/p/1234567890" title="sample thread">sample thread</a>',
};

const DEFAULT_THREADS = [
  {
    id: '1234567890',
    kind: 'tieba-thread',
    title: 'sample thread',
    keyword: 'sample',
    sourceUrl: 'https://tieba.baidu.com/p/1234567890',
  },
];

export const TIEBA_HTML_PARSE_FIXTURES = {
  'threads-title-dedupe': {
    payload: {
      ...DEFAULT_PAYLOAD,
      html: [
        '<a href="/p/1234567890" title="sample thread">duplicate body</a>',
        '<a href="/p/1234567890" title="duplicate">duplicate</a>',
        '<a href="https://tieba.baidu.com/p/9876543210">second thread</a>',
      ].join('\n'),
    },
    expected: {
      ok: true,
      mode: 'threads',
      threads: [
        ...DEFAULT_THREADS,
        {
          id: '9876543210',
          kind: 'tieba-thread',
          title: 'second thread',
          keyword: 'sample',
          sourceUrl: 'https://tieba.baidu.com/p/9876543210',
        },
      ],
    },
  },
  'thread-comments-data-field': {
    payload: {
      mode: 'comments',
      thread: { id: '1234567890', title: 'sample thread', sourceUrl: 'https://tieba.baidu.com/p/1234567890' },
      html: [
        '<div class="l_post" data-field=\'{"author":{"user_name":"alice"},"content":{"post_id":11}}\'>',
        '  <div class="d_post_content j_d_post_content">first reply</div>',
        '</div>',
        '<div class="l_post" data-field=\'{"author":{"user_name":"bob"},"content":{"post_id":12}}\'>',
        '  <cc><div>second reply</div></cc>',
        '</div>',
      ].join('\n'),
    },
    expected: {
      ok: true,
      mode: 'comments',
      comments: [
        {
          sourceKind: 'tieba-thread',
          sourceTitle: 'sample thread',
          sourceUrl: 'https://tieba.baidu.com/p/1234567890',
          rpid: 'tieba-1234567890-11',
          like: 0,
          ctime: 0,
          uname: 'alice',
          mid: '',
          message: 'first reply',
          platform: 'tieba',
        },
        {
          sourceKind: 'tieba-thread',
          sourceTitle: 'sample thread',
          sourceUrl: 'https://tieba.baidu.com/p/1234567890',
          rpid: 'tieba-1234567890-12',
          like: 0,
          ctime: 0,
          uname: 'bob',
          mid: '',
          message: 'second reply',
          platform: 'tieba',
        },
      ],
    },
  },
  'discovery-comments-from-threads': {
    payload: {
      mode: 'discovery-comments',
      keyword: 'sample',
      threads: [
        { id: '1234567890', title: 'sample thread', keyword: 'sample', sourceUrl: 'https://tieba.baidu.com/p/1234567890' },
        { id: '2222222222', title: 'Tieba thread 2222222222', keyword: 'sample', sourceUrl: 'https://tieba.baidu.com/p/2222222222' },
        { id: '9876543210', title: 'second thread', keyword: 'other', sourceUrl: 'https://tieba.baidu.com/p/9876543210' },
      ],
    },
    expected: {
      ok: true,
      mode: 'discovery-comments',
      threads: [
        { id: '1234567890', title: 'sample thread', keyword: 'sample', sourceUrl: 'https://tieba.baidu.com/p/1234567890' },
        { id: '2222222222', title: 'Tieba thread 2222222222', keyword: 'sample', sourceUrl: 'https://tieba.baidu.com/p/2222222222' },
        { id: '9876543210', title: 'second thread', keyword: 'other', sourceUrl: 'https://tieba.baidu.com/p/9876543210' },
      ],
      comments: [
        {
          sourceKind: 'tieba-discovery',
          sourceTitle: 'sample thread',
          sourceUrl: 'https://tieba.baidu.com/p/1234567890',
          rpid: 'tieba-discovery-1234567890',
          like: 0,
          ctime: 0,
          uname: '',
          mid: '',
          message: 'sample thread',
          platform: 'tieba',
          keyword: 'sample',
        },
        {
          sourceKind: 'tieba-discovery',
          sourceTitle: 'second thread',
          sourceUrl: 'https://tieba.baidu.com/p/9876543210',
          rpid: 'tieba-discovery-9876543210',
          like: 0,
          ctime: 0,
          uname: '',
          mid: '',
          message: 'second thread',
          platform: 'tieba',
          keyword: 'sample',
        },
      ],
    },
  },
  'safety-verification-page': {
    payload: {
      mode: 'threads',
      keyword: 'sample',
      html: '<html><title>百度安全验证</title><script>var BIOC_OPTIONS = {};</script></html>',
    },
    expected: {
      ok: false,
      mode: 'threads',
      threads: [],
      comments: [],
      blocked: true,
      warnings: ['Tieba safety verification page returned'],
    },
  },
};

const DEFAULT_FIXTURE_NAMES = Object.keys(TIEBA_HTML_PARSE_FIXTURES);

function summarize(result = {}) {
  return Object.fromEntries(RESULT_KEYS.filter((key) => key in result).map((key) => [key, result[key]]));
}

export function compareTiebaHtmlParseObjects(pythonResult = {}, jsResult = {}) {
  const python = summarize(pythonResult);
  const js = summarize(jsResult);
  const mismatches = RESULT_KEYS.filter((key) => key in js && JSON.stringify(python[key]) !== JSON.stringify(js[key])).map((key) => ({
    key,
    python: python[key],
    js: js[key],
  }));
  return { ok: mismatches.length === 0, mismatches, python, js };
}

function parseJsPayload(payload = {}) {
  const mode = String(payload.mode || 'threads').trim().toLowerCase();
  const html = payload.html || '';
  const keyword = String(payload.keyword || '');
  if (/百度安全验证|BIOC_OPTIONS|seccaptcha|tb_pc_frs_bfe/i.test(String(html || ''))) {
    return {
      ok: false,
      mode,
      threads: [],
      comments: [],
      blocked: true,
      warnings: ['Tieba safety verification page returned'],
    };
  }
  if (mode === 'comments') {
    return {
      ok: true,
      mode: 'comments',
      comments: parseTiebaThreadComments(html, payload.thread && typeof payload.thread === 'object' ? payload.thread : {}),
    };
  }
  if (mode === 'discovery-comments') {
    const threads = Array.isArray(payload.threads) ? payload.threads : parseTiebaThreads(html, keyword);
    return {
      ok: true,
      mode: 'discovery-comments',
      threads,
      comments: tiebaThreadsToDiscoveryComments(threads, keyword),
    };
  }
  return {
    ok: true,
    mode: 'threads',
    threads: parseTiebaThreads(html, keyword),
  };
}

async function runJsParser({ payload }) {
  return parseJsPayload(payload);
}

async function runPythonParser({ payloadPath }) {
  let stdout = '';
  try {
    ({ stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.tieba_html_parse', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    stdout = error?.stdout || '';
    if (!stdout) throw error;
  }
  return JSON.parse(stdout);
}

export async function compareTiebaHtmlParse({
  payload,
  fixture,
  fixtureNames,
  runJs = runJsParser,
  runPython = runPythonParser,
} = {}) {
  if (fixtureNames) {
    const results = [];
    for (const name of fixtureNames.length ? fixtureNames : DEFAULT_FIXTURE_NAMES) {
      results.push(await compareTiebaHtmlParse({ fixture: name, runJs, runPython }));
    }
    const mismatches = results.flatMap((result) => result.mismatches.map((mismatch) => ({ ...mismatch, fixture: result.fixture.name })));
    return { ok: mismatches.length === 0, fixtures: results.map((result) => result.fixture), results, mismatches };
  }

  const resolvedFixture = typeof fixture === 'string' ? TIEBA_HTML_PARSE_FIXTURES[fixture] : fixture;
  const resolvedName = typeof fixture === 'string' ? fixture : fixture?.name || 'custom';
  const resolvedPayload = payload || resolvedFixture?.payload || DEFAULT_PAYLOAD;
  const tempDir = await mkdtemp(join(tmpdir(), 'tieba-html-parse-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify(resolvedPayload, null, 2), 'utf8');
    const context = {
      payload: resolvedPayload,
      payloadPath,
      fixture: { name: resolvedName, expected: resolvedFixture?.expected },
    };
    const js = await runJs(context);
    const python = await runPython(context);
    const comparison = compareTiebaHtmlParseObjects(python, js);
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
  const result = await compareTiebaHtmlParse({ fixtureNames: DEFAULT_FIXTURE_NAMES });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
