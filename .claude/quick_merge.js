// Quick merge: append new terms from a file to the dictionary shards
import { readFileSync, writeFileSync, existsSync } from 'fs';

const [,, sourceFile] = process.argv;
if (!sourceFile) { console.error('Usage: node quick_merge.js <termsFile>'); process.exit(1); }

const batch = JSON.parse(readFileSync(sourceFile, 'utf8'));
const dict = JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json', 'utf8'));

// Existing terms
const existing = new Set();
for (const [_, files] of Object.entries(dict.entryFiles)) {
    for (const file of files) {
        try {
            const data = JSON.parse(readFileSync('server/data/' + file, 'utf8'));
            for (const t of Object.keys(data)) existing.add(t);
        } catch {}
    }
}

const newTerms = (batch.terms || []).filter(t => t.term && !existing.has(t.term));
console.log(`Source: ${sourceFile}, terms: ${(batch.terms||[]).length}, new: ${newTerms.length}`);

if (newTerms.length === 0) { console.log('No new terms to add'); process.exit(0); }

// Group by family
const groups = {};
for (const t of newTerms) {
    if (!groups[t.family]) groups[t.family] = [];
    groups[t.family].push(t);
}

const SHARD_MAX = 65536;
const updatedEntryFiles = { ...dict.entryFiles };

for (const [family, terms] of Object.entries(groups)) {
    const files = [...(updatedEntryFiles[family] || [])];
    let lastIdx = files.length - 1;
    let lastShard = {};
    let lastSize = 0;

    if (lastIdx >= 0 && existsSync('server/data/' + files[lastIdx])) {
        const raw = readFileSync('server/data/' + files[lastIdx], 'utf8');
        lastShard = JSON.parse(raw);
        lastSize = Buffer.byteLength(raw, 'utf8');
    }

    let added = 0;
    for (const term of terms) {
        const entry = {
            family: term.family,
            meaning: String(term.meaning || '').trim(),
            risk: String(term.risk || 'medium').trim(),
            confidence: Number.isFinite(Number(term.confidence)) ? Number(term.confidence) : 0.75,
            variants: [],
            evidenceSamples: [],
            evidenceSources: [],
            updatedAt: new Date().toISOString(),
        };
        const size = JSON.stringify(entry).length + 3;

        if (lastSize + size > SHARD_MAX && Object.keys(lastShard).length > 0) {
            const idx = files.length + 1;
            const name = `${family}-${String(idx).padStart(3, '0')}.json`;
            const path = `deepseekKeywordDictionary.entries/${name}`;
            writeFileSync('server/data/' + path, JSON.stringify(lastShard, null, 2), 'utf8');
            files.push(path);
            lastShard = {};
            lastSize = 0;
        }
        lastShard[term.term] = entry;
        lastSize += size;
        added++;
    }

    if (Object.keys(lastShard).length > 0) {
        const idx = files.length + 1;
        const name = `${family}-${String(idx).padStart(3, '0')}.json`;
        const path = `deepseekKeywordDictionary.entries/${name}`;
        writeFileSync('server/data/' + path, JSON.stringify(lastShard, null, 2), 'utf8');
        files.push(path);
    }

    updatedEntryFiles[family] = files;
    console.log(`  ${family}: added ${added} terms`);
}

// Write manifest (fresh read to avoid mutation issues)
const manifest = JSON.parse(readFileSync('server/data/deepseekKeywordDictionary.json', 'utf8'));
manifest.entryFiles = updatedEntryFiles;
manifest.updatedAt = new Date().toISOString();
writeFileSync('server/data/deepseekKeywordDictionary.json', JSON.stringify(manifest, null, 2), 'utf8');

// Verify
let total = 0;
const byFam = {};
for (const [family, files] of Object.entries(manifest.entryFiles)) {
    let fc = 0;
    for (const file of files) {
        const data = JSON.parse(readFileSync('server/data/' + file, 'utf8'));
        fc += Object.keys(data).length;
    }
    byFam[family] = fc;
    total += fc;
}
console.log(`Total: ${total} terms`);
console.log(`By family: ${JSON.stringify(byFam)}`);
