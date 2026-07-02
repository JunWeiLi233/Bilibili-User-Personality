import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTransientCoverageError,
  computeBackoffMs,
  shouldRestartRun,
} from './runCoverageHarvestLoop.js';

// ponytail: pure decision logic, testable without DEEPSEEK_API_KEY / network.
// The live harvest loop is exercised by the user; these tests pin the resilience policy.

test('isTransientCoverageError: network/connection codes are transient', () => {
  for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'ESOCKETTIMEDOUT']) {
    assert.equal(isTransientCoverageError({ code }), true, `${code} should be transient`);
  }
});

test('isTransientCoverageError: socket/fetch/timeout messages are transient', () => {
  for (const msg of ['socket hang up', 'fetch failed', 'network error', 'getaddrinfo ENOTFOUND api.example.com', 'request timed out']) {
    assert.equal(isTransientCoverageError(new Error(msg)), true, `${msg} should be transient`);
  }
});

test('isTransientCoverageError: HTTP 429 / 5xx / rate-limit text are transient', () => {
  for (const msg of ['HTTP 429 Too Many Requests', 'status 503', '502 Bad Gateway', 'rate limit exceeded', 'service unavailable']) {
    assert.equal(isTransientCoverageError(new Error(msg)), true, `${msg} should be transient`);
  }
});

test('isTransientCoverageError: programming/config errors are NOT transient', () => {
  for (const err of [new Error('Cannot read properties of undefined'), new TypeError('x is not a function'), new Error('ENOENT: no such file dictionary.json'), { message: 'Invalid DEEPSEEK_API_KEY' }]) {
    assert.equal(isTransientCoverageError(err), false);
  }
});

test('computeBackoffMs: exponential, capped, within bounds, increases with attempt', () => {
  const base = 5000, cap = 120000;
  const b1 = computeBackoffMs(1, base, cap);
  const b2 = computeBackoffMs(2, base, cap);
  const b5 = computeBackoffMs(5, base, cap);
  assert.ok(b1 >= base * 0.5 && b1 <= base, `attempt 1 within [0.5*base, base]: ${b1}`);
  assert.ok(b2 >= base && b2 <= base * 2, `attempt 2 within [base, 2*base]: ${b2}`);
  assert.ok(b5 <= cap, `attempt 5 capped at ${cap}: ${b5}`);
});

test('shouldRestartRun: restarts while gate unmet and progress being made', () => {
  assert.equal(shouldRestartRun({ auditOk: false, restartsUsed: 0, maxRestarts: 5, consecutiveNoProgress: 0, maxConsecutiveNoProgress: 2 }), true);
});

test('shouldRestartRun: stops when coverage gate passed', () => {
  assert.equal(shouldRestartRun({ auditOk: true, restartsUsed: 0, maxRestarts: 5, consecutiveNoProgress: 0, maxConsecutiveNoProgress: 2 }), false);
});

test('shouldRestartRun: stops at max restarts', () => {
  assert.equal(shouldRestartRun({ auditOk: false, restartsUsed: 5, maxRestarts: 5, consecutiveNoProgress: 0, maxConsecutiveNoProgress: 2 }), false);
});

test('shouldRestartRun: stops on consecutive no-progress wall', () => {
  assert.equal(shouldRestartRun({ auditOk: false, restartsUsed: 2, maxRestarts: 5, consecutiveNoProgress: 2, maxConsecutiveNoProgress: 2 }), false);
});
