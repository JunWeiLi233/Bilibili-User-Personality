import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('probeBilibiliCommentEvidence exports an injectable no-write command runner without import side effects', async () => {
  const script = String.raw`
    const { runDirectProbeCommand } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const logs = [];
    const writes = [];
    const merges = [];
    const result = await runDirectProbeCommand({
      argv: ['--query=查查资料 B站评论', '--term=查查资料', '--aid=123', '--reply-pages=1', '--delay-ms=1000', '--jitter-ms=0'],
      env: {},
      readJson: async () => ({ nextActions: [] }),
      readJsonCorpus: async () => ({ version: 1, comments: [], runs: [] }),
      readKeywordDictionary: async () => ({
        entries: [{
          term: '查查资料',
          family: 'evidence',
          meaning: '要求来源',
          evidenceCount: 0,
          evidenceSamples: [],
          evidenceSources: [],
        }],
      }),
      fetchVideoComments: async (video) => [{
        message: ` + '`查查资料 fixture ${video.aid}`' + `,
        source: ` + '`Bilibili public direct comment probe: https://www.bilibili.com/video/av${video.aid}/`' + `,
        uid: '42',
      }],
      fetchVideoDanmaku: async () => {
        throw new Error('danmaku should not run without include-danmaku');
      },
      discoverVideos: async () => {
        throw new Error('explicit aid should avoid search discovery');
      },
      writeJsonCorpus: async (...args) => writes.push(args),
      mergeEntriesIntoDictionary: async (...args) => merges.push(args),
      log: (line) => logs.push(line),
      now: () => '2026-06-23T00:00:00.000Z',
    });
    console.log(JSON.stringify({
      type: typeof runDirectProbeCommand,
      ok: result.ok,
      write: result.write,
      commentsCollected: result.commentsCollected,
      entries: result.entries.map((entry) => entry.term),
      writes: writes.length,
      merges: merges.length,
      logs,
    }));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BILIBILI_COVERAGE_AUDIT_REPORT_PATH: '__missing_probe_import_side_effect_guard__.json',
      BILIBILI_DIRECT_PROBE_OUTPUT: '__missing_probe_import_side_effect_guard_corpus__.json',
    },
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);

  assert.equal(result.type, 'function');
  assert.equal(result.ok, true);
  assert.equal(result.write, false);
  assert.equal(result.commentsCollected, 1);
  assert.deepEqual(result.entries, ['查查资料']);
  assert.equal(result.writes, 0);
  assert.equal(result.merges, 0);
  assert.match(result.logs.join('\n'), /Dry run only/);
});

test('probeBilibiliCommentEvidence can delegate reply fetching to Python live-fetch bridge', async () => {
  const script = String.raw`
    const { runDirectProbeCommand } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const pythonCalls = [];
    const term = '\u67e5\u67e5\u8d44\u6599';
    const result = await runDirectProbeCommand({
      argv: ['--query=' + term + ' bilibili comments', '--term=' + term, '--aid=456', '--reply-pages=1', '--reply-page-size=3', '--delay-ms=1000', '--jitter-ms=0'],
      env: { BILIBILI_DIRECT_PROBE_USE_PYTHON_LIVE_FETCH: '1' },
      readJson: async () => ({ nextActions: [] }),
      readJsonCorpus: async () => ({ version: 1, comments: [], runs: [] }),
      readKeywordDictionary: async () => ({
        entries: [{
          term,
          family: 'evidence',
          meaning: 'requires source',
          evidenceCount: 0,
          evidenceSamples: [],
          evidenceSources: [],
        }],
      }),
      pythonLiveFetchComments: async ({ video, options }) => {
        pythonCalls.push({
          video,
          replyPages: options.replyPages,
          replyPageSize: options.replyPageSize,
          includeDanmaku: options.includeDanmaku,
          hasCookie: Boolean(options.cookie),
        });
        return [{
          message: term + ' python ' + video.aid,
          source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av' + video.aid + '/',
          uid: '99',
        }];
      },
      fetchVideoComments: async () => {
        throw new Error('JS reply fetch should not run when Python live fetch is enabled');
      },
      fetchVideoDanmaku: async () => {
        throw new Error('danmaku should not run without include-danmaku');
      },
      discoverVideos: async () => {
        throw new Error('explicit aid should avoid search discovery');
      },
      log: () => {},
      makeCookie: () => 'synthetic=1',
    });
    console.log(JSON.stringify({
      commentsCollected: result.commentsCollected,
      comments: result.comments,
      pythonCalls,
      entries: result.entries.map((entry) => entry.term),
    }));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);

  assert.equal(result.commentsCollected, 1);
  assert.equal(result.comments[0].message, '\u67e5\u67e5\u8d44\u6599 python 456');
  assert.deepEqual(result.entries, ['\u67e5\u67e5\u8d44\u6599']);
  assert.deepEqual(result.pythonCalls, [
    {
      video: { aid: '456', title: 'explicit aid 456' },
      replyPages: 1,
      replyPageSize: 3,
      includeDanmaku: false,
      hasCookie: true,
    },
  ]);
});

