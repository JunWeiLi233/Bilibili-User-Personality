import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const OLD_COMMENT = '\u65e7\u8bc4\u8bba';
const NEW_COMMENT = '\u65b0\u5f39\u5e55\u8bc4\u8bba';

export const DEFAULT_PAYLOAD = {
  existing: {
    version: 1,
    comments: [{ message: OLD_COMMENT, source: 'Bilibili direct probe fixture', uid: '1' }],
    runs: [],
  },
  comments: [
    {
      message: NEW_COMMENT,
      source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BV1fixture',
      uid: '2',
    },
    { message: 'ascii only skip', source: 'Bilibili direct probe fixture', uid: '3' },
    { message: OLD_COMMENT, source: 'duplicate fixture', uid: '1' },
  ],
  run: {
    at: '2026-06-23T00:00:00.000Z',
    query: '\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba',
    videos: [{ key: 'bvid:BV1fixture', bvid: 'BV1fixture' }],
  },
};

export const DEFAULT_JS_REPORT = {
  ok: true,
  corpus: {
    version: 1,
    comments: [
      { message: OLD_COMMENT, source: 'Bilibili direct probe fixture', uid: '1' },
      {
        message: NEW_COMMENT,
        source: 'Bilibili public direct comment probe: https://www.bilibili.com/video/BV1fixture',
        uid: '2',
      },
    ],
    runs: [
      {
        at: '2026-06-23T00:00:00.000Z',
        query: '\u67e5\u67e5\u8d44\u6599 B\u7ad9\u8bc4\u8bba',
        videos: [{ key: 'bvid:BV1fixture', bvid: 'BV1fixture' }],
        commentsCollected: 3,
        commentsAdded: 1,
      },
    ],
    updatedAt: '2026-06-23T00:00:00.000Z',
  },
};

async function runPythonDirectProbeCorpus({ payloadPath, jsReportPath }) {
  const { stdout } = await execFileAsync(
    'python',
    ['-m', 'python_backend.cli.direct_probe_corpus', '--payload', payloadPath, '--compare-js-report', jsReportPath],
    {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout);
}

export async function compareDirectProbeCorpus({
  payload = DEFAULT_PAYLOAD,
  jsReport = DEFAULT_JS_REPORT,
  runPython = runPythonDirectProbeCorpus,
} = {}) {
  const tempDir = await mkdtemp(join(tmpdir(), 'direct-probe-corpus-compare-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const jsReportPath = join(tempDir, 'js-report.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(jsReportPath, JSON.stringify(jsReport, null, 2), 'utf8');

    const comparison = await runPython({ payload, jsReport, payloadPath, jsReportPath });
    return {
      ok: Boolean(comparison.ok),
      fixture: { payloadPath, jsReportPath },
      js: comparison.js,
      python: comparison.python,
      mismatches: Array.isArray(comparison.mismatches) ? comparison.mismatches : [],
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const result = await compareDirectProbeCorpus();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
