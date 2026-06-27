/**
 * Fast fuzzy semantic matching for zero-evidence terms.
 * Uses character overlap + sequence similarity to find near-matches
 * in the local corpus. Catches variants, partial matches, and typos.
 *
 * Approach:
 * 1. Pre-filter: candidate must share >= 50% of term's unique characters
 * 2. Score: Jaccard on character bigrams (fast)
 * 3. Only checks messages that pass pre-filter
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
const THRESHOLD = 0.45; // Lower threshold for fuzzy matching
const SAMPLE_SIZE = 100000; // Sample 100K messages for speed

/**
 * Character bigram Jaccard similarity.
 */
function charBigramSimilarity(a, b) {
    const getBigrams = (s) => {
        const chars = [...s.replace(/\s+/g, '')];
        const bigrams = new Set();
        for (let i = 0; i < chars.length - 1; i++) {
            bigrams.add(chars[i] + chars[i + 1]);
        }
        return bigrams;
    };

    const aGrams = getBigrams(a);
    const bGrams = getBigrams(b);
    if (aGrams.size === 0 || bGrams.size === 0) return 0;

    let intersect = 0;
    for (const g of aGrams) {
        if (bGrams.has(g)) intersect++;
    }
    const union = aGrams.size + bGrams.size - intersect;
    return intersect / union;
}

/**
 * Character set overlap ratio.
 */
function charOverlapRatio(term, candidate) {
    const termChars = new Set([...term]);
    let shared = 0;
    for (const c of [...candidate]) {
        if (termChars.has(c)) shared++;
    }
    return shared / termChars.size;
}

/**
 * Longest common subsequence ratio (order similarity).
 */
function lcsRatio(term, candidate) {
    const t = [...term];
    const c = [...candidate];
    // Simple DP for short terms only (terms are typically < 20 chars)
    if (t.length > 20 || c.length > 50) return charOverlapRatio(term, candidate);

    const dp = Array(t.length + 1).fill(null).map(() => Array(c.length + 1).fill(0));
    for (let i = 1; i <= t.length; i++) {
        for (let j = 1; j <= c.length; j++) {
            if (t[i-1] === c[j-1]) {
                dp[i][j] = dp[i-1][j-1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i-1][j], dp[i][j-1]);
            }
        }
    }
    return dp[t.length][c.length] / t.length;
}

function main() {
    // Load targets
    const targets = JSON.parse(readFileSync(TERMS_PATH, 'utf-8'));
    console.log(`Target terms: ${targets.length}`);

    // Load and sample corpus messages
    const messages = [];
    for (const dir of CORPUS_DIRS) {
        let files;
        try { files = readdirSync(dir).filter(f => f.endsWith('.json')); }
        catch (e) { continue; }

        for (const f of files) {
            let data;
            try { data = JSON.parse(readFileSync(join(dir, f), 'utf-8')); }
            catch (e) { continue; }

            for (const v of (data.videos || [])) {
                for (const m of (v.commentMessages || [])) {
                    const msg = (m.message || '').trim();
                    if (msg.length >= 4 && msg.length <= 300) {
                        messages.push({ message: msg, bvid: v.bvid || '', file: f });
                        if (messages.length >= SAMPLE_SIZE) break;
                    }
                }
                if (messages.length >= SAMPLE_SIZE) break;
                for (const m of (v.danmakuMessages || [])) {
                    const msg = (m.message || '').trim();
                    if (msg.length >= 4 && msg.length <= 200) {
                        messages.push({ message: msg, bvid: v.bvid || '', file: f });
                        if (messages.length >= SAMPLE_SIZE) break;
                    }
                }
                if (messages.length >= SAMPLE_SIZE) break;
            }
            if (messages.length >= SAMPLE_SIZE) break;
        }
        if (messages.length >= SAMPLE_SIZE) break;
    }

    console.log(`Sampled ${messages.length} messages`);

    // For each term, find fuzzy matches
    const results = {};
    const total = targets.length;

    for (let ti = 0; ti < total; ti++) {
        const term = targets[ti].term;
        process.stdout.write(`\r[${ti+1}/${total}] ${term.substring(0, 22).padEnd(24)}`);

        // Skip very short terms (single chars) — too many false positives
        if ([...term].length <= 1) continue;

        const candidates = [];

        for (const m of messages) {
            const msg = m.message;

            // Pre-filter: must share at least 50% of term's unique characters
            const overlap = charOverlapRatio(term, msg);
            if (overlap < 0.5) continue;

            // Compute combined similarity score
            const bigramScore = charBigramSimilarity(term, msg);
            const lcsScore = lcsRatio(term, msg);

            // Combined score: weight bigrams (exact phrase) and LCS (order)
            const score = bigramScore * 0.6 + lcsScore * 0.4;

            if (score >= THRESHOLD) {
                candidates.push({ ...m, score, bigramScore, lcsScore });
            }
        }

        // Sort by score descending
        candidates.sort((a, b) => b.score - a.score);
        const top = candidates.slice(0, 10);

        if (top.length > 0) {
            results[term] = {
                term,
                totalMatches: top.length,
                samples: top.slice(0, 5).map(m => m.message.substring(0, 200)),
                sources: top.slice(0, 8).map(m => ({
                    source: `Local corpus fuzzy semantic match (score=${m.score.toFixed(3)}, bigram=${m.bigramScore.toFixed(2)}, lcs=${m.lcsScore.toFixed(2)}): ${m.file}`,
                    uid: m.bvid || '',
                    sample: m.message.substring(0, 100),
                })),
                topMatch: { message: top[0].message.substring(0, 150), score: top[0].score },
            };
        }
    }

    process.stdout.write('\r' + ' '.repeat(60) + '\r');

    const found = Object.keys(results).length;
    console.log(`\nFuzzy semantic matches found: ${found}/${total} terms`);

    for (const [term, data] of Object.entries(results).sort((a, b) => b[1].topMatch.score - a[1].topMatch.score)) {
        console.log(`  ${term}: score=${data.topMatch.score.toFixed(3)} -> "${data.topMatch.message.substring(0, 80)}"`);
    }

    // Save
    const output = {
        harvestedAt: new Date().toISOString(),
        type: 'fuzzy_semantic_match',
        threshold: THRESHOLD,
        sampleSize: messages.length,
        totalTerms: total,
        termsFound: found,
        entries: Object.values(results),
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main();
