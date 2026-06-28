import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENV,
  DEFAULTS,
  resolveScraperConfig,
  validateScraperConfig,
} from './scraperConfig.js';

// ── resolveScraperConfig ─────────────────────────────────────────────────────

test('resolveScraperConfig: returns defaults when no env vars are set', () => {
  const cfg = resolveScraperConfig({});
  assert.equal(cfg.minDelayMs, DEFAULTS.minDelayMs);
  assert.equal(cfg.jitterMs, DEFAULTS.jitterMs);
  assert.equal(cfg.blockCooldownMs, DEFAULTS.blockCooldownMs);
  assert.equal(cfg.cacheTtlMs, DEFAULTS.cacheTtlMs);
  assert.equal(cfg.longPauseProbability, DEFAULTS.longPauseProbability);
  assert.equal(cfg.longPauseMinMs, DEFAULTS.longPauseMinMs);
  assert.equal(cfg.longPauseMaxMs, DEFAULTS.longPauseMaxMs);
  assert.equal(cfg.pagePauseMinMs, DEFAULTS.pagePauseMinMs);
  assert.equal(cfg.pagePauseMaxMs, DEFAULTS.pagePauseMaxMs);
  assert.equal(cfg.objectPauseMinMs, DEFAULTS.objectPauseMinMs);
  assert.equal(cfg.objectPauseMaxMs, DEFAULTS.objectPauseMaxMs);
  assert.equal(cfg.requestTimeoutMs, DEFAULTS.requestTimeoutMs);
  assert.equal(cfg.proxyList, '');
  assert.equal(cfg.rateBurst, 0);
  assert.equal(cfg.rateSustain, 0);
  assert.equal(cfg.crawlerUa, '');
  assert.equal(cfg.sessionCheckIntervalMs, DEFAULTS.sessionCheckIntervalMs);
  assert.equal(cfg.cookie, '');
});

test('resolveScraperConfig: reads all env vars with correct types', () => {
  const cfg = resolveScraperConfig({
    [ENV.MIN_DELAY_MS]: '500',
    [ENV.JITTER_MS]: '300',
    [ENV.BLOCK_COOLDOWN_MS]: '60000',
    [ENV.CACHE_TTL_MS]: '120000',
    [ENV.LONG_PAUSE_PROBABILITY]: '0.25',
    [ENV.LONG_PAUSE_MIN_MS]: '2000',
    [ENV.LONG_PAUSE_MAX_MS]: '9000',
    [ENV.PAGE_PAUSE_MIN_MS]: '800',
    [ENV.PAGE_PAUSE_MAX_MS]: '4000',
    [ENV.OBJECT_PAUSE_MIN_MS]: '1000',
    [ENV.OBJECT_PAUSE_MAX_MS]: '6000',
    [ENV.REQUEST_TIMEOUT_MS]: '15000',
    [ENV.PROXY_LIST]: 'http://proxy1:8080,http://proxy2:8080',
    [ENV.RATE_BURST]: '12',
    [ENV.RATE_SUSTAIN]: '4',
    [ENV.CRAWLER_UA]: 'Mozilla/5.0 TestBrowser',
    [ENV.SESSION_CHECK_INTERVAL_MS]: '600000',
    [ENV.COOKIE]: 'SESSDATA=abc; bili_jct=xyz',
  });

  assert.equal(cfg.minDelayMs, 500);
  assert.equal(cfg.jitterMs, 300);
  assert.equal(cfg.blockCooldownMs, 60000);
  assert.equal(cfg.cacheTtlMs, 120000);
  assert.equal(cfg.longPauseProbability, 0.25);
  assert.equal(cfg.longPauseMinMs, 2000);
  assert.equal(cfg.longPauseMaxMs, 9000);
  assert.equal(cfg.pagePauseMinMs, 800);
  assert.equal(cfg.pagePauseMaxMs, 4000);
  assert.equal(cfg.objectPauseMinMs, 1000);
  assert.equal(cfg.objectPauseMaxMs, 6000);
  assert.equal(cfg.requestTimeoutMs, 15000);
  assert.equal(cfg.proxyList, 'http://proxy1:8080,http://proxy2:8080');
  assert.equal(cfg.rateBurst, 12);
  assert.equal(cfg.rateSustain, 4);
  assert.equal(cfg.crawlerUa, 'Mozilla/5.0 TestBrowser');
  assert.equal(cfg.sessionCheckIntervalMs, 600000);
  assert.equal(cfg.cookie, 'SESSDATA=abc; bili_jct=xyz');
});

test('resolveScraperConfig: clamps negative values to 0', () => {
  const cfg = resolveScraperConfig({
    [ENV.MIN_DELAY_MS]: '-100',
    [ENV.CACHE_TTL_MS]: '-50',
    [ENV.LONG_PAUSE_PROBABILITY]: '-0.5',
  });
  assert.equal(cfg.minDelayMs, 0, 'negative minDelay should clamp to 0');
  assert.equal(cfg.cacheTtlMs, 0, 'negative cacheTtl should clamp to 0');
  assert.equal(cfg.longPauseProbability, 0, 'negative probability should clamp to 0');
});

test('resolveScraperConfig: clamps probability above 1 to 1', () => {
  const cfg = resolveScraperConfig({
    [ENV.LONG_PAUSE_PROBABILITY]: '2.5',
  });
  assert.equal(cfg.longPauseProbability, 1);
});