test('probeBilibiliCommentEvidence can delegate reply and danmaku fetching to Python live-fetch bridge', async () => {
  const script = String.raw`
    const { runDirectProbeCommand } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const pythonCalls = [];
    const term = '\u5f39\u5e55\u68d2';
    const result = await runDirectProbeCommand({
      argv: ['--query=' + term + ' bilibili comments', '--term=' + term, '--aid=789', '--reply-pages=1', '--reply-page-size=3', '--include-danmaku', '--delay-ms=1000', '--jitter-ms=0'],
      env: { BILIBILI_DIRECT_PROBE_USE_PYTHON_LIVE_FETCH: '1' },
      readJson: async () => ({ nextActions: [] }),
      readJsonCorpus: async () => ({ version: 1, comments: [], runs: [] }),
      readKeywordDictionary: async () => ({
        entries: [{
          term,
          family: 'evidence',
          meaning: 'requires danmaku source',
          evidenceCount: 0,
          evidenceSamples: [],
          evidenceSources: [],
        }],
      }),
      pythonLiveFetchComments: async ({ video, options }) => {
        pythonCalls.push({
          video,
          replyPages: options.replyPages,
          replyPageSize: options.replyPageSize,
          includeDanmaku: options.includeDanmaku,
          hasCookie: Boolean(options.cookie),
        });
        return [
          {
            message: term + ' python reply ' + video.aid,
            source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av' + video.aid + '/',
            uid: '99',
          },
          {
            message: term + ' python danmaku ' + video.aid,
            source: 'Bilibili public direct danmaku probe: https://www.bilibili.com/video/av' + video.aid + '/',
            uid: 'dm',
          },
        ];
      },
      fetchVideoComments: async () => {
        throw new Error('JS reply fetch should not run when Python live fetch is enabled');
      },
      fetchVideoDanmaku: async () => {
        throw new Error('JS danmaku fetch should not run when Python live fetch includes danmaku');
      },
      discoverVideos: async () => {
        throw new Error('explicit aid should avoid search discovery');
      },
      log: () => {},
      makeCookie: () => 'synthetic=1',
    });
    console.log(JSON.stringify({
      commentsCollected: result.commentsCollected,
      messages: result.comments.map((comment) => comment.message),
      warnings: result.warnings,
      pythonCalls,
      entries: result.entries.map((entry) => entry.term),
    }));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const result = JSON.parse(stdout);

  assert.equal(result.commentsCollected, 2);
  assert.deepEqual(result.messages, [
    '\u5f39\u5e55\u68d2 python reply 789',
    '\u5f39\u5e55\u68d2 python danmaku 789',
  ]);
  assert.equal(
    result.warnings.some((warning) => warning.includes('JS danmaku fetch should not run')),
    false,
  );
  assert.deepEqual(result.entries, ['\u5f39\u5e55\u68d2']);
  assert.deepEqual(result.pythonCalls, [
    {
      video: { aid: '789', title: 'explicit aid 789' },
      replyPages: 1,
      replyPageSize: 3,
      includeDanmaku: true,
      hasCookie: true,
    },
  ]);
});

test('probeBilibiliCommentEvidence builds a Python command payload from normal CLI inputs', async () => {
  const script = String.raw`
    const { buildDirectProbeCommandPayload } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const term = '\u67e5\u67e5\u8d44\u6599';
    const payload = buildDirectProbeCommandPayload({
      argv: ['--query=' + term + ' B站评论', '--term=' + term, '--aid=654', '--include-danmaku', '--max-actions=3', '--videos=2', '--source-videos=1', '--write'],
      env: { BILIBILI_DIRECT_PROBE_USE_PYTHON_COMMAND: '1' },
      audit: { nextActions: [] },
      existingCorpus: { version: 1, comments: [{ message: 'old' }], runs: [] },
      dictionary: { entries: [{ term, family: 'evidence' }] },
      cookie: 'synthetic=1',
      now: '2026-06-23T00:00:00.000Z',
    });
    console.log(JSON.stringify(payload));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout);

  assert.deepEqual(payload.audit, { nextActions: [] });
  assert.equal(payload.existingCorpus.comments[0].message, 'old');
  assert.equal(payload.dictionary.entries[0].term, '\u67e5\u67e5\u8d44\u6599');
  assert.deepEqual(payload.explicitAids, ['654']);
  assert.deepEqual(payload.explicitQueries, [{ term: '\u67e5\u67e5\u8d44\u6599', query: '\u67e5\u67e5\u8d44\u6599 B站评论' }]);
  assert.equal(payload.options.maxActions, 3);
  assert.equal(payload.options.videosPerQuery, 2);
  assert.equal(payload.options.sourceVideosPerAction, 1);
  assert.equal(payload.options.includeDanmaku, true);
  assert.equal(payload.options.write, true);
  assert.equal(payload.options.cookie, 'synthetic=1');
  assert.equal(payload.options.now, '2026-06-23T00:00:00.000Z');
});

