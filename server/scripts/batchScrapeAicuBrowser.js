import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';

const DATA_DIR = join(process.cwd(), 'server', 'data');
const USER_DB_PATH = join(DATA_DIR, 'aicu-user-database.json');
const PROGRESS_PATH = join(DATA_DIR, 'batch-scrape-aicu-browser-progress.json');

const DELAY_BETWEEN_UIDS = 5000;
const MAX_PAGES = 3;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function scrapeViaBrowser(uid) {
  try {
    const scriptPath = join(process.cwd(), 'server', 'scripts', 'browserScrapeAicu.py').replace(/\\/g, '/');
    const wrapperPath = join(process.cwd(), 'server', 'data', '_browser_aicu_tmp.py').replace(/\\/g, '/');
    const wrapper = `import sys\nsys.argv = ['browserScrapeAicu.py', '${uid}', '${MAX_PAGES}']\nexec(open('${scriptPath}').read())\n`;
    writeFileSync(wrapperPath, wrapper);
    const output = execSync(`browser-harness -c "exec(open('${wrapperPath}').read())"`, {
      encoding: 'utf8',
      timeout: 120000,
      cwd: process.cwd(),
    });
    // Find the JSON output (last line that starts with {)
    const lines = output.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].startsWith('{')) {
        return JSON.parse(lines[i]);
      }
    }
    return null;
  } catch (err) {
    console.log(`    Browser error: ${err.message.split('\n')[0]}`);
    return null;
  }
}

async function loadDatabase() {
  try { return JSON.parse(await readFile(USER_DB_PATH, 'utf8')); }
  catch { return { users: {}, lastUpdated: null }; }
}

async function saveDatabase(db) {
  await mkdir(dirname(USER_DB_PATH), { recursive: true });
  db.lastUpdated = new Date().toISOString();
  await writeFile(USER_DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function loadProgress() {
  try { return JSON.parse(await readFile(PROGRESS_PATH, 'utf8')); }
  catch { return { lastUid: 0, completed: 0, errors: [], startTime: new Date().toISOString() }; }
}

async function saveProgress(progress) {
  await mkdir(dirname(PROGRESS_PATH), { recursive: true });
  await writeFile(PROGRESS_PATH, JSON.stringify(progress, null, 2), 'utf8');
}

async function main() {
  const args = process.argv.slice(2);
  let startUid = 100000;
  let endUid = 200000;

  for (const arg of args) {
    if (arg.startsWith('--start=')) startUid = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--end=')) endUid = parseInt(arg.split('=')[1]);
  }

  const db = await loadDatabase();
  const progress = await loadProgress();

  if (progress.lastUid >= startUid) {
    startUid = progress.lastUid + 1;
  }

  console.log(`=== Browser-based AICU Scraper ===`);
  console.log(`UID range: ${startUid}-${endUid}`);
  console.log(`Database: ${Object.keys(db.users).length} users`);
  console.log(`Resume from: UID ${startUid}\n`);

  let scraped = 0;
  let skipped = 0;
  let errors = 0;

  for (let uid = startUid; uid <= endUid; uid++) {
    const uidStr = String(uid);

    if (db.users[uidStr]) {
      skipped++;
      continue;
    }

    try {
      const progressPct = ((uid - startUid) / (endUid - startUid) * 100).toFixed(1);
      console.log(`[${progressPct}%] UID ${uidStr}...`);

      const result = scrapeViaBrowser(uidStr);

      if (!result) {
        console.log(`  No data`);
        db.users[uidStr] = {
          uid: uidStr,
          commentCount: 0,
          danmakuCount: 0,
          commentText: '',
          danmakuText: '',
          combinedText: '',
          comments: [],
          danmaku: [],
          scrapedAt: new Date().toISOString(),
        };
      } else {
        const commentText = result.comments.map((c) => c.message).join('\n');
        const danmakuText = result.danmaku.map((d) => d.content).join('\n');
        const combinedText = [commentText, danmakuText].filter(Boolean).join('\n');

        db.users[uidStr] = {
          uid: uidStr,
          commentCount: result.commentCount,
          danmakuCount: result.danmakuCount,
          commentText,
          danmakuText,
          combinedText,
          comments: result.comments,
          danmaku: result.danmaku,
          scrapedAt: new Date().toISOString(),
        };

        if (result.commentCount > 0 || result.danmakuCount > 0) {
          console.log(`  ✓ ${result.commentCount} comments + ${result.danmakuCount} danmaku`);
          scraped++;
        } else {
          console.log(`  No comments or danmaku`);
        }
      }

      if ((scraped + errors) % 10 === 0) {
        await saveDatabase(db);
        progress.lastUid = uid;
        progress.completed = scraped;
        await saveProgress(progress);
      }

      progress.lastUid = uid;
      await wait(DELAY_BETWEEN_UIDS);

    } catch (err) {
      console.error(`  ✗ ${err.message}`);
      errors++;
      progress.errors.push({ uid: uidStr, error: err.message, time: new Date().toISOString() });
    }
  }

  await saveDatabase(db);
  progress.completed = scraped;
  progress.endTime = new Date().toISOString();
  await saveProgress(progress);

  console.log(`\n=== Complete ===`);
  console.log(`Scraped: ${scraped} users`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total in database: ${Object.keys(db.users).length}`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
