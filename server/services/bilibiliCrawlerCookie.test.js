/**
 * Tests for the cookie-handling exports of bilibiliCrawler.js:
 *   - normalizeBilibiliCookie: parsing + validation (incl. header-injection guards)
 *   - depsWithBilibiliCookie: dep-injection wrapper that threads the cookie
 *
 * Header-injection rejection (CR/LF/colon in name, CR/LF in value) is a
 * security-relevant contract (AGENTS.md §4) — these tests pin it.
 *
 * depsWithBilibiliCookie is exercised via injected fake fetchJson/fetchText
 * so no network is touched.
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { normalizeBilibiliCookie, depsWithBilibiliCookie } from './bilibiliCrawler.js';

describe('normalizeBilibiliCookie — parsing', () => {
  test('parses a normal multi-cookie header', () => {
    assert.equal(
      normalizeBilibiliCookie('SESSDATA=abc123; bili_jct=xyz; DedeUserID=99'),
      'SESSDATA=abc123; bili_jct=xyz; DedeUserID=99',
    );
  });

  test('collapses extra whitespace and rejoins with "; "', () => {
    assert.equal(
      normalizeBilibiliCookie('  a=1   ;   b=2  '),
      'a=1; b=2',
    );
  });

  test('returns empty string for null/undefined/empty input', () => {
    assert.equal(normalizeBilibiliCookie(null), '');
    assert.equal(normalizeBilibiliCookie(undefined), '');
    assert.equal(normalizeBilibiliCookie(''), '');
    assert.equal(normalizeBilibiliCookie(0), ''); // String(0)='0' has no '=' → filtered
  });
});

describe('normalizeBilibiliCookie — rejection rules', () => {
  test('drops a part with no "=" (eq === -1, eq<=0 → false)', () => {
    assert.equal(normalizeBilibiliCookie('noequalsign; a=1'), 'a=1');
  });

  test('drops a part where "=" is the first char (empty name, eq===0 → false)', () => {
    assert.equal(normalizeBilibiliCookie('=value; a=1'), 'a=1');
  });

  test('drops a part with empty value', () => {
    assert.equal(normalizeBilibiliCookie('empty=; a=1'), 'a=1');
  });

  test('rejects CR/LF in cookie name (header injection guard)', () => {
    assert.equal(normalizeBilibiliCookie('good=1; evil\rname=2'), 'good=1');
    assert.equal(normalizeBilibiliCookie('good=1; evil\nname=2'), 'good=1');
  });

  test('rejects colon in cookie name (header injection guard)', () => {
    assert.equal(normalizeBilibiliCookie('good=1; ev:il=2'), 'good=1');
  });

  test('rejects CR/LF in cookie value (header injection guard)', () => {
    assert.equal(normalizeBilibiliCookie('good=1; evil=2\r\nX-Inject: bad'), 'good=1');
  });

  test('keeps a value that legitimately contains a colon (e.g. timestamps/urls)', () => {
    // colon is only banned in NAME, not value
    assert.equal(normalizeBilibiliCookie('url=https://x.com:8080'), 'url=https://x.com:8080');
  });
});

describe('depsWithBilibiliCookie', () => {
  test('returns deps unchanged when cookie is empty', () => {
    const deps = { fetchJson: async () => {}, extra: 1 };
    const out = depsWithBilibiliCookie(deps, '');
    // same object reference (no wrapping needed when no cookie)
    assert.equal(out, deps);
    assert.equal(out.extra, 1);
  });

  test('returns deps unchanged when cookie normalizes to empty (all invalid)', () => {
    const deps = { fetchJson: async () => {} };
    assert.equal(depsWithBilibiliCookie(deps, 'invalid-no-equals'), deps);
  });

  test('wraps fetchJson and fetchText to inject bilibiliCookie option', async () => {
    const calls = [];
    const fakeJson = async (url, referer, options) => {
      calls.push({ kind: 'json', url, referer, options });
      return { ok: true };
    };
    const fakeText = async (url, referer, options) => {
      calls.push({ kind: 'text', url, referer, options });
      return 'text';
    };
    const out = depsWithBilibiliCookie({ fetchJson: fakeJson, fetchText: fakeText }, 'SESSDATA=abc');
    assert.notEqual(out.fetchJson, fakeJson); // wrapped
    assert.notEqual(out.fetchText, fakeText);

    await out.fetchJson('https://api.test', 'https://ref.test');
    await out.fetchText('https://api.test/t', 'https://ref.test');

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.bilibiliCookie, 'SESSDATA=abc');
    assert.equal(calls[1].options.bilibiliCookie, 'SESSDATA=abc');
  });

  test('preserves other options when injecting bilibiliCookie', async () => {
    const seen = [];
    const out = depsWithBilibiliCookie(
      { fetchJson: async (u, r, o) => { seen.push(o); return {}; } },
      'SESSDATA=abc',
    );
    await out.fetchJson('u', 'r', { extra: 'keep', bilibiliCookie: 'should-be-overwritten' });
    assert.equal(seen[0].extra, 'keep');
    assert.equal(seen[0].bilibiliCookie, 'SESSDATA=abc');
  });

  test('falls back to module fetchJson/fetchText when deps omits them', async () => {
    // We can't easily assert the module-level fns are called without network,
    // but we can assert the wrapper exists and propagates the cookie option
    // through a provided fetchJson only (deps.fetchJson takes precedence).
    const seen = [];
    const out = depsWithBilibiliCookie({}, 'SESSDATA=abc');
    // out.fetchJson is the module-level fetchJson (not undefined)
    assert.equal(typeof out.fetchJson, 'function');
    // explicitly provide deps.fetchJson to avoid real network in the next call
    const out2 = depsWithBilibiliCookie(
      { fetchJson: async (u, r, o) => { seen.push(o); return {}; } },
      'SESSDATA=abc',
    );
    await out2.fetchJson('u', 'r', {});
    assert.equal(seen[0].bilibiliCookie, 'SESSDATA=abc');
    void seen; void out;
  });
});
