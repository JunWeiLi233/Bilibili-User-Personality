import { fork } from 'node:child_process';
import { join } from 'node:path';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const SCRIPT = join(process.cwd(), 'server', 'scripts', 'batchUidScrape.js');

const ranges = [
  { start: 1, end: 20000, progress: 'batch-uid-progress-1-20000.json' },
  { start: 20001, end: 40000, progress: 'batch-uid-progress-20001-40000.json' },
  { start: 40001, end: 60000, progress: 'batch-uid-progress-40001-60000.json' },
  { start: 60001, end: 80000, progress: 'batch-uid-progress-60001-80000.json' },
  { start: 80001, end: 100000, progress: 'batch-uid-progress-80001-100000.json' },
];

const LOG_DIR = join(DATA_DIR, 'scraper-logs');
await mkdir(LOG_DIR, { recursive: true });

const children = [];

for (const range of ranges) {
  const logPath = join(LOG_DIR, `scraper-${range.start}-${range.end}.log`);
  const logStream = (await import('node:fs')).createWriteStream(logPath, { flags: 'a' });

  const child = fork(SCRIPT, [
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

  for (const { range, child } of children) {
    const progressPath = join(DATA_DIR, range.progress);
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
