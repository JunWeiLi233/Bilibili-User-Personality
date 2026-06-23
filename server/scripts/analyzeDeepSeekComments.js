import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { analyzeCommentsWithDeepSeek } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

export function parseArgs(argv = process.argv.slice(2)) {
  const payload = {};
  let file = '';
  let showHelp = false;
  let planJson = false;
  let usePythonPlan = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--plan-json') {
      planJson = true;
    } else if (arg === '--python-plan') {
      usePythonPlan = true;
    } else if (arg === '--multiagent' || arg === '--multi-agent') {
      payload.multiagent = true;
    } else if (arg.startsWith('--text=')) {
      payload.text = arg.slice('--text='.length);
    } else if (arg === '--text') {
      payload.text = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length);
    } else if (arg === '--file') {
      file = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--uid=')) {
      payload.uid = arg.slice('--uid='.length);
    } else if (arg === '--uid') {
      payload.uid = argv[index + 1] || '';
      index += 1;
    } else if (arg.startsWith('--name=')) {
      payload.name = arg.slice('--name='.length);
    } else if (arg === '--name') {
      payload.name = argv[index + 1] || '';
      index += 1;
    } else if (!arg.startsWith('-')) {
      payload.text = [payload.text, arg].filter(Boolean).join(' ');
    }
  }

  return { payload, file, showHelp, planJson, usePythonPlan };
}

export function buildPlan({ payload = {}, file = '', showHelp = false } = {}, { stdinIsTTY = process.stdin.isTTY } = {}) {
  const readsStdin = !showHelp && !file && !payload.text && !stdinIsTTY;
  const source = showHelp ? 'help' : file ? 'file' : readsStdin ? 'stdin' : 'argv';
  return {
    ok: true,
    payload,
    input: {
      source,
      file,
      readsStdin,
      showHelp,
    },
  };
}

async function runPythonCliPlan({ argv, stdinIsTTY }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-cli-plan-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    await writeFile(payloadPath, JSON.stringify({ argv, stdinIsTTY }, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'python',
      ['-m', 'python_backend.cli.deepseek_analyze_cli_plan', '--payload', payloadPath],
      { cwd: process.cwd(), maxBuffer: 10 * 1024 * 1024 },
    );
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runPlanMode(
  parsed,
  { argv = process.argv.slice(2), stdinIsTTY = process.stdin.isTTY, runPythonPlan = runPythonCliPlan } = {},
) {
  if (parsed.usePythonPlan) {
    return runPythonPlan({ argv, stdinIsTTY });
  }
  return buildPlan(parsed, { stdinIsTTY });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      text += chunk;
    });
    process.stdin.on('end', () => resolve(text));
    process.stdin.on('error', reject);
  });
}

function printHelp() {
  console.log(`Usage:
  npm run deepseek:analyze -- --text "comment text" [--multiagent]
  npm run deepseek:analyze -- --file comments.txt [--multiagent]
  Get-Content comments.txt | npm run deepseek:analyze -- --multiagent

Options:
  --multiagent        Run three specialist agents plus a merge quality-control agent.
  --text <text>       Analyze inline text.
  --file <path>       Analyze text from a UTF-8 file.
  --uid <uid>         Optional user id context.
  --name <name>       Optional user name context.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs();
  const { payload, file, showHelp, planJson } = parsed;
  if (showHelp) {
    printHelp();
    return;
  }

  if (planJson) {
    console.log(JSON.stringify(await runPlanMode(parsed, { argv }), null, 2));
    return;
  }

  if (file) {
    payload.text = await readFile(file, 'utf8');
  } else if (!payload.text && !process.stdin.isTTY) {
    payload.text = await readStdin();
  }

  const result = await analyzeCommentsWithDeepSeek(payload);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
