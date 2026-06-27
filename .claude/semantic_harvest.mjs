/**
 * Semantic evidence harvest for zero-evidence dictionary terms.
 * Uses the existing semanticMatcher to find evidence from the local corpus.
 */
import { readFileSync, writeFileSync, readdirSync, readFile } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CORPUS_DIRS = [
    join(ROOT, '.claude', 'seed_results'),
    join(ROOT, '.claude', 'seed_results_deep'),
    join(ROOT, '.claude', 'seed_results_batch2'),
    join(ROOT, '.claude', 'seed_results_batch3'),
];

const THRESHOLD = 0.65; // Lower threshold to catch more matches
const MAX_COMMENTS = 50000; // Sample up to 50K comments for speed

async function loadCorpusComments() {
    const comments = [];
    for (const dir of CORPUS_DIRS) {
        try {
            const files = readdirSync(dir).filter(f => f.endsWith('.json'));
            for (const f of files) {
                try {
                    const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
                    const replies = data.replies || data.data?.replies || [];
                    for (const r of replies) {
                        const msg = r?.content?.message || r?.message || '';
                        if (msg.length > 10 && msg.length < 500) {
                            comments.push({
                                text: msg,
                                source: `Local corpus: ${f}`,
                                uid: r?.rpid || r?.rpid_str || '',
                                like: r?.like || 0,
                            });
                        }
                    }
                } catch (e) { /* skip bad files */ }
            }
        } catch (e) { /* skip missing dirs */ }
    }
    console.log(`Loaded ${comments.length} comments from corpus`);
    return comments;
}

async function main() {
    // Load target terms
    const targets = JSON.parse(readFileSync(join(ROOT, '.claude', 'zero_evidence_terms.json'), 'utf-8'));
    console.log(`Target terms: ${targets.length}`);

    // Load corpus
    const comments = await loadCorpusComments();
    if (comments.length === 0) {
        console.log('No corpus comments found.');
        return;
    }

    // Sample comments for speed
    const sample = comments.slice(0, MAX_COMMENTS);
    console.log(`Using ${sample.length} comments for matching`);

    // Simple text-based matching (exact substring)
    // This is a fast first pass — find exact matches in corpus
    const results = {};
    for (const target of targets) {
        const term = target.term;
        const matches = [];
        for (const c of sample) {
            if (c.text.includes(term)) {
                matches.push({
                    text: c.text.substring(0, 200),
                    source: c.source,
                    uid: c.uid,
                    like: c.like,
                });
            }
        }
        if (matches.length > 0) {
            results[term] = {
                term,
                family: target.family,
                totalMatches: matches.length,
                samples: matches.slice(0, 5).map(m => m.text),
                sources: matches.slice(0, 8).map(m => ({
                    source: m.source,
                    uid: m.uid,
                    sample: m.text.substring(0, 100),
                })),
            };
        }
    }

    // Output
    const found = Object.keys(results).length;
    console.log(`\nFound ${found}/${targets.length} terms in corpus`);
    for (const [term, data] of Object.entries(results)) {
        console.log(`  ${term}: ${data.totalMatches} matches`);
    }

    // Save results
    const output = {
        harvestedAt: new Date().toISOString(),
        type: 'corpus_text_match',
        totalTerms: targets.length,
        termsFound: found,
        totalMatches: Object.values(results).reduce((sum, r) => sum + r.totalMatches, 0),
        entries: Object.values(results),
    };
    writeFileSync(
        join(ROOT, '.claude', 'corpus_evidence_results.json'),
        JSON.stringify(output, null, 2)
    );
    console.log(`\nOutput: .claude/corpus_evidence_results.json`);
}

main().catch(console.error);
