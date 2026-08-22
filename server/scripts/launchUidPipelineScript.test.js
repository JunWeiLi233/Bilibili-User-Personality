import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('launchUidPipeline.js delegates final merge to Python UID pipeline merge writer', () => {
  const source = readFileSync('server/scripts/launchUidPipeline.js', 'utf8');

  assert.match(source, /python -m python_backend\.cli\.uid_pipeline_merge --write-state/);
  assert.doesNotMatch(source, /node \$\{MERGE_SCRIPT\}/);
  assert.doesNotMatch(source, /mergeUidPipelineResults\.js/);
});
