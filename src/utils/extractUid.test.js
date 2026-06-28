import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractUid, uidError } from './extractUid.js';

// --- High confidence UIDs ---

test('plain numeric UID', () => {
  const r = extractUid('453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'free-text');
});

test('UID: label with colon', () => {
  const r = extractUid('UID: 453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'uid-label');
});

test('UID label without space', () => {
  const r = extractUid('UID453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'uid-label');
});

test('mid label', () => {
  const r = extractUid('mid 453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'uid-label');
});

test('space.bilibili.com URL', () => {
  const r = extractUid('https://space.bilibili.com/453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'space-url');
});

test('space.bilibili.com URL with trailing path', () => {
  const r = extractUid('space.bilibili.com/453244911/dynamic');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'space-url');
});

test('mixed Chinese text with UID', () => {
  const r = extractUid('查一下 453244911 这个用户');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'free-text');
});

test('bilibili.com member URL', () => {
  const r = extractUid('https://www.bilibili.com/453244911/');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'member-url');
});

// --- Rejected / edge cases ---

test('rejects BV video ID', () => {
  // BV1xx2233: digits after BV/non-digit chars should be rejected.
  // Plan says BV/AV should be rejected entirely. We fix extractUid to block BV/AV prefixes globally.
  const r = extractUid('BV1xx2233');
  assert.equal(r.uid, null, 'BV-prefixed IDs should be rejected');
  assert.equal(r.confidence, 'none');
});

test('rejects video page URL', () => {
  const r = extractUid('https://www.bilibili.com/video/BV1xx');
  assert.equal(r.uid, null);
  assert.equal(r.confidence, 'none');
});

test('rejects short digit run (< 4 chars)', () => {
  const r = extractUid('12');
  assert.equal(r.uid, null);
  assert.equal(r.confidence, 'none');
  assert.equal(r.source, 'too-short');
});

test('low confidence for 4-5 digit UID', () => {
  const r = extractUid('1234');
  assert.equal(r.uid, '1234');
  assert.equal(r.confidence, 'low');
  assert.equal(r.source, 'free-text');
});

test('rejects empty input', () => {
  const r = extractUid('');
  assert.equal(r.uid, null);
  assert.equal(r.confidence, 'none');
  assert.equal(r.source, 'empty');
});

test('rejects null/undefined input', () => {
  const r = extractUid(null);
  assert.equal(r.uid, null);
  assert.equal(r.confidence, 'none');
  assert.equal(r.source, 'empty');
});

test('rejects AV video ID', () => {
  const r = extractUid('AV170001');
  assert.equal(r.uid, null);
  assert.equal(r.confidence, 'none');
});

test('prefers space URL over free text', () => {
  const r = extractUid('space.bilibili.com/453244911/dynamic 有人知道这个用户吗');
  assert.equal(r.uid, '453244911');
  assert.equal(r.source, 'space-url');
  assert.equal(r.confidence, 'high');
});

test('uid-label takes priority over free text per extraction order', () => {
  // Step 2 (uid-label) fires before step 4 (free text).
  // "uid 1234" matches uid-label with 4 digits, which is valid per the label regex.
  const r = extractUid('uid 1234 和 453244911 哪个');
  assert.equal(r.uid, '1234');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'uid-label');
});

// --- uidError ---

test('uidError: returns message for empty', () => {
  const msg = uidError('empty');
  assert.ok(msg && msg.length > 0);
});
test('Chinese UID label: 用户ID', () => {
  const r = extractUid('用户ID 453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'uid-label');
});

test('Chinese UID label: 成员ID', () => {
  const r = extractUid('成员ID 453244911');
  assert.equal(r.uid, '453244911');
  assert.equal(r.confidence, 'high');
  assert.equal(r.source, 'uid-label');
});

test('uidError: returns null for valid sources', () => {
  assert.equal(uidError('space-url'), null);
  assert.equal(uidError('uid-label'), null);
  assert.equal(uidError('member-url'), null);
  assert.equal(uidError('free-text'), null);
});

test('uidError: returns message for no-digits', () => {
  const msg = uidError('no-digits');
  assert.ok(msg && msg.length > 0);
});

test('uidError: returns message for too-short', () => {
  const msg = uidError('too-short');
  assert.ok(msg && msg.length > 0);
});
