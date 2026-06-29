import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

// Use a temporary directory so tests don't touch the real memory file.
const tmpDir = mkdtempSync(join(tmpdir(), 'scraperMemory-test-'));
process.env.SCRAPER_MEMORY_PATH = join(tmpDir, 'scraper_link_memory.json');

// Import after setting SCRAPER_MEMORY_PATH so resolvePath() picks it up.
// The env var is read at call time, not import time, so this is safe.
import { loadMemory, saveMemory, isProcessed, markProcessed, clearMemory } from '../services/scraperMemory.js';

test('markProcessed + isProcessed round-trips', () => {
  markProcessed('uid', '438392501', { source: 'test' });
  assert.equal(isProcessed('uid', '438392501'), true);
});

test('isProcessed returns false for unknown entry', () => {
  assert.equal(isProcessed('uid', '999999999'), false);
  assert.equal(isProcessed('video', 'BV1xx411c7mD'), false);
});

test('different types do not collide', () => {
  markProcessed('uid', '12345');
  assert.equal(isProcessed('video', '12345'), false);
  assert.equal(isProcessed('favorite', '12345'), false);
  assert.equal(isProcessed('uid', '12345'), true);
});

test('clearMemory removes all entries', () => {
  markProcessed('uid', '111');
  markProcessed('video', 'BV2222222222');
  assert.equal(isProcessed('uid', '111'), true);
  assert.equal(isProcessed('video', 'BV2222222222'), true);

  clearMemory();

  assert.equal(isProcessed('uid', '111'), false);
  assert.equal(isProcessed('video', 'BV2222222222'), false);
});

test('loadMemory returns valid structure for a missing file', () => {
  // Clear and verify the file no longer exists on disk, then reload.
  clearMemory();
  const mem = loadMemory();
  assert.equal(mem.version, 1);
  assert.deepEqual(mem.entries, {});
});

// Cleanup
test.after(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});
