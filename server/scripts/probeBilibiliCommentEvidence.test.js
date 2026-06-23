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
        message: ` + "`查查资料 fixture ${video.aid}`" + `,
        source: ` + "`Bilibili public direct comment probe: https://www.bilibili.com/video/av${video.aid}/`" + `,
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
