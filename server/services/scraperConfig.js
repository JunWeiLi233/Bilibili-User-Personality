// ── Unified scraper configuration ───────────────────────────────────────────────
// Single source of truth for all Bilibili crawler env vars.
// Provides resolution (env → typed config) and validation (range, format, semantics).

// ── Env var name constants ────────────────────────────────────────────────────
// Use these instead of raw strings in other modules so renaming is safe.

export const ENV = {
  MIN_DELAY_MS:               'BILIBILI_CRAWLER_MIN_DELAY_MS',
  JITTER_MS:                  'BILIBILI_CRAWLER_JITTER_MS',
  BLOCK_COOLDOWN_MS:          'BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS',
  CACHE_TTL_MS:               'BILIBILI_CRAWLER_CACHE_TTL_MS',
  LONG_PAUSE_PROBABILITY:     'BILIBILI_CRAWLER_LONG_PAUSE_PROBABILITY',
  LONG_PAUSE_MIN_MS:          'BILIBILI_CRAWLER_LONG_PAUSE_MIN_MS',
  LONG_PAUSE_MAX_MS:          'BILIBILI_CRAWLER_LONG_PAUSE_MAX_MS',
  PAGE_PAUSE_MIN_MS:          'BILIBILI_CRAWLER_PAGE_PAUSE_MIN_MS',
  PAGE_PAUSE_MAX_MS:          'BILIBILI_CRAWLER_PAGE_PAUSE_MAX_MS',
  OBJECT_PAUSE_MIN_MS:        'BILIBILI_CRAWLER_OBJECT_PAUSE_MIN_MS',
  OBJECT_PAUSE_MAX_MS:        'BILIBILI_CRAWLER_OBJECT_PAUSE_MAX_MS',
  REQUEST_TIMEOUT_MS:         'BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS',
  PROXY_LIST:                 'BILIBILI_PROXY_LIST',
  RATE_BURST:                 'BILIBILI_RATE_BURST',
  RATE_SUSTAIN:               'BILIBILI_RATE_SUSTAIN',
  CRAWLER_UA:                 'BILIBILI_CRAWLER_UA',
  SESSION_CHECK_INTERVAL_MS:  'BILIBILI_SESSION_CHECK_INTERVAL_MS',
  COOKIE:                     'BILIBILI_COOKIE',
};

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULTS = Object.freeze({
  minDelayMs: 2500,
  jitterMs: 2000,
  blockCooldownMs: 120000,
  cacheTtlMs: 300000,
  longPauseProbability: 0.15,
  longPauseMinMs: 3000,
  longPauseMaxMs: 8000,
  pagePauseMinMs: 1500,
  pagePauseMaxMs: 3000,
  objectPauseMinMs: 2000,
  objectPauseMaxMs: 5000,
  requestTimeoutMs: 30000,
  proxyList: '',
  rateBurst: 0,
  rateSustain: 0,
  crawlerUa: '',
  sessionCheckIntervalMs: 1800000,
  cookie: '',
});

// ── Resolution ────────────────────────────────────────────────────────────────

/**
 * Resolve all scraper config from an env-like object.
 * @param {Record<string,string|undefined>} [env=process.env]
 * @returns {object} resolved config (same shape as DEFAULTS)
 */
