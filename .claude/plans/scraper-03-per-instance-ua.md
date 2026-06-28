# Scraper Plan 03 — Per-Instance User-Agent Selection

> **Status: ⚠️ PARTIALLY DONE — needs per-session rotation**

## What It Solves

Currently, `sessionUserAgent` is picked **once per process lifetime** (module-level global at line 41 of `bilibiliCrawler.js`). If the server runs for days, every single request uses the same UA string. Bilibili can correlate: same IP + same UA + different synthetic cookies = obvious scraper fingerprint.

## What's Already Done

- **UA pool expanded from 5 to 15** (lines 10–31): Chrome 123–126 (5), Firefox 124–126 (3), Edge 124–126 (3), Safari 17.x mobile (2), Safari 17.x desktop (2)
- **`BILIBILI_CRAWLER_UA` env override** exists (line 393): pins a specific UA for testing
- **`buildSecChUa()`** dynamically generates matching `sec-ch-ua` headers per browser family

## What's Missing

The UA is still a **module-level global** (`sessionUaPicked` flag on line 40, `sessionUserAgent` on line 41). It's picked once and never rotated. Two concrete problems:

1. **Same process = same UA forever**: A long-running server (hours/days) sends every request with identical UA fingerprint.
2. **No rotation on block**: When Bilibili rate-limits, the same UA hits them again after cooldown — easy to correlate.

## Implementation Plan

### Step 1: Replace module-level globals with a `SessionIdentity` class

**File:** `server/services/bilibiliCrawler.js`

Create a small class that owns UA selection and rotation:

```js
class SessionIdentity {
  #userAgent;
  #platform;
  #picked = false;

  constructor(randomFn) {
    this.#randomFn = randomFn || Math.random;
  }

  pick() {
    const envUa = String(process.env.BILIBILI_CRAWLER_UA || '').trim();
    if (envUa) {
      this.#userAgent = envUa;
      this.#platform = envUa.includes('Macintosh') || envUa.includes('iPhone') || envUa.includes('iPad') ? 'macOS' : 'Windows';
    } else {
      const idx = Math.floor(this.#randomFn() * USER_AGENTS.length);
      this.#userAgent = USER_AGENTS[idx] || USER_AGENTS[0];
      this.#platform = this.#userAgent.includes('Macintosh') || this.#userAgent.includes('iPhone') || this.#userAgent.includes('iPad') ? 'macOS' : 'Windows';
    }
    this.#picked = true;
  }

  rotate() {
    const envUa = String(process.env.BILIBILI_CRAWLER_UA || '').trim();
    if (envUa) return; // pinned — don't rotate
    const idx = Math.floor(this.#randomFn() * USER_AGENTS.length);
    this.#userAgent = USER_AGENTS[idx] || USER_AGENTS[0];
    this.#platform = this.#userAgent.includes('Macintosh') || this.#userAgent.includes('iPhone') || this.#userAgent.includes('iPad') ? 'macOS' : 'Windows';
  }

  get ua() {
    if (!this.#picked) this.pick();
    return this.#userAgent;
  }
  get platform() {
    if (!this.#picked) this.pick();
    return this.#platform;
  }
}
```

### Step 2: Replace module-level state with a lazy sessionIdentity singleton

```js
// Replace:
// let sessionUaPicked = false;
// let sessionUserAgent = USER_AGENTS[0];
// let sessionPlatform = 'Windows';

// With:
let _sessionIdentity = null;
function getSessionIdentity(randomFn) {
  if (!_sessionIdentity) _sessionIdentity = new SessionIdentity(randomFn);
  return _sessionIdentity;
}
```

### Step 3: Trigger UA rotation on block cooldown

In `applyBlockCooldown()` (~line 638), add one line:

```js
function applyBlockCooldown(config, nowFn) {
  consecutiveBlocks += 1;
  const multiplier = Math.min(2 ** (consecutiveBlocks - 1), MAX_COOLDOWN_MULTIPLIER);
  cooldownUntil = nowFn() + config.blockCooldownMs * multiplier;
  // Rotate UA on block to break IP+UA correlation
  if (_sessionIdentity) _sessionIdentity.rotate();
  // ... existing proxy rotation code
}
```

### Step 4: Update all call sites

Search for `sessionUserAgent` and `sessionPlatform` across `bilibiliCrawler.js` and replace with `getSessionIdentity(...).ua` / `getSessionIdentity(...).platform`:

- `buildHeaders()` (line 536): `sessionUserAgent` → `getSessionIdentity(randomFn).ua`
- `buildSecChUa()` (line 406): `sessionUserAgent` → parameter stays as-is (already receives ua string)
- `ensureSessionUserAgent()` (line 389): replace entire function body with `getSessionIdentity(randomFn).ua` call, or delete and inline

### Step 5: Update reset for test isolation

In `resetBilibiliRequestState()` (line 362), add:

```js
_sessionIdentity = null;
```

### Files Changed

| File | Lines Changed |
|------|--------------|
| `server/services/bilibiliCrawler.js` | ~60 lines (30 new class + 30 replace call sites) |
| `server/services/bilibiliCrawler.test.js` | ~15 lines (new tests for rotation) |

### Estimated Time

~45 minutes. This is the smallest remaining change — it's refactoring existing logic, not building new mechanics.

## Verification

```bash
# 1. UA rotates on block
node --test --test-name-pattern="rotates user agent on block" server/services/bilibiliCrawler.test.js

# 2. Multiple instances get different UAs
node --test --test-name-pattern="session identity" server/services/bilibiliCrawler.test.js

# 3. Existing tests still pass (no behavior change for single-request flow)
node --test server/services/bilibiliCrawler.test.js
```

## Interaction with Other Components

- **Token bucket** (Plan 01): UA rotation is orthogonal — token bucket controls rate, UA rotation controls fingerprint diversity.
- **Proxy rotation** (Plan 02): Combined with IP rotation, UA rotation creates a new (IP, UA) pair on each block, making correlation exponentially harder.
- **WAF early-exit** (Plan 04): UA rotation also fires on WAF blocks since they go through `applyWafCooldown` → `applyBlockCooldown`.
