/**
 * Offline evidence miner — scans existing comment corpora for weak dictionary
 * terms and registers the evidence in the keyword dictionary.
 *
 * Usage:
 *   node server/scripts/mineCorpusEvidence.js [--dry-run]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(__dirname, '..', '..');
const DATA = join(PROJECT, 'server', 'data');

const CORPUS_DIRS = [
  join(DATA, 'bilibiliDirectProbeCorpus.comments'),
  join(DATA, 'huggingFaceKeywordCorpus.comments'),
];

const EVIDENCE_DIR = join(DATA, 'deepseekKeywordDictionary.evidence');
const AUDIT_PATH = join(DATA, 'keywordCoverageAudit.json');

function loadAudit() {
  return JSON.parse(readFileSync(AUDIT_PATH, 'utf8'));
}

function loadCorpora() {
  const comments = [];
  for (const dir of CORPUS_DIRS) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    console.log('[mine] Loading ' + files.length + ' files from ' + dir + '...');
    for (const file of files) {
      try {
        const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        const list = data.comments || [];
        for (const c of list) {
          if (c.message) {
            comments.push({
              text: c.message,
              source: c.source || 'Unknown',
              uid: c.uid || '',
            });
          }
        }
      } catch (e) {
        // skip corrupt files
      }
    }
  }
  return comments;
}

function mineEvidence(weakTerms, comments, dryRun) {
  const evidence = new Map(); // term -> { samples: [], sources: [] }

  for (const comment of comments) {
    const text = comment.text.toLowerCase();
    for (const term of weakTerms) {
      if (text.includes(term.toLowerCase())) {
        if (!evidence.has(term)) {
          evidence.set(term, { samples: [], sources: [] });
        }
        const entry = evidence.get(term);
        if (entry.samples.length < 20) {
          entry.samples.push(comment.text);
        }
        if (entry.sources.length < 5 && !entry.sources.includes(comment.source)) {
          entry.sources.push(comment.source);
        }
      }
    }
  }

  return evidence;
}

function loadEvidenceShards() {
  const shards = {};
  if (!existsSync(EVIDENCE_DIR)) return shards;

  const files = readdirSync(EVIDENCE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const data = JSON.parse(readFileSync(join(EVIDENCE_DIR, file), 'utf8'));
    shards[file] = data;
  }
  return shards;
}

function updateEvidence(shards, minedEvidence, audit, dryRun) {
  // Map weak terms to their families
  const termFamilies = {};
  for (const na of (audit.nextActions || [])) {
    termFamilies[na.term] = na.family || 'attack';
  }

  const updated = [];
  const newTerms = [];

  for (const [term, evidence] of minedEvidence) {
    const family = termFamilies[term] || 'attack';
    if (evidence.samples.length < 2) continue; // need at least 2 samples

    // Find the right shard (existing or create new)
    let targetShard = null;
    for (const [filename, shard] of Object.entries(shards)) {
      if (shard.family === family && Array.isArray(shard.evidence)) {
        targetShard = { filename, shard };
        break;
      }
    }

    if (!targetShard) {
      // Create new shard with evidence as an ARRAY (not object)
      const shardNum = String(Object.keys(shards).filter(k => k.startsWith(family)).length + 1).padStart(3, '0');
      const filename = family + '-' + shardNum + '.json';
      targetShard = {
        filename,
        shard: {
          version: 1,
          updatedAt: new Date().toISOString(),
          family,
          shard: shardNum,
          shardCount: 1,
          evidence: [],
        },
      };
      shards[filename] = targetShard.shard;
    }

    // Search for existing entry by term name in the evidence ARRAY
    const evidenceArr = targetShard.shard.evidence;
    const existingIdx = evidenceArr.findIndex(e => e.term === term);
    const existing = existingIdx >= 0 ? evidenceArr[existingIdx] : null;

    const existingSamples = existing ? (existing.evidenceSamples || []) : [];
    const existingSources = existing ? (existing.evidenceSources || []) : [];

    const mergedSamples = [...new Set([...existingSamples, ...evidence.samples])].slice(0, 30);
    const mergedSources = [...new Set([...existingSources, ...evidence.sources.map(s => ({ source: s }))])];

    const entry = {
      term,
      evidenceSamples: mergedSamples,
      evidenceSources: mergedSources,
    };

    if (existingIdx >= 0) {
      evidenceArr[existingIdx] = entry;
    } else {
      evidenceArr.push(entry);
    }

    targetShard.shard.updatedAt = new Date().toISOString();
    updated.push(term);
    if (!existing) newTerms.push(term);
  }

  return { shards, updated, newTerms };
}

// ── Main ──
function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('[mine] Loading coverage audit...');
  const audit = loadAudit();
  const weakTerms = new Set((audit.nextActions || []).map(na => na.term));
  console.log('[mine] Target weak terms: ' + weakTerms.size);
  console.log('[mine] Terms: ' + [...weakTerms].join(', '));

  console.log('[mine] Loading comment corpora...');
  const comments = loadCorpora();
  console.log('[mine] Total comments loaded: ' + comments.length);

  console.log('[mine] Mining evidence...');
  const evidence = mineEvidence(weakTerms, comments, dryRun);
  console.log('[mine] Terms with evidence found: ' + evidence.size);

  for (const [term, entry] of evidence) {
    console.log('  ' + term + ': ' + entry.samples.length + ' samples, ' + entry.sources.length + ' sources');
  }

  if (dryRun) {
    console.log('[mine] DRY RUN — no files written');
    return;
  }

  console.log('[mine] Loading evidence shards...');
  const shards = loadEvidenceShards();
  console.log('[mine] Existing shards: ' + Object.keys(shards).length);

  console.log('[mine] Updating evidence...');
  const { updated, newTerms } = updateEvidence(shards, evidence, audit, false);

  // Write updated shards
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const [filename, shard] of Object.entries(shards)) {
    writeFileSync(join(EVIDENCE_DIR, filename), JSON.stringify(shard, null, 2), 'utf8');
  }

  console.log('[mine] Updated ' + updated.length + ' terms, ' + newTerms.length + ' new');
  console.log('[mine] New terms: ' + newTerms.join(', '));
  console.log('[mine] Done.');
}

main();
