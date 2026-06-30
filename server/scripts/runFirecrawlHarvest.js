#!/usr/bin/env node

/**
 * Standalone Firecrawl harvest script.
 * Reads keywordCoverageActions.json and runs Firecrawl batch harvest on
 * terms needing evidence. Run with FIRECRAWL_ENABLED=1.
 *
 * Usage: node server/scripts/runFirecrawlHarvest.js
 */

import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const ACTIONS_PATH = 'server/data/keywordCoverageActions.json';

async function main() {
  let actions;
  try {
    actions = JSON.parse(await readFile(ACTIONS_PATH, 'utf8'));
  } catch {
    console.log('No keywordCoverageActions.json found. Run npm run dictionary:coverage first.');
    return;
  }

  const terms = actions
    .filter(a => a.action === 'harvest')
    .slice(0, 20)
    .map(a => a.term);

  if (!terms.length) { console.log('No harvest terms found.'); return; }
  console.log(`Firecrawl harvest: ${terms.length} terms`);

  const { stdout } = await execFileAsync('python', [
    '-c', `
import json, sys, os
os.environ["FIRECRAWL_ENABLED"] = "1"
from python_backend.scrapers.firecrawl_adapter import batch_harvest_evidence
terms = json.loads(sys.argv[1])
results = batch_harvest_evidence(terms, videos_per_term=5)
print(json.dumps(results, ensure_ascii=False))
    `, JSON.stringify(terms),
  ], { timeout: 600000, maxBuffer: 50 * 1024 * 1024 });

  const evidence = JSON.parse(stdout);
  let total = 0;
  for (const [term, items] of Object.entries(evidence)) {
    if (items.length) { console.log(`  ${term}: ${items.length} hits`); total += items.length; }
  }
  console.log(`Total: ${total} evidence hits`);
}

main().catch(err => { console.error(err); process.exit(1); });