export function resolveScraperConfig(env = process.env) {
  const e = env || {};

  const readNonNeg = (key, fallback) => {
    const raw = e[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback; // NaN / Infinity → use default
    return Math.max(0, n);
  };
  const readProb = (key, fallback) => {
    const raw = e[key];
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
  };
  const readStr = (key, fallback) => {
    const raw = e[key];
    return raw === undefined || raw === null ? fallback : String(raw).trim();
  };

  return {
    minDelayMs:              readNonNeg(ENV.MIN_DELAY_MS,              DEFAULTS.minDelayMs),
    jitterMs:                readNonNeg(ENV.JITTER_MS,                 DEFAULTS.jitterMs),
    blockCooldownMs:         readNonNeg(ENV.BLOCK_COOLDOWN_MS,         DEFAULTS.blockCooldownMs),
    cacheTtlMs:              readNonNeg(ENV.CACHE_TTL_MS,              DEFAULTS.cacheTtlMs),
    longPauseProbability:    readProb(ENV.LONG_PAUSE_PROBABILITY,      DEFAULTS.longPauseProbability),
    longPauseMinMs:          readNonNeg(ENV.LONG_PAUSE_MIN_MS,         DEFAULTS.longPauseMinMs),
    longPauseMaxMs:          readNonNeg(ENV.LONG_PAUSE_MAX_MS,         DEFAULTS.longPauseMaxMs),
    pagePauseMinMs:          readNonNeg(ENV.PAGE_PAUSE_MIN_MS,         DEFAULTS.pagePauseMinMs),
    pagePauseMaxMs:          readNonNeg(ENV.PAGE_PAUSE_MAX_MS,         DEFAULTS.pagePauseMaxMs),
    objectPauseMinMs:        readNonNeg(ENV.OBJECT_PAUSE_MIN_MS,       DEFAULTS.objectPauseMinMs),
    objectPauseMaxMs:        readNonNeg(ENV.OBJECT_PAUSE_MAX_MS,       DEFAULTS.objectPauseMaxMs),
    requestTimeoutMs:        readNonNeg(ENV.REQUEST_TIMEOUT_MS,        DEFAULTS.requestTimeoutMs),
    proxyList:               readStr(ENV.PROXY_LIST,                   DEFAULTS.proxyList),
    rateBurst:               readNonNeg(ENV.RATE_BURST,                DEFAULTS.rateBurst),
    rateSustain:             readNonNeg(ENV.RATE_SUSTAIN,              DEFAULTS.rateSustain),
    crawlerUa:               readStr(ENV.CRAWLER_UA,                   DEFAULTS.crawlerUa),
    sessionCheckIntervalMs:  readNonNeg(ENV.SESSION_CHECK_INTERVAL_MS, DEFAULTS.sessionCheckIntervalMs),
    cookie:                  readStr(ENV.COOKIE,                        DEFAULTS.cookie),
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

const PROXY_URL_RE = /^(?:https?:\/\/)?[^\s:@]+(:\d+)?(?::[^\s:@]+:[^\s:@]+@[^\s:@]+(:\d+)?)?$/;

/**
 * @typedef {{ valid: boolean, errors: string[], warnings: string[] }} ValidationResult
 */

/**
 * Validate scraper config. Errors make the config unusable; warnings are advisory.
 * @param {Record<string,string|undefined>} [env=process.env]
 * @returns {ValidationResult}
 */
export function validateScraperConfig(env = process.env) {
  const e = env || {};
  const errors = [];
  const warnings = [];

  const readRaw = (key) => {
    const raw = e[key];
    return raw === undefined || raw === null ? undefined : String(raw).trim();
  };

  // Helper: check that a value is a non-negative number (or absent).
  const checkNonNeg = (key, label, required) => {
    const raw = readRaw(key);
    if (raw === undefined || raw === '') {
      if (required) errors.push(`${label} (${key}) is required`);
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push(`${label} (${key}) must be a number, got "${raw}"`);
    } else if (n < 0) {
      warnings.push(`${label} (${key}) is negative (${n}); clamped to 0 at runtime`);
    }
  };

  // Helper: check probability in [0, 1]
  const checkProb = (key, label) => {
    const raw = readRaw(key);
    if (raw === undefined || raw === '') return;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      errors.push(`${label} (${key}) must be a number, got "${raw}"`);
    } else if (n < 0 || n > 1) {
      warnings.push(`${label} (${key}) is outside [0,1] (${n}); clamped at runtime`);
    }
  };

  // Numeric validations
  checkNonNeg(ENV.MIN_DELAY_MS,              'minDelayMs');
  checkNonNeg(ENV.JITTER_MS,                 'jitterMs');
  checkNonNeg(ENV.BLOCK_COOLDOWN_MS,         'blockCooldownMs');
  checkNonNeg(ENV.CACHE_TTL_MS,              'cacheTtlMs');
  checkProb(ENV.LONG_PAUSE_PROBABILITY,      'longPauseProbability');
  checkNonNeg(ENV.LONG_PAUSE_MIN_MS,         'longPauseMinMs');
  checkNonNeg(ENV.LONG_PAUSE_MAX_MS,         'longPauseMaxMs');
  checkNonNeg(ENV.PAGE_PAUSE_MIN_MS,         'pagePauseMinMs');
  checkNonNeg(ENV.PAGE_PAUSE_MAX_MS,         'pagePauseMaxMs');
  checkNonNeg(ENV.OBJECT_PAUSE_MIN_MS,       'objectPauseMinMs');
  checkNonNeg(ENV.OBJECT_PAUSE_MAX_MS,       'objectPauseMaxMs');
  checkNonNeg(ENV.REQUEST_TIMEOUT_MS,        'requestTimeoutMs');
  checkNonNeg(ENV.RATE_BURST,                'rateBurst');
  checkNonNeg(ENV.RATE_SUSTAIN,              'rateSustain');
  checkNonNeg(ENV.SESSION_CHECK_INTERVAL_MS, 'sessionCheckIntervalMs');

  // Semantic: paired min/max constraints
  const checkMinMax = (minKey, maxKey, label) => {
    const cfg = resolveScraperConfig(e);
    const min = cfg[minKey];
    const max = cfg[maxKey];
    if (min > max) {
      warnings.push(`${label}: min (${min}ms) > max (${max}ms); pauses will always use the min value`);
    }
  };
  checkMinMax('longPauseMinMs', 'longPauseMaxMs', 'longPause');
  checkMinMax('pagePauseMinMs', 'pagePauseMaxMs', 'pagePause');
  checkMinMax('objectPauseMinMs', 'objectPauseMaxMs', 'objectPause');
  // minDelay+jitter → the effective min delay between requests
  {
    const cfg = resolveScraperConfig(e);
    if (cfg.minDelayMs === 0 && cfg.jitterMs === 0 && cfg.longPauseProbability === 0) {
      warnings.push('minDelayMs, jitterMs, and longPauseProbability are all 0 — requests may fire at full speed (TokenBucket still applies)');
    }
  }

  // Proxy list format
  const proxyRaw = readRaw(ENV.PROXY_LIST);
  if (proxyRaw) {
    const entries = proxyRaw.split(',').map(s => s.trim()).filter(Boolean);
    for (const entry of entries) {
      if (!PROXY_URL_RE.test(entry)) {
        warnings.push(`Proxy entry "${entry}" may not be a valid proxy URL (expected host:port or http://user:pass@host:port)`);
      }
    }
  }

  // UA is optional — just a note if set
  const uaRaw = readRaw(ENV.CRAWLER_UA);
  if (uaRaw !== undefined && uaRaw.length > 0 && uaRaw.length < 20) {
    warnings.push(`BILIBILI_CRAWLER_UA is very short (${uaRaw.length} chars); this may not be a valid User-Agent string`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
