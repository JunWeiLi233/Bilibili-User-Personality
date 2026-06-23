import { fork } from 'node:child_process';
import { join } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const SCRIPT_PATH = join(process.cwd(), 'server', 'scripts', 'batchUidScrape.js');
const SCRIPT = 'server/scripts/batchUidScrape.js';

const ranges = [
  { start: 1, end: 20000, progress: 'batch-uid-progress-1-20000.json' },
  { start: 20001, end: 40000, progress: 'batch-uid-progress-20001-40000.json' },
  { start: 40001, end: 60000, progress: 'batch-uid-progress-40001-60000.json' },
  { start: 60001, end: 80000, progress: 'batch-uid-progress-60001-80000.json' },
  { start: 80001, end: 100000, progress: 'batch-uid-progress-80001-100000.json' },
];

function parseArgs(args = process.argv.slice(2)) {
  const options = { dataDir: DATA_DIR };
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i] || '');
    if (arg === '--data-dir' && args[i + 1]) options.dataDir = String(args[++i]);
    else if (arg.startsWith('--data-dir=')) options.dataDir = arg.split('=')[1] || DATA_DIR;
  }
  return options;
}

export function buildBatchScraperLauncherPlan({ dataDir = DATA_DIR } = {}) {
  const workers = ranges.map((range) => ({
    start: range.start,
    end: range.end,
    progressFile: range.progress,
    logFile: `scraper-logs/scraper-${range.start}-${range.end}.log`,
    args: [`--start=${range.start}`, `--end=${range.end}`, `--progress=${range.progress}`],
  }));
  const totalStart = workers[0]?.start || 0;
  const totalEnd = workers.at(-1)?.end || 0;
  const totalUids = workers.reduce((total, worker) => total + worker.end - worker.start + 1, 0);

  return {
    ok: true,
    script: SCRIPT,
    logDir: join(dataDir, 'scraper-logs'),
    workers,
    summary: {
      workers: workers.length,
      totalStart,
      totalEnd,
      totalUids,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const { dataDir } = parseArgs(args);

  if (args.includes('--plan-json')) {
    console.log(JSON.stringify(buildBatchScraperLauncherPlan({ dataDir }), null, 2));
    return;
  }

  const logDir = join(dataDir, 'scraper-logs');
  await mkdir(logDir, { recursive: true });

  const children = [];

  for (const range of ranges) {
    const logPath = join(logDir, `scraper-${range.start}-${range.end}.log`);
    const logStream = (await import('node:fs')).createWriteStream(logPath, { flags: 'a' });

    const child = fork(SCRIPT_PATH, [
      `--start=${range.start}`,
      `--end=${range.end}`,
      `--progress=${range.progress}`,
    ], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      cwd: process.cwd(),
    });

    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.on('exit', (code, signal) => {
      const msg = `[${new Date().toISOString()}] Scraper ${range.start}-${range.end} exited: code=${code} signal=${signal}\n`;
      logStream.write(msg);
      console.log(msg.trim());
    });

    child.on('error', (err) => {
      const msg = `[${new Date().toISOString()}] Scraper ${range.start}-${range.end} error: ${err.message}\n`;
      logStream.write(msg);
      console.error(msg.trim());
    });

    children.push({ child, range, logStream });
    console.log(`Launched scraper: UIDs ${range.start}-${range.end} (PID ${child.pid})`);
  }

  console.log(`\nAll ${children.length} scrapers launched. Monitoring...`);

  // Monitor loop
  const monitor = setInterval(async () => {
    const now = new Date().toISOString();
    let allDone = true;

    for (const { range } of children) {
      const progressPath = join(dataDir, range.progress);
      try {
        const p = JSON.parse(await readFile(progressPath, 'utf8'));
        const processed = Object.keys(p.processed).length;
        const total = range.end - range.start + 1;
        console.log(`[${now}] ${range.start}-${range.end}: ${processed}/${total} processed (S:${p.stats.success} NC:${p.stats.noComments} E:${p.stats.errors} B:${p.stats.blocked})`);
        if (processed < total) allDone = false;
      } catch {
        console.log(`[${now}] ${range.start}-${range.end}: no progress file yet`);
        allDone = false;
      }
    }

    if (allDone) {
      clearInterval(monitor);
      console.log('\nAll scrapers complete!');
      process.exit(0);
    }
  }, 60000); // Check every 60 seconds

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down scrapers...');
    for (const { child } of children) {
      child.kill('SIGTERM');
    }
    setTimeout(() => process.exit(0), 3000);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