test('probeBilibiliCommentEvidence forwards Python command runtime operational options', async () => {
  const script = String.raw`
    const { buildDirectProbeCommandPayload } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const payload = buildDirectProbeCommandPayload({
      argv: [
        '--query=operational options',
        '--term=operational',
        '--reply-pages=4',
        '--reply-start-page=3',
        '--reply-page-size=7',
        '--reply-cursor-skip-pages=2',
        '--reply-mode=both',
        '--delay-ms=2500',
        '--jitter-ms=500',
        '--request-timeout-ms=9000',
        '--output=server/data/customDirectProbeCorpus.json',
        '--rescan-source-videos',
      ],
      env: { BILIBILI_DIRECT_PROBE_USE_PYTHON_COMMAND: '1' },
      audit: { nextActions: [] },
      existingCorpus: { version: 1, comments: [], runs: [] },
      dictionary: { entries: [] },
      cookie: 'synthetic=1',
      now: '2026-06-23T00:00:00.000Z',
    });
    console.log(JSON.stringify(payload.options));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const options = JSON.parse(stdout);

  assert.equal(options.replyPages, 4);
  assert.equal(options.replyStartPage, 3);
  assert.equal(options.replyPageSize, 7);
  assert.equal(options.replyCursorSkipPages, 2);
  assert.equal(options.replyMode, 'both');
  assert.equal(options.delayMs, 2500);
  assert.equal(options.jitterMs, 500);
  assert.equal(options.requestTimeoutMs, 9000);
  assert.equal(options.outputPath, 'server/data/customDirectProbeCorpus.json');
  assert.equal(options.rescanSourceVideos, true);
});

test('probeBilibiliCommentEvidence forwards Python live search flag into command payload', async () => {
  const script = String.raw`
    const { buildDirectProbeCommandPayload } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const payload = buildDirectProbeCommandPayload({
      argv: ['--query=ascii-search', '--term=ascii', '--python-live-search'],
      env: { BILIBILI_DIRECT_PROBE_USE_PYTHON_COMMAND: '1' },
      audit: { nextActions: [] },
      existingCorpus: { version: 1, comments: [], runs: [] },
      dictionary: { entries: [] },
      cookie: 'synthetic=1',
      now: '2026-06-23T00:00:00.000Z',
    });
    console.log(JSON.stringify(payload));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.options.usePythonLiveSearch, true);
});

