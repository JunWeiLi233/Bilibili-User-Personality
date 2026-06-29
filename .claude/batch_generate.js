/**
 * Run multiple DeepSeek term generation batches in sequence.
 * Each batch targets specific families with different prompts.
 * Saves all terms to server/data/allGeneratedTerms.json
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const POWERSHELL = 'powershell';
const EXECUTOR = 'C:\Users\Junwei\.claude\tools\deepseek-executor.mjs';
const BRIEF_DIR = '.deepseek';
const OUT_DIR = join('.deepseek', 'batches');
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

const BATCH_CONFIGS = [
  { name: 'attack1', families: 'attack', count: 200, prompt: 'Generate 200 unique Chinese internet ATTACK/SARCASM terms. Focus on: personal insults, gatekeeping phrases, faction labels, mockery of intelligence, rhetorical attacks, gaming community insults, anime community attacks. Each term must be 2-12 Chinese characters found in Bilibili/Douyin comments. Include dialect variations, homophone insults, and emerging 2024-2026 slang. Output as JSON array with term, family:"attack", meaning, risk, confidence fields.' },
  { name: 'absolutes1', families: 'absolutes', count: 200, prompt: 'Generate 200 unique Chinese ABSOLUTE/OVERGENERALIZATION terms. Focus on: universal quantifiers, sweeping generalizations, zero-exception claims, inevitability language, exaggerated frequencies, dismissive totals. Include variations used in tech debates, political discussions, and gaming arguments. Output as JSON array with term, family:"absolutes", meaning, risk, confidence fields.' },
  { name: 'evidence1', families: 'evidence', count: 150, prompt: 'Generate 150 unique Chinese EVIDENCE/DATA terms. Focus on: requests for sources, demands for proof, data citation phrases, verification challenges, credibility attacks on sources. Include terms used in science debates, news discussions, and academic arguments. Output as JSON array with term, family:"evidence", meaning, risk, confidence fields.' },
  { name: 'evasion1', families: 'evasion', count: 150, prompt: 'Generate 150 unique Chinese EVASION/DEFLECTION terms. Focus on: burden-shifting, secret-knowledge claims, "figure it out yourself" variants, dismissive non-answers, topic changes, silence demands. Include terms from tech support, fan communities, and political discussions. Output as JSON array with term, family:"evasion", meaning, risk, confidence fields.' },
  { name: 'coop1', families: 'cooperation', count: 150, prompt: 'Generate 150 unique Chinese COOPERATION/QUALIFYING terms. Focus on: hedge phrases, concession signals, perspective markers, agreement acknowledgements, conditionals, uncertainty expressions, offers to clarify. Output as JSON array with term, family:"cooperation", meaning, risk, confidence fields.' },
  { name: 'correct1', families: 'correction', count: 150, prompt: 'Generate 150 unique Chinese CORRECTION/APOLOGY terms. Focus on: retraction phrases, self-correction markers, apology formulas, admitting error, thanking for corrections, softening previous statements. Output as JSON array with term, family:"correction", meaning, risk, confidence fields.' },
];

function extractJsonArray(text) {
  let cleaned = text.replace(/```json[^\n]*\n/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  cleaned = cleaned.slice(start, end + 1);
  // Fix truncation
  const lastComplete = cleaned.lastIndexOf('},');
  if (lastComplete !== -1) cleaned = cleaned.slice(0, lastComplete + 1) + ']';
  try { return JSON.parse(cleaned); } catch(e) {
    const objs = [];
    const re = /\{[^}]+\}/g;
    let m;
    while ((m = re.exec(cleaned)) !== null) { try { objs.push(JSON.parse(m[0])); } catch {} }
    return objs;
  }
}

async function runBatch(config) {
  // Write brief
  const brief = `# Brief: ${config.name}
Task: ${config.prompt}
Save to: server/data/generatedTerms_${config.name}.json

Each term: {"term":"...","family":"${config.families}","meaning":"...","risk":"high|medium|positive","confidence":0.7,"evidenceCount":0,"evidenceSamples":[],"evidenceSources":[]}
Output as: \`\`\`json:server/data/generatedTerms_${config.name}.json ... \`\`\`
<!-- CHANGED_FILES: server/data/generatedTerms_${config.name}.json -->`;

  const briefPath = join(BRIEF_DIR, `brief_${config.name}.md`);
  const outPath = join(OUT_DIR, `out_${config.name}.md`);
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(briefPath, brief, 'utf8');

  console.log(`  Running: ${config.name} (${config.count} ${config.families} terms)...`);

  try {
    const psCmd = `. .\set-deepseek-env.ps1; \$env:DEEPSEEK_MAX_TOKENS='16384'; node ${EXECUTOR} --brief ${briefPath} --out ${outPath} --model ${MODEL} 2>&1`;
    const { stdout } = await execFileAsync(POWERSHELL, ['-NoProfile', '-Command', psCmd], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 180000,
    });
    console.log(`    Done: ${stdout.slice(-200)}`);
  } catch (err) {
    console.log(`    Error: ${err.message}`);
    return { name: config.name, terms: [] };
  }

  // Extract terms
  const raw = await readFile(outPath, 'utf8');
  const terms = extractJsonArray(raw);
  return { name: config.name, terms };
}

async function main() {
  console.log(`=== DeepSeek Batch Term Generator ===`);
  console.log(`Batches: ${BATCH_CONFIGS.length}`);
  console.log(`Model: ${MODEL}\n`);

  const allTerms = [];
  const seen = new Set();

  for (let i = 0; i < BATCH_CONFIGS.length; i++) {
    const config = BATCH_CONFIGS[i];
    console.log(`[${i+1}/${BATCH_CONFIGS.length}] ${config.name}`);
    const result = await runBatch(config);
    console.log(`  → ${result.terms.length} terms extracted`);

    let added = 0;
    for (const t of result.terms) {
      if (!t.term || !t.family) continue;
      const key = t.term;
      if (seen.has(key)) continue;
      if (t.term.length < 2 || t.term.length > 12) continue;
      seen.add(key);
      allTerms.push({
        term: String(t.term).trim(),
        family: String(t.family).trim(),
        meaning: String(t.meaning || '').trim(),
        risk: String(t.risk || 'medium').trim(),
        confidence: Number.isFinite(Number(t.confidence)) ? Math.max(0.5, Math.min(0.95, Number(t.confidence))) : 0.75,
        evidenceCount: 0,
        evidenceSamples: [],
        evidenceSources: [],
      });
      added++;
    }
    console.log(`  → ${added} unique terms added (total: ${allTerms.length})\n`);

    if (i < BATCH_CONFIGS.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  // Final report
  const byFamily = {};
  for (const t of allTerms) byFamily[t.family] = (byFamily[t.family] || 0) + 1;

  const report = {
    generatedAt: new Date().toISOString(),
    totalTerms: allTerms.length,
    byFamily,
    terms: allTerms,
  };

  await writeFile('server/data/allGeneratedTerms_v2.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n=== Complete ===`);
  console.log(`Total unique terms: ${allTerms.length}`);
  console.log(`By family:`, byFamily);
  console.log(`Saved to: server/data/allGeneratedTerms_v2.json`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
