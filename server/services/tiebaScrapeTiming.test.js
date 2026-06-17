import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTiebaScrapeHardStopMs } from './tiebaScrapeTiming.js';

test('computeTiebaScrapeHardStopMs includes one block cooldown budget per query', () => {
  assert.equal(
    computeTiebaScrapeHardStopMs({
      maxQueries: 4,
      overallTimeoutMs: 30000,
      blockCooldownMs: 120000,
    }),
    610000,
  );
});