test('probeBilibiliCommentEvidence full Python runtime flag enables command search and fetch payloads', async () => {
  const script = String.raw`
    const { buildDirectProbeCommandPayload } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const payload = buildDirectProbeCommandPayload({
      argv: ['--query=ascii-search', '--term=ascii', '--python-full-runtime'],
      env: {},
      audit: { nextActions: [] },
      existingCorpus: { version: 1, comments: [], runs: [] },
      dictionary: { entries: [] },
      cookie: 'synthetic=1',
      now: '2026-06-23T00:00:00.000Z',
    });
    console.log(JSON.stringify(payload));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout);

  assert.equal(payload.options.usePythonLiveSearch, true);
  assert.equal(payload.options.usePythonLiveFetch, true);
});

test('probeBilibiliCommentEvidence can opt into Python command runtime from normal CLI inputs', async () => {
  const script = String.raw`
    const { runDirectProbeCommand } = await import('./server/scripts/probeBilibiliCommentEvidence.js');
    const calls = [];
    const term = '\u67e5\u67e5\u8d44\u6599';
    const result = await runDirectProbeCommand({
      argv: ['--query=' + term + ' B站评论', '--term=' + term, '--aid=321', '--include-danmaku', '--max-actions=2', '--videos=1', '--source-videos=0'],
      env: { BILIBILI_DIRECT_PROBE_USE_PYTHON_COMMAND: '1' },
      readJson: async () => ({ nextActions: [] }),
      readJsonCorpus: async () => ({ version: 1, comments: [], runs: [] }),
      readKeywordDictionary: async () => ({ entries: [{ term, family: 'evidence', evidenceCount: 0 }] }),
      runPythonCommandPayload: async (payload) => {
        calls.push({
          explicitAids: payload.explicitAids,
          explicitQueries: payload.explicitQueries,
          includeDanmaku: payload.options.includeDanmaku,
          cookie: payload.options.cookie,
        });
        return {
          ok: true,
          bridge: 'python_direct_probe_command_runtime',
          commentsCollected: 1,
          comments: [{ message: term + ' python runtime' }],
          entries: [{ term }],
          actions: payload.explicitQueries,
        };
      },
      discoverVideos: async () => {
        throw new Error('JS discovery should not run during Python command runtime');
      },
      fetchVideoComments: async () => {
        throw new Error('JS comment fetch should not run during Python command runtime');
      },
      fetchVideoDanmaku: async () => {
        throw new Error('JS danmaku fetch should not run during Python command runtime');
      },
      log: () => {},
      makeCookie: () => 'synthetic=1',
      now: () => '2026-06-23T00:00:00.000Z',
    });
    console.log(JSON.stringify({ result, calls }));
  `;
  const { stdout } = await execFileAsync('node', ['--input-type=module', '--eval', script], {
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = JSON.parse(stdout);

  assert.equal(output.result.ok, true);
  assert.equal(output.result.bridge, 'python_direct_probe_command_runtime');
  assert.equal(output.result.commentsCollected, 1);
  assert.deepEqual(output.calls, [
    {
      explicitAids: ['321'],
      explicitQueries: [{ term: '\u67e5\u67e5\u8d44\u6599', query: '\u67e5\u67e5\u8d44\u6599 B站评论' }],
      includeDanmaku: true,
      cookie: 'synthetic=1',
    },
  ]);
});

test('probeBilibiliCommentEvidence CLI can delegate a JSON payload to the Python command bridge', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'direct-probe-python-command-'));
  try {
    const term = '\u67e5\u67e5\u8d44\u6599';
    const query = `${term} B\u7ad9\u8bc4\u8bba`;
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(
      payloadPath,
      JSON.stringify(
        {
          audit: { nextActions: [{ term, nextQuery: query }] },
          dictionary: { entries: [{ term, family: 'evidence', evidenceCount: 0 }] },
          options: { maxActions: 1, videosPerQuery: 1, sourceVideosPerAction: 0 },
          searchVideos: { [query]: [{ aid: '888', title: 'python bridge fixture' }] },
          videoComments: {
            'aid:888': [
              {
                message: `${term}\u547d\u4ee4\u6865\u63a5`,
                source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/av888/',
                uid: '8',
              },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const { stdout } = await execFileAsync('node', ['server/scripts/probeBilibiliCommentEvidence.js', '--python-command', '--payload', payloadPath], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    });
    const result = JSON.parse(stdout);

    assert.equal(result.ok, true);
    assert.equal(result.bridge, 'python_direct_probe_command');
    assert.equal(result.commentsCollected, 1);
    assert.equal(result.comments[0].message, `${term}\u547d\u4ee4\u6865\u63a5`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('probeBilibiliCommentEvidence CLI honors Python command runtime env opt-in', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'direct-probe-python-runtime-cli-'));
  try {
    const auditPath = join(tempDir, 'audit.json');
    const corpusPath = join(tempDir, 'corpus.json');
    await writeFile(auditPath, JSON.stringify({ nextActions: [] }), 'utf8');
    await writeFile(corpusPath, JSON.stringify({ version: 1, comments: [], runs: [] }), 'utf8');

    const { stdout } = await execFileAsync(
      'node',
      ['server/scripts/probeBilibiliCommentEvidence.js', `--audit=${auditPath}`, `--output=${corpusPath}`],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BILIBILI_DIRECT_PROBE_USE_PYTHON_COMMAND: '1',
          PYTHONUTF8: '1',
          PYTHONIOENCODING: 'utf-8',
        },
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    const result = JSON.parse(stdout);

    assert.equal(result.ok, true);
    assert.equal(result.bridge, 'python_direct_probe_command_runtime');
    assert.deepEqual(result.actions, []);
    assert.equal(result.commentsCollected, 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
