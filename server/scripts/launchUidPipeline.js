import { fork } from 'node:child_process';
import { join } from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const WORKER_SCRIPT = join(process.cwd(), 'server', 'scripts', 'uidPipelineWorker.js');
const MERGE_COMMAND = 'python -m python_backend.cli.uid_pipeline_merge --write-state';
const TOTAL_START = 1;
const TOTAL_END = 100000;
const WORKERS = 5;
const CHUNK_SIZE = Math.ceil((TOTAL_END - TOTAL_START + 1) / WORKERS);

const ranges = [];
for (let i = 0; i < WORKERS; i++) {
  const start = TOTAL_START + i * CHUNK_SIZE;
  const end = Math.min(start + CHUNK_SIZE - 1, TOTAL_END);
  ranges.push({ start, end });
}

const LOG_DIR = join(DATA_DIR, 'scraper-logs');
await mkdir(LOG_DIR, { recursive: true });

const children = [];

for (const range of ranges) {
  const logPath = join(LOG_DIR, `uid-pipeline-${range.start}-${range.end}.log`);
  const logStream = (await import('node:fs')).createWriteStream(logPath, { flags: 'a' });

  const child = fork(WORKER_SCRIPT, [
    `--start=${range.start}`,
    `--end=${range.end}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    cwd: process.cwd(),
    env: { ...process.env },
  });

  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  child.on('exit', (code, signal) => {
    const msg = `[${new Date().toISOString()}] Worker ${range.start}-${range.end} exited: code=${code} signal=${signal}\n`;
    logStream.write(msg);
    console.log(msg.trim());
  });

  child.on('error', (err) => {
    const msg = `[${new Date().toISOString()}] Worker ${range.start}-${range.end} error: ${err.message}\n`;
    logStream.write(msg);
    console.error(msg.trim());
  });

  children.push({ child, range, logStream });
  console.log(`Launched worker: UIDs ${range.start}-${range.end} (PID ${child.pid})`);
}

console.log(`\nAll ${children.length} workers launched. Monitoring...\n`);

// Save launcher state for monitoring
const launcherState = {
  startedAt: new Date().toISOString(),
  workers: children.map(({ range }) => ({
    start: range.start,
    end: range.end,
    progressFile: `uid-pipeline-${range.start}-${range.end}.json`,
  })),
};
await writeFile(join(DATA_DIR, 'uid-pipeline-launcher.json'), JSON.stringify(launcherState, null, 2));

// Monitor loop
const monitor = setInterval(async () => {
  const now = new Date().toISOString();
  let allDone = true;
  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalBlocked = 0;

  for (const { range } of children) {
    const progressPath = join(DATA_DIR, `uid-pipeline-${range.start}-${range.end}.json`);
    try {
      const p = JSON.parse(await readFile(progressPath, 'utf8'));
      const processed = Object.keys(p.processed).length;
      const total = range.end - range.start + 1;
      totalProcessed += processed;
      totalSuccess += p.stats?.success || 0;
      totalBlocked += p.stats?.blocked || 0;
      if (processed < total) allDone = false;
    } catch {
      allDone = false;
    }
  }

  const grandTotal = TOTAL_END - TOTAL_START + 1;
  console.log(`[${now}] Overall: ${totalProcessed}/${grandTotal} processed, ${totalSuccess} success, ${totalBlocked} blocked`);

  if (allDone) {
    clearInterval(monitor);
    console.log('\nAll workers complete! Merging results...');

    // Close log streams
    for (const { logStream } of children) logStream.end();

    // Merge results
    try {
      const { execSync } = await import('node:child_process');
      execSync(MERGE_COMMAND, { cwd: process.cwd(), stdio: 'inherit' });
    } catch (e) {
      console.error('Merge failed:', e.message);
    }

    console.log('Pipeline complete!');
    process.exit(0);
  }
}, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down workers...');
  for (const { child } of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 5000);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down workers...');
  for (const { child } of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 5000);
});
