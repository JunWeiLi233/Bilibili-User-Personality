import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { analyzeCommentsWithDeepSeek, normalizeDeepSeekAnalysisResult } from '../services/deepseekKeywordTrainer.js';

const execFileAsync = promisify(execFile);

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const payload = {};
  let file = '';
  let showHelp = false;
  let planJson = false;
  let usePythonPlan = false;
  let useJsPlan = false;
  let fixtureAnalysis = '';
  let usePythonFixture = false;
  let useJsFixture = false;
  let mockChatAnalysis = '';
  let usePythonRuntime = false;
  let useJsRuntime = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--plan-json') {
      planJson = true;
    } else if (arg === '--python-plan') {
      usePythonPlan = true;
    } else if (arg === '--js-plan') {
      useJsPlan = true;
    } else if (arg.startsWith('--fixture-analysis=')) {
      fixtureAnalysis = arg.slice('--fixture-analysis='.length);
    } else if (arg === '--fixture-analysis') {
      fixtureAnalysis = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--python-fixture') {
      usePythonFixture = true;
    } else if (arg === '--js-fixture') {
      useJsFixture = true;
    } else if (arg === '--python-runtime') {
      usePythonRuntime = true;
    } else if (arg === '--js-runtime') {
      useJsRuntime = true;
    } else if (arg.startsWith('--mock-chat-analysis=')) {
      mockChatAnalysis = arg.slice('--mock-chat-analysis='.length);
    } else if (arg === '--mock-chat-analysis') {
      mockChatAnalysis = argv[index + 1] || '';
      index += 1;
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

  if (planJson && !useJsPlan) {
    usePythonPlan = true;
  }
  if (fixtureAnalysis && !useJsFixture) {
    usePythonFixture = true;
  }
  if (mockChatAnalysis && !useJsRuntime) {
    usePythonRuntime = true;
  }
  if (env.BILIBILI_DEEPSEEK_ANALYZE_USE_PYTHON_RUNTIME === '1' && !useJsRuntime) {
    usePythonRuntime = true;
  }

  return {
    payload,
    file,
    showHelp,
    planJson,
    usePythonPlan,
    useJsPlan,
    fixtureAnalysis,
    usePythonFixture,
    useJsFixture,
    mockChatAnalysis,
    usePythonRuntime,
    useJsRuntime,
  };
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
  if (parsed.usePythonPlan && !parsed.useJsPlan) {
    return runPythonPlan({ argv, stdinIsTTY });
  }
  return buildPlan(parsed, { stdinIsTTY });
}

export async function readAnalysisFixtureJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

async function runPythonFixtureAnalysis({ payload, analysis }) {
  const tempDir = await mkdtemp(join(tmpdir(), 'deepseek-fixture-analysis-'));
  try {
    const payloadPath = join(tempDir, 'payload.json');
    const analysisPath = join(tempDir, 'analysis.json');
    await writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8');
    await writeFile(analysisPath, JSON.stringify(analysis, null, 2), 'utf8');
    const { stdout } = await execFileAsync(
      'python',
      [
        '-m',
        'python_backend.cli.deepseek_analysis_normalize',
        '--payload',
        payloadPath,
        '--analysis',
        analysisPath,
        '--provider',
        'deepseek',
        '--model',
        'deepseek-v4-flash',
        '--reasoning-effort',
        'max',
        '--raw',
        JSON.stringify(analysis),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function runFixtureAnalysisMode(
  parsed,
  {
    readAnalysis = readAnalysisFixtureJson,
    runPythonFixture = runPythonFixtureAnalysis,
    normalizeJs = normalizeDeepSeekAnalysisResult,
  } = {},
) {
  const analysis = await readAnalysis(parsed.fixtureAnalysis);
  if (parsed.usePythonFixture && !parsed.useJsFixture) {
    return runPythonFixture({ payload: parsed.payload, analysis });
  }
  const parsedAnalysis = analysis?.parsed && typeof analysis.parsed === 'object' ? analysis.parsed : analysis;
  return normalizeJs({
    parsed: parsedAnalysis,
    payload: parsed.payload,
    config: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'max' },
    raw: JSON.stringify(analysis),
    retriedCompactPrompt: false,
  });
}

async function runPythonRuntimeAnalysis({ payload, mockChatAnalysis = '' }) {
  const args = ['-m', 'python_backend.cli.deepseek_analyze'];
  if (payload.text) args.push('--text', payload.text);
  if (payload.uid) args.push('--uid', payload.uid);
  if (payload.name) args.push('--name', payload.name);
  if (payload.multiagent) args.push('--multiagent');
  if (mockChatAnalysis) args.push('--mock-chat-analysis', mockChatAnalysis);
  const { stdout } = await execFileAsync('python', args, {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

export async function runLiveAnalysisMode(
  parsed,
  { runPythonRuntime = runPythonRuntimeAnalysis, analyzeJs = analyzeCommentsWithDeepSeek } = {},
) {
  if (parsed.usePythonRuntime && !parsed.useJsRuntime) {
    return runPythonRuntime({ payload: parsed.payload, mockChatAnalysis: parsed.mockChatAnalysis || '' });
  }
  return analyzeJs(parsed.payload);
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
  --mock-chat-analysis <path>
                      Run the Python-owned chat runtime against a local analysis JSON without calling DeepSeek.
  --python-runtime    Run the Python-owned live analyzer runtime.
  --js-runtime        Use the legacy JS live analyzer runtime.
  --fixture-analysis <path>
                      Normalize a saved analysis JSON through the Python contract without calling DeepSeek.
  --uid <uid>         Optional user id context.
  --name <name>       Optional user name context.`);
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs();
  const { payload, file, showHelp, planJson, fixtureAnalysis } = parsed;
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

  if (fixtureAnalysis) {
    const result = await runFixtureAnalysisMode(parsed);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    return;
  }

  const result = await runLiveAnalysisMode(parsed);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
