/**
 * Merge browser-harness Tieba harvest results into tiebaKeywordCorpus.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HARVEST_DIR = '.claude/tieba_scrape';
const CORPUS_DIR = 'server/data/tiebaKeywordCorpus.comments';
const CORPUS_INDEX = 'server/data/tiebaKeywordCorpus.json';

// Load harvest results
const files = readdirSync(HARVEST_DIR).filter(f => f.endsWith('.json') && f !== '_final.json');

const newComments = [];
for (const file of files) {
  const data = JSON.parse(readFileSync(join(HARVEST_DIR, file), 'utf8'));
  for (const c of (data.comments || [])) {
    // Extract thread URL
    const threadUrl = c.thread_url || c.source || '';
    const threadId = (threadUrl.match(/\/p\/(\d+)/) || [])[1] || 'unknown';

    newComments.push({
      sourceKind: 'tieba-browser-harvest',
      sourceTitle: data.term || '',
      sourceUrl: threadUrl,
      rpid: `tieba-bh-${data.term}-${threadId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      like: 0,
      ctime: new Date().toISOString(),
      uname: '',
      mid: '',
      message: c.text || '',
      platform: 'tieba',
      matchedTerm: data.term,
    });
  }
}

console.log(`Harvest files: ${files.length}`);
console.log(`New comments to merge: ${newComments.length}`);

if (newComments.length === 0) {
  console.log('No new comments to merge.');
  process.exit(0);
}

// Read existing comments shard
const shardPath = join(CORPUS_DIR, 'comments-0001.json');
const shard = JSON.parse(readFileSync(shardPath, 'utf8'));

const existingMessages = new Set(shard.comments.map(c => c.message));
const deduped = newComments.filter(c => !existingMessages.has(c.message));

console.log(`After dedup: ${deduped.length} new (${newComments.length - deduped.length} duplicates)`);

// Append
shard.comments.push(...deduped);
shard.updatedAt = new Date().toISOString();
writeFileSync(shardPath, JSON.stringify(shard, null, 2), 'utf8');

// Update index
const index = JSON.parse(readFileSync(CORPUS_INDEX, 'utf8'));
index.commentCount = shard.comments.length;
index.updatedAt = new Date().toISOString();
writeFileSync(CORPUS_INDEX, JSON.stringify(index, null, 2), 'utf8');

console.log(`\nCorpus updated: ${shard.comments.length} total comments (was ${shard.comments.length - deduped.length})`);
console.log('Done.');
