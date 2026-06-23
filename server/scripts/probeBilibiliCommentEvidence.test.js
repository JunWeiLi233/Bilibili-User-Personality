import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
