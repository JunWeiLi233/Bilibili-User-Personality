import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('scrapeAicuUsers can delegate dry-run planning to Python', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aicu-python-plan-'));
  try {
    const uidFilePath = join(tempDir, 'uids.txt');
    const payloadPath = join(tempDir, 'payload.json');
    writeFileSync(uidFilePath, '233，456', 'utf8');
    writeFileSync(payloadPath, JSON.stringify({ argv: [`--file=${uidFilePath}`] }, null, 2), 'utf8');

    const result = spawnSync('node', ['server/scripts/scrapeAicuUsers.js', '--plan-json', '--python-plan', '--payload', payloadPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.uids, ['233', '456']);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
