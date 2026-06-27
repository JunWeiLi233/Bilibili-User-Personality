/**
 * Search local corpus for zero-evidence dictionary terms.
 * Checks both commentMessages and danmakuMessages across all seed_result files.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = 'D:\\Bilibili_User_Personality';
const CORPUS_DIRS = [
    join(ROOT, '.claude', 'seed_results'),
    join(ROOT, '.claude', 'seed_results_deep'),
    join(ROOT, '.claude', 'seed_results_batch2'),
    join(ROOT, '.claude', 'seed_results_batch3'),
];
const TERMS_PATH = join(ROOT, '.claude', 'zero_evidence_terms.json');
const OUTPUT_PATH = join(ROOT, '.claude', 'corpus_evidence_results.json');

function main() {
    // Load target terms
    const targets = JSON.parse(readFileSync(TERMS_PATH, 'utf-8'));
    const targetTerms = new Set(targets.map(t => t.term));
    console.log(`Target terms: ${targetTerms.size}`);

    // Search corpus
    const matches = {};
    let totalFiles = 0;
    let totalMessages = 0;

    for (const dir of CORPUS_DIRS) {
        let files;
        try { files = readdirSync(dir).filter(f => f.endsWith('.json')); }
        catch (e) { continue; }

        for (const f of files) {
            totalFiles++;
            let data;
            try { data = JSON.parse(readFileSync(join(dir, f), 'utf-8')); }
            catch (e) { continue; }

            const videos = data.videos || [];
            for (const v of videos) {
                // Check commentMessages
                for (const cm of (v.commentMessages || [])) {
                    const msg = (cm.message || '').trim();
                    if (!msg) continue;
                    totalMessages++;
                    for (const term of targetTerms) {
                        if (msg.includes(term)) {
                            if (!matches[term]) matches[term] = [];
                            matches[term].push({
                                message: msg.substring(0, 200),
                                type: 'comment',
                                bvid: v.bvid || '',
                                title: (v.title || '').substring(0, 100),
                                file: f,
                                likes: cm.likes || 0,
                            });
                        }
                    }
                }

                // Check danmakuMessages
                for (const dm of (v.danmakuMessages || [])) {
                    const msg = (dm.message || '').trim();
                    if (!msg) continue;
                    totalMessages++;
                    for (const term of targetTerms) {
                        if (msg.includes(term)) {
                            if (!matches[term]) matches[term] = [];
                            matches[term].push({
                                message: msg.substring(0, 200),
                                type: 'danmaku',
                                bvid: v.bvid || '',
                                title: (v.title || '').substring(0, 100),
                                file: f,
                            });
                        }
                    }
                }
            }
        }
    }

    const found = Object.keys(matches).length;
    let totalMatches = 0;
    for (const v of Object.values(matches)) totalMatches += v.length;

    console.log(`Files scanned: ${totalFiles}`);
    console.log(`Messages scanned: ${totalMessages}`);
    console.log(`Terms found: ${found}/${targetTerms.size}`);
    console.log(`Total matches: ${totalMatches}`);

    // Show results per term
    for (const [term, ms] of Object.entries(matches).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${term}: ${ms.length} matches`);
    }

    // Save
    const output = {
        harvestedAt: new Date().toISOString(),
        type: 'corpus_exact_match',
        totalTerms: targetTerms.size,
        termsFound: found,
        totalMatches,
        entries: Object.entries(matches).map(([term, ms]) => ({
            term,
            totalMatches: ms.length,
            samples: ms.slice(0, 5).map(m => m.message),
            sources: ms.slice(0, 8).map(m => ({
                source: `Local corpus (${m.type}): ${m.file}`,
                uid: m.bvid || '',
                sample: m.message.substring(0, 100),
            })),
        })),
    };

    writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
    console.log(`\nOutput: ${OUTPUT_PATH}`);
}

main();
