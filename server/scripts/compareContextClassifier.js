/**
 * Parity comparator for contextClassifier: JS vs Python.
 *
 * Usage:
 *   node server/scripts/compareContextClassifier.js
 *   node server/scripts/compareContextClassifier.js --json
 */

import { execFile } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

import { classifyScenario, SCENARIOS } from '../services/contextClassifier.js';

const FIXTURES = [
  '哈哈哈笑死我了',
  '你有证据吗？请提供数据来源',
  '太强了！牛逼！支持！',
  '别急，慢慢来，没关系的',
  '我太菜了，萌新一个',
  'https://www.bilibili.com/video/BV1xx411c7mD',
  '',
  '今天天气不错',
  '666，爱了爱了',
  '你说得对，但是我没有证据',
];

function runJsFixtures() {
  const results = [];
  for (const text of FIXTURES) {
    const result = classifyScenario(text);
    results.push({ text, scenario: result.scenario, confidence: result.confidence, scores: result.scores });
  }
  return { ok: true, fixtures: results, scenarios: SCENARIOS };
}

async function runPythonFixtures() {
  try {
    const { stdout } = await execFileAsync('python', ['-m', 'python_backend.cli.context_classifier', '--fixtures'], {
      cwd: PROJECT_ROOT, timeout: 30000,
    });
    const jsonStart = stdout.indexOf('{');
    return JSON.parse(jsonStart >= 0 ? stdout.slice(jsonStart) : stdout);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function main() {
  const jsonMode = process.argv.includes('--json');

  const js = runJsFixtures();
  const py = await runPythonFixtures();

  const jsFixtures = js.fixtures || [];
  const pyFixtures = py.fixtures || [];

  const mismatches = [];
  for (let i = 0; i < Math.min(jsFixtures.length, pyFixtures.length); i++) {
    const j = jsFixtures[i];
    const p = pyFixtures[i];
    if (j.scenario !== p.scenario) {
      mismatches.push({ index: i, text: j.text, js_scenario: j.scenario, py_scenario: p.scenario });
    }
  }

  const result = {
    ok: mismatches.length === 0 && js.ok && py.ok,
    jsOk: js.ok,
    pyOk: py.ok,
    jsScenarios: js.scenarios,
    pyScenarios: py.scenarios,
    fixtureCount: jsFixtures.length,
    mismatches,
    js,
    py,
  };

  if (jsonMode) {
    console.log(JSON.stringify(result));
    return;
  }

  console.log('\n=== ContextClassifier JS/Python Parity ===\n');
  console.log(`JS: ${js.ok ? 'OK' : 'FAIL'} | Python: ${py.ok ? 'OK' : 'FAIL'}`);
  console.log(`Fixtures: ${jsFixtures.length} | Mismatches: ${mismatches.length}`);

  if (mismatches.length > 0) {
    console.log('\nMismatches:');
    for (const m of mismatches) {
      console.log(`  "${m.text}": JS=${m.js_scenario} Python=${m.py_scenario}`);
    }
  }

  console.log(`\nScenarios match: ${JSON.stringify(js.scenarios) === JSON.stringify(py.scenarios) ? 'YES' : 'NO'}`);
  console.log(`Overall: ${result.ok ? '✅ PARITY' : '❌ MISMATCH'}\n`);
}

main().catch((err) => {
  console.error('Comparator error:', err);
  process.exit(1);
});
