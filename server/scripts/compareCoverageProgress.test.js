import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareCoverageProgress,
  compareCoverageProgressObjects,
} from './compareCoverageProgress.js';

test('compareCoverageProgressObjects reports progress contract drift', () => {
  const result = compareCoverageProgressObjects(
    {
      delta: { totalEvidenceGained: 2 },
      hasGateProgress: true,
      ignored: true,
    },
    {
      delta: { totalEvidenceGained: 0 },
      hasGateProgress: false,
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatches, [
    {
      key: 'delta',
      python: { totalEvidenceGained: 2 },
      js: { totalEvidenceGained: 0 },
    },
    {
      key: 'hasGateProgress',
      python: true,
      js: false,
    },
  ]);
  assert.deepEqual(result.python, {
    delta: { totalEvidenceGained: 2 },
    hasGateProgress: true,
  });
});

test('compareCoverageProgress compares injected JS and Python progress runners', async () => {
  const result = await compareCoverageProgress({
    payload: {
      before: { totalEvidence: 10 },
      after: { totalEvidence: 12 },
      harvestProgress: [{ evidenceGained: 2 }],
    },
    runJs: async () => ({ delta: { totalEvidenceGained: 2 }, hasGateProgress: false }),
    runPython: async () => ({ delta: { totalEvidenceGained: 2 }, hasGateProgress: false }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.fixture.payloadPath.endsWith('payload.json'), true);
});
