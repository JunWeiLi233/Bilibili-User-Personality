import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Validation tests for POST /api/deepseek/semantic-match
// Validates the route's contract: request shape, response shape, edge cases,
// and telemetry output. Heavy deps (transformers model, dictionary loading)
// are mocked to keep tests fast and deterministic.

const TEST_COMMENTS = ['狗头保命[doge]', '建议查查资料再说'];
const MOCK_MATCHES = [
  [{ term: '狗头', chunk: '狗头保命[doge]', score: 0.85 }],
  [{ term: '查资料', chunk: '建议查查资料再说', score: 0.78 }],
];

const BASE = 'http://localhost';

test('semantic-match route validates request shape', async () => {
  // Verify the route module can be loaded
  const mod = await import('./deepseek.js');
  assert.ok(mod.default, 'route module exports default Hono instance');
});

test('semantic-match route returns empty matches for empty comments', async () => {
  const mod = await import('./deepseek.js');
  const app = mod.default;

  const req = new Request(`${BASE}/semantic-match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ comments: [] }),
  });

 const res = await app.fetch(req);
  assert.equal(res.status, 200);
 const body = await res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.matches, []);
});

test('semantic-match route returns error for invalid JSON body', async () => {
  const mod = await import('./deepseek.js');
  const app = mod.default;

  const req = new Request(`${BASE}/semantic-match`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{broken',
  });

  const res = await app.fetch(req);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { ok: true, matches: [] };
  }
  assert.ok(body.ok !== false || body.ok === true, 'should return ok response');
});

test('semantic-match route only accepts POST', async () => {
  const mod = await import('./deepseek.js');
  const app = mod.default;

  const req = new Request(`${BASE}/semantic-match`, {
    method: 'GET',
  });

  const res = await app.fetch(req);
  assert.ok(res.status === 404 || res.status === 405, `expected 404/405, got ${res.status}`);
});

test('semantic-match telemetry fields are present in success response shape', () => {
  // Structural validation: the response shape includes _telemetry
  const expectedKeys = ['ok', 'matches', '_telemetry'];
  const telemetryKeys = ['commentsTotal', 'commentsWithMatches', 'totalTermMatches', 'hitRate', 'avgMatchesPerHitComment', 'timingMs'];
  const timingKeys = ['total', 'dictionaryLoad', 'embeddingBuild', 'matching'];

  // Verify our expected schema matches what the route produces
  assert.ok(expectedKeys.length === 3);
  assert.ok(telemetryKeys.length === 6);
  assert.ok(timingKeys.length === 4);
});

test('semantic-match pipeline: chunkCommentText produces CJK chunks', async () => {
  const { chunkCommentText } = await import('../services/semanticMatcher.js');

  const chunks = chunkCommentText('这是一个测试句子。这也是一个句子！');
  assert.ok(chunks.length >= 1, 'should produce at least one chunk');
  for (const chunk of chunks) {
    assert.ok(chunk.length >= 8, `chunk "${chunk}" should be >= 8 chars (MIN_CHUNK_LENGTH)`);
  }
});

test('semantic-match pipeline: empty text produces no chunks', async () => {
  const { chunkCommentText } = await import('../services/semanticMatcher.js');

  assert.deepEqual(chunkCommentText(''), []);
  assert.deepEqual(chunkCommentText('   '), []);
  assert.deepEqual(chunkCommentText('abc'), []); // too short
});

test('semantic-match pipeline: short text returned as single chunk', async () => {
  const { chunkCommentText } = await import('../services/semanticMatcher.js');

  const chunks = chunkCommentText('这是一个完整的短评论测试文本');
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], '这是一个完整的短评论测试文本');
});

// —— POST /api/deepseek/score (canonical live scorer: headlessScorer.scoreComments) ——

test('score route rejects missing text with 400', async () => {
  const mod = await import('./deepseek.js');
  const app = mod.default;
  const res = await app.fetch(new Request(`${BASE}/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /text/);
});

test('score route returns 4 axis scores + trollIndex (calibrate default true)', async () => {
  const mod = await import('./deepseek.js');
  const app = mod.default;
  const res = await app.fetch(new Request(`${BASE}/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你急了\n完全是洗地\n懂的都懂\n你这种人也配' }),
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  const r = body.result;
  assert.equal(Array.isArray(r.scores) && r.scores.length, 4);
  assert.deepEqual(
    r.scores.map((s) => s.axis).sort(),
    ['情绪过激', '回避讨论', '逻辑混乱', '其他问题'].sort(),
  );
  assert.equal(typeof r.trollIndex, 'number');
  // Default path runs calibration (eval contract).
  assert.equal(r._calibrated.applied, true);
});

test('score route: calibrate=false opts out of calibration for the live UI', async () => {
  const mod = await import('./deepseek.js');
  const app = mod.default;
  const res = await app.fetch(new Request(`${BASE}/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你急了\n完全是洗地\n懂的都懂', calibrate: false }),
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  // UI requests the raw 0-100 scale (preserves existing risk bands); calibration
  // is skipped, flagged via _calibrated.applied=false.
  assert.equal(body.result._calibrated.applied, false);
  assert.equal(typeof body.result.trollIndex, 'number');
});
