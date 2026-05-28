import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('runCoverageHarvestLoop.js forces auto coverage to DeepSeek v4 flash max effort', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'coverage-loop-script-'));
  try {
    const dictionaryPath = join(tempDir, 'dictionary.json');
    writeFileSync(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [],
      }),
      'utf8',
    );

    const result = spawnSync('node', ['server/runCoverageHarvestLoop.js'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DEEPSEEK_KEYWORD_DICTIONARY_PATH: dictionaryPath,
        BILIBILI_HARVEST_STATE_PATH: join(tempDir, 'state.json'),
        BILIBILI_COVERAGE_LOOP_REPORT_PATH: join(tempDir, 'report.json'),
        BILIBILI_COVERAGE_LOOP_MAX_CYCLES: '0',
        DEEPSEEK_MODEL: 'deepseek-v4-pro',
        DEEPSEEK_REASONING_EFFORT: 'medium',
      },
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DeepSeek model: deepseek-v4-flash/);
    assert.match(result.stdout, /DeepSeek reasoning effort: max/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
