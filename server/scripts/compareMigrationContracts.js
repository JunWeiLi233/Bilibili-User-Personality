/**
 * Unified parity comparator: verifies all 4 migration candidate Python contracts.
 * Runs both JS and Python implementations for each contract, compares JSON outputs.
 *
 * Usage:
 *   node server/scripts/compareMigrationContracts.js          # all contracts
 *   node server/scripts/compareMigrationContracts.js --json   # JSON output
 *   node server/scripts/compareMigrationContracts.js --contract honesty  # single contract
 */

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

const CONTRACTS = {
  harvestAllSeedCorpus: {
    js: { cmd: 'node', args: ['server/scripts/harvestAllSeedCorpus.js'] },
    py: { cmd: 'python', args: ['-m', 'python_backend.cli.harvest_all_seed_corpus', '--dry-run'] },
    compareKeys: ['ok', 'sourceFiles', 'totalComments', 'totalDanmaku', 'totalMessages'],
  },
  harvestSeedCorpusEvidence: {
    js: { cmd: 'node', args: ['server/scripts/harvestSeedCorpusEvidence.js'] },
    py: { cmd: 'python', args: ['-m', 'python_backend.cli.harvest_seed_corpus_evidence', '--json'] },
    compareKeys: ['ok', 'seeds', 'totalComments', 'totalDanmaku', 'totalMessages'],
  },
  probeCoverageHonesty: {
    js: { cmd: 'node', args: ['server/scripts/probeCoverageHonesty.js'] },
    py: { cmd: 'python', args: ['-m', 'python_backend.cli.coverage_honesty_probe', '--json'] },
    compareKeys: ['ok', 'totalEntries', 'verdict', 'criticalIssues', 'moderateIssues', 'minorIssues'],
  },
  deepBatchScraper: {
    js: { cmd: 'node', args: ['server/scripts/deepBatchScraper.js', '1'] },
    py: { cmd: 'python', args: ['-m', 'python_backend.cli.deep_batch_scraper', '--round', '1', '--dry-run'] },
    compareKeys: ['ok', 'round'],
  },
};

function summarize(result = {}, keys = []) {
  const out = {};
  for (const key of keys) {
    if (key in result) out[key] = result[key];
  }
  return out;
}

async function runContract(name, config) {
  const result = { name, js: null, py: null, parity: false, error: null };

  try {
    const { stdout: jsOut } = await execFileAsync(config.js.cmd, config.js.args, {
      cwd: PROJECT_ROOT, timeout: 120000,
    });
    try {
      result.js = JSON.parse(jsOut);
    } catch {
      // JS scripts may output text, treat non-JSON as success if exit=0
      result.js = { ok: true, note: 'js-text-output' };
    }
  } catch (e) {
    result.error = `JS: ${e.message}`;
  }

  try {
    const { stdout: pyOut } = await execFileAsync(config.py.cmd, config.py.args, {
      cwd: PROJECT_ROOT, timeout: 120000,
    });
    result.py = JSON.parse(pyOut);
  } catch (e) {
    result.error = (result.error ? result.error + '; ' : '') + `Python: ${e.message}`;
  }

  if (result.js && result.py) {
    const jsSum = summarize(result.js, config.compareKeys);
    const pySum = summarize(result.py, config.compareKeys);
    result.parity = JSON.stringify(jsSum) === JSON.stringify(pySum);
    if (!result.parity) {
      result.jsSummary = jsSum;
      result.pySummary = pySum;
    }
  }

  return result;
}

async function main() {
  const jsonMode = process.argv.includes('--json');
  const contractArg = process.argv.includes('--contract')
    ? process.argv[process.argv.indexOf('--contract') + 1]
    : null;

  const targets = contractArg && CONTRACTS[contractArg]
    ? { [contractArg]: CONTRACTS[contractArg] }
    : CONTRACTS;

  const results = [];
  for (const [name, config] of Object.entries(targets)) {
    if (!jsonMode) console.log(`Testing ${name}...`);
    const r = await runContract(name, config);
    results.push(r);
    if (!jsonMode) {
      console.log(`  ${r.parity ? 'PASS' : 'FAIL'}${r.error ? ` (${r.error})` : ''}`);
    }
  }

  const allPass = results.every(r => r.parity);
  const allRan = results.every(r => r.js !== null && r.py !== null);
  const report = {
    ok: allRan,
    parityVerified: allPass,
    generatedAt: new Date().toISOString(),
    contracts: results.map(r => ({
      name: r.name,
      parity: r.parity,
      error: r.error || null,
    })),
  };

  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nOverall: ${allPass ? 'ALL PASS' : 'SOME FAIL'}`);
    console.log(`Parity verified: ${allPass}`);
    if (!allRan) console.log('Note: Some contracts could not run both sides (expected for dry-run scraper)');
  }

  const reportPath = join(__dirname, '..', 'data', 'migrationContractComparison.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Exit 0 if all contracts that could run passed parity
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
