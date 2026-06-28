/**
 * Fuzzy semantic matching for zero-evidence terms.
 * Uses character n-gram Jaccard similarity to find near-matches
 * in the local corpus without requiring API calls.
 *
 * Catches: partial matches, typos, character variants, substrings
 * that exact matching misses.
 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = 'D:\\Bilibili_User_Personality';
const CORPUS_DIRS = [
    join(ROOT, '.claude', 'seed_results'),
    join(ROOT, '.claude', 'seed_results_deep'),
    join(ROOT, '.claude', 'seed_results_batch2'),
    join(ROOT, '.claude', 'seed_results_batch3'),
];
const TERMS_PATH = join(ROOT, '.claude', 'zero_evidence_terms.json');
const OUTPUT_PATH = join(ROOT, '.claude', 'fuzzy_evidence_results.json');
const SIMILARITY_THRESHOLD = 0.55; // Jaccard similarity threshold
const N = 2; // Bigram for Chinese (single chars are meaningless, trigrams too strict)

/**
 * Extract character n-grams from text.
 */
function ngrams(text, n = 2) {
    const chars = [...text.replace(/\s+/g, '')];
    const result = new Set();
    for (let i = 0; i <= chars.length - n; i++) {
        result.add(chars.slice(i, i + n).join(''));
    }
    return result;
}

/**
 * Jaccard similarity between two sets of n-grams.
 */
function jaccardSimilarity(term, candidate) {
    const tGrams = ngrams(term, N);
    const cGrams = ngrams(candidate, N);
    if (tGrams.size === 0 || cGrams.size === 0) return 0;

    let intersection = 0;
    for (const g of tGrams) {
        if (cGrams.has(g)) intersection++;
    }
    const union = tGrams.size + cGrams.size - intersection;
    return union > 0 ? intersection / union : 0;
}

/**
 * Check if candidate contains the term as a fuzzy substring.
 * Uses sliding window of term length over candidate.
 */
function fuzzyContains(term, candidate) {
    const termLen = [...term].length;
    const candLen = [...candidate].length;
    if (candLen < termLen) return 0;

    let bestScore = 0;
    for (let i = 0; i <= candLen - termLen; i++) {
        const window = [...candidate].slice(i, i + termLen).join('');
        const score = jaccardSimilarity(term, window);
        if (score > bestScore) bestScore = score;
    }
    return bestScore;
}

function main() {
    // Load target terms
    const targets = JSON.parse(readFileSync(TERMS_PATH, 'utf-8'));
    const targetTerms = targets.map(t => t.term);
    console.log(`Target terms: ${targetTerms.length}`);

    // Load corpus messages (only those we haven't already exact-matched)
    const messages = [];
    let totalFiles = 0;

    for (const dir of CORPUS_DIRS) {
        let files;
        try { files = readdirSync(dir).filter(f => f.endsWith('.json')); }
        catch (e) { continue; }

        for (const f of files) {
            totalFiles++;
            let data;
            try { data = JSON.parse(readFileSync(join(dir, f), 'utf-8')); }
            catch (e) { continue; }

            for (const v of (data.videos || [])) {
                // Combine comment + danmaku messages
                const allMsgs = [
                    ...(v.commentMessages || []),
                    ...(v.danmakuMessages || []),
                ];
                for (const m of allMsgs) {
                    const msg = (m.message || '').trim();
                    if (msg.length >= 4 && msg.length <= 300) {
                        messages.push({
                            message: msg,
                            bvid: v.bvid || '',
                            title: (v.title || '').substring(0, 100),
                            file: f,
                            type: m.likes !== undefined ? 'comment' : 'danmaku',
                        });
                    }
                }
            }
        }
    }

    console.log(`Files: ${totalFiles}, Messages: ${messages.length}`);

    // For each target term, find fuzzy matches
    const results = {};
    const totalTerms = targetTerms.length;

    for (let ti = 0; ti < totalTerms; ti++) {
        const term = targetTerms[ti];
        process.stdout.write(`\r[${ti+1}/${totalTerms}] ${term.substring(0, 20).padEnd(22)}`);

        const matches = [];

        // For short terms (<4 chars), check all messages
        // For longer terms, we can sample or do quick pre-filtering
        for (const m of messages) {
            const msg = m.message;

            // Quick pre-filter: must share at least some characters
            const termChars = new Set([...term]);
            let sharedChars = 0;
            for (const c of [...msg]) {
                if (termChars.has(c)) sharedChars++;
            }
            if (sharedChars < Math.max(2, term.length * 0.3)) continue;

            // Check fuzzy containment
            const score = fuzzyContains(term, msg);
            if (score >= SIMILARITY_THRESHOLD) {
                matches.push({ ...m, score });
            }
        }

        // Sort by score descending, take top 10
        matches.sort((a, b) => b.score - a.score);
        const top = matches.slice(0, 10);

        if (top.length > 0) {
            results[term] = {
                term,
                totalMatches: top.length,
                samples: top.slice(0, 5).map(m => m.message.substring(0, 200)),
                sources: top.slice(0, 8).map(m => ({
                    source: `Local corpus fuzzy match (score=${m.score.toFixed(3)}): ${m.file}`,
                    uid: m.bvid || '',
                    sample: m.message.substring(0, 100),
                })),
                topScore: top[0].score,
            };
        }
    }

    process.stdout.write('\r' + ' '.repeat(60) + '\r'); // clear line

    const found = Object.keys(results).length;
    console.log(`\nFuzzy matches found: ${found}/${totalTerms} terms`);

    // Show results
    for (const [term, data] of Object.entries(results).sort((a, b) => b[1].topScore - a[1].topScore)) {
        console.log(`  ${term}: ${data.totalMatches} matches, top score=${data.topScore.toFixed(3)}`);
        // Show a sample
        if (data.samples.length > 0) {
            console.log(`    -> "${data.samples[0].substring(0, 100)}"`);
        }
    }

    // Save
    const output = {
        harvestedAt: new Date().toISOString(),
        type: 'fuzzy_ngram_match',
        threshold: SIMILARITY_THRESHOLD,
        ngramSize: N,
        totalTerms,
        termsFound: found,
        entries: Object.values(results),
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main();