test('resolveScraperConfig: handles non-numeric strings by falling back to defaults', () => {
  const cfg = resolveScraperConfig({
    [ENV.MIN_DELAY_MS]: 'not-a-number',
    [ENV.BLOCK_COOLDOWN_MS]: 'abc',
  });
  assert.equal(cfg.minDelayMs, DEFAULTS.minDelayMs);
  assert.equal(cfg.blockCooldownMs, DEFAULTS.blockCooldownMs);
});

test('resolveScraperConfig: trims whitespace from string values', () => {
  const cfg = resolveScraperConfig({
    [ENV.PROXY_LIST]: '  http://proxy1:8080  ,  http://proxy2:8080  ',
    [ENV.CRAWLER_UA]: '  Mozilla/5.0  ',
    [ENV.COOKIE]: '  SESSDATA=abc  ',
  });
  assert.equal(cfg.proxyList, 'http://proxy1:8080  ,  http://proxy2:8080');
  assert.equal(cfg.crawlerUa, 'Mozilla/5.0');
  assert.equal(cfg.cookie, 'SESSDATA=abc');
});

// ── validateScraperConfig ────────────────────────────────────────────────────

test('validateScraperConfig: returns valid=true with no errors for empty env', () => {
  const result = validateScraperConfig({});
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  // No warnings either — defaults are sensible
});

test('validateScraperConfig: returns valid=true for a fully specified valid config', () => {
  const result = validateScraperConfig({
    [ENV.MIN_DELAY_MS]: '500',
    [ENV.JITTER_MS]: '300',
    [ENV.BLOCK_COOLDOWN_MS]: '60000',
    [ENV.CACHE_TTL_MS]: '300000',
    [ENV.LONG_PAUSE_PROBABILITY]: '0.15',
    [ENV.LONG_PAUSE_MIN_MS]: '3000',
    [ENV.LONG_PAUSE_MAX_MS]: '8000',
    [ENV.PAGE_PAUSE_MIN_MS]: '1500',
    [ENV.PAGE_PAUSE_MAX_MS]: '3000',
    [ENV.OBJECT_PAUSE_MIN_MS]: '2000',
    [ENV.OBJECT_PAUSE_MAX_MS]: '5000',
    [ENV.REQUEST_TIMEOUT_MS]: '30000',
    [ENV.PROXY_LIST]: 'http://proxy1:8080,http://proxy2:8080',
    [ENV.RATE_BURST]: '10',
    [ENV.RATE_SUSTAIN]: '3',
    [ENV.CRAWLER_UA]: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0',
    [ENV.SESSION_CHECK_INTERVAL_MS]: '1800000',
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateScraperConfig: reports errors for non-numeric values', () => {
  const result = validateScraperConfig({
    [ENV.MIN_DELAY_MS]: 'abc',
    [ENV.BLOCK_COOLDOWN_MS]: 'xyz',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.includes('minDelayMs')), 'should error on minDelayMs');
  assert.ok(result.errors.some(e => e.includes('blockCooldownMs')), 'should error on blockCooldownMs');
});

test('validateScraperConfig: warns on negative values', () => {
  const result = validateScraperConfig({
    [ENV.MIN_DELAY_MS]: '-100',
    [ENV.JITTER_MS]: '-50',
  });
  // Negative values produce warnings, not errors (they get clamped at runtime)
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('negative')), 'should warn about negative values');
});

test('validateScraperConfig: warns when probability is outside [0,1]', () => {
  const result = validateScraperConfig({
    [ENV.LONG_PAUSE_PROBABILITY]: '2.0',
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('[0,1]')), 'should warn about out-of-range probability');
});

test('validateScraperConfig: warns when min > max for paired pauses', () => {
  const result = validateScraperConfig({
    [ENV.LONG_PAUSE_MIN_MS]: '9000',
    [ENV.LONG_PAUSE_MAX_MS]: '1000',
    [ENV.PAGE_PAUSE_MIN_MS]: '5000',
    [ENV.PAGE_PAUSE_MAX_MS]: '1000',
  });
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(w => w.includes('longPause') && w.includes('>')), 'should warn about longPause min > max');
  assert.ok(result.warnings.some(w => w.includes('pagePause') && w.includes('>')), 'should warn about pagePause min > max');
});

test('validateScraperConfig: warns when all delays are 0 (full-speed mode)', () => {
  const result = validateScraperConfig({
    [ENV.MIN_DELAY_MS]: '0',
    [ENV.JITTER_MS]: '0',
    [ENV.LONG_PAUSE_PROBABILITY]: '0',
  });
  assert.equal(result.valid, true);
  assert.ok(
    result.warnings.some(w => w.includes('full speed')),
    'should warn when all pacing is disabled',
  );
});

test('validateScraperConfig: warns on suspiciously short User-Agent', () => {
  const result = validateScraperConfig({
    [ENV.CRAWLER_UA]: 'short',
  });
  assert.equal(result.valid, true);
  assert.ok(
    result.warnings.some(w => w.includes('short') && w.includes('User-Agent')),
    'should warn about short UA',
  );
});

test('validateScraperConfig: warns on malformed proxy URL entries', () => {
  const result = validateScraperConfig({
    [ENV.PROXY_LIST]: 'good-host:8080,@@@@bad@@@,another:3128',
  });
  assert.equal(result.valid, true);
  assert.ok(
    result.warnings.some(w => w.includes('@@@@bad@@@') && w.includes('proxy')),
    'should warn about malformed proxy entry',
  );
});
