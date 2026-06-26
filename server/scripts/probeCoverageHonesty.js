import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { evidenceNeedlesForTerm } from '../services/deepseekKeywordTrainer.js';

function cleanText(value) {
  return String(value || '').normalize('NFKC').toLowerCase().trim();
}

function evidenceCount(entry) {
  return Math.max(0, Number(entry?.evidenceCount) || 0);
}

// Count unique evidence samples (from both evidenceSamples and evidenceSources[].sample)
function countUniqueSamples(entry) {
  const samples = new Set();
  for (const s of (entry?.evidenceSamples || [])) {
    const clean = String(s || '').trim();
    if (clean) samples.add(clean);
  }
  for (const s of (entry?.evidenceSources || [])) {
    const sample = String(s?.sample || '').trim();
    if (sample) samples.add(sample);
  }
  return samples.size;
}

// Count unique evidence sources (URLs/BVids)
function countUniqueSources(entry) {
  const sources = new Set();
  for (const s of (entry?.evidenceSources || [])) {
    const sourceText = String(s?.source || '').trim();
    if (sourceText) sources.add(sourceText);
  }
  return sources.size;
}

// Check if a sample actually contains the term or its variants
function sampleContainsTerm(sample, entry) {
  const text = cleanText(sample);
  if (!text) return false;
  const needles = evidenceNeedlesForTerm(entry.term);
  const terms = [cleanText(entry.term), ...needles.map(cleanText)].filter(t => t.length >= 2);
  return terms.some(t => text.includes(t));
}

function isContextOnlySample(sample) {
  const s = String(sample || '').trim();
  return s.startsWith('Bilibili video context:') || s.startsWith('Bilibili public video title:');
}

async function main() {
  console.log('=== Coverage Audit Honesty Probe ===\n');

  const dict = await readKeywordDictionary();
  const entries = dict.entries || [];
  console.log(`Total entries: ${entries.length}`);

  // Target evidence threshold
  const TARGET = 3;

  // Find issues
  const issues = {
    evidenceCountGtSamples: [],      // evidenceCount > actual unique samples
    evidenceCountZeroSamples: [],    // evidenceCount > 0 but no samples at all
    noSourceBacked: [],              // has evidence but no source URLs
    contextOnly: [],                 // all evidence is video titles/context
    termNotInSamples: [],            // samples don't contain the term
    weakEvidenceCount: [],           // evidenceCount < 3
    zeroEvidence: [],                // evidenceCount == 0
    samplesVsCountGap: [],           // evidenceCount differs from sample count
  };

  const stats = {
    totalEvidenceCount: 0,
    totalUniqueSamples: 0,
    totalUniqueSources: 0,
    entriesWithSourceBacked: 0,
    entriesWithCommentSamples: 0,
  };

  for (const entry of entries) {
    const ec = evidenceCount(entry);
    const sampleCount = countUniqueSamples(entry);
    const sourceCount = countUniqueSources(entry);

    stats.totalEvidenceCount += ec;
    stats.totalUniqueSamples += sampleCount;
    stats.totalUniqueSources += sourceCount;

    if (sourceCount > 0) stats.entriesWithSourceBacked++;

    // Check if any sample is a comment (not context-only)
    const hasCommentSample = (entry.evidenceSamples || []).some(s => !isContextOnlySample(s)) ||
      (entry.evidenceSources || []).some(s => !isContextOnlySample(s?.sample));
    if (hasCommentSample) stats.entriesWithCommentSamples++;

    // ISSUE 1: evidenceCount exceeds actual unique samples
    if (ec > sampleCount && sampleCount > 0) {
      issues.evidenceCountGtSamples.push({
        term: entry.term, family: entry.family,
        evidenceCount: ec, actualSamples: sampleCount,
        gap: ec - sampleCount,
      });
    }

    // ISSUE 2: evidenceCount > 0 but zero samples
    if (ec > 0 && sampleCount === 0) {
      issues.evidenceCountZeroSamples.push({
        term: entry.term, family: entry.family,
        evidenceCount: ec,
      });
    }

    // ISSUE 3: has evidence but no source URLs
    if (ec > 0 && sourceCount === 0) {
      issues.noSourceBacked.push({
        term: entry.term, family: entry.family,
        evidenceCount: ec,
      });
    }

    // ISSUE 4: all evidence is context-only (video titles)
    if (ec > 0 && !hasCommentSample) {
      issues.contextOnly.push({
        term: entry.term, family: entry.family,
        evidenceCount: ec,
        sampleCount,
        samplePreview: (entry.evidenceSamples || []).slice(0, 2),
      });
    }

    // ISSUE 5: samples don't contain the term
    if (sampleCount > 0) {
      const allSamples = [
        ...(entry.evidenceSamples || []),
        ...(entry.evidenceSources || []).map(s => s?.sample).filter(Boolean),
      ];
      const mismatches = allSamples.filter(s => !isContextOnlySample(s) && !sampleContainsTerm(s, entry));
      if (mismatches.length > 0) {
        issues.termNotInSamples.push({
          term: entry.term, family: entry.family,
          mismatchCount: mismatches.length,
          totalSamples: allSamples.length,
          examples: mismatches.slice(0, 3),
        });
      }
    }

    // ISSUE 6: evidenceCount < TARGET
    if (ec < TARGET) {
      issues.weakEvidenceCount.push({
        term: entry.term, family: entry.family,
        evidenceCount: ec, sampleCount,
      });
    }

    // ISSUE 7: zero evidence
    if (ec === 0) {
      issues.zeroEvidence.push({ term: entry.term, family: entry.family });
    }

    // ISSUE 8: gap between evidenceCount and sample count
    if (ec !== sampleCount) {
      issues.samplesVsCountGap.push({
        term: entry.term, family: entry.family,
        evidenceCount: ec, sampleCount,
        gap: ec - sampleCount,
      });
    }
  }

  // === RESULTS ===

  console.log('=== Summary Statistics ===');
  console.log(`Total evidenceCount sum:  ${stats.totalEvidenceCount.toLocaleString()}`);
  console.log(`Total unique samples:     ${stats.totalUniqueSamples.toLocaleString()}`);
  console.log(`Total unique sources:     ${stats.totalUniqueSources.toLocaleString()}`);
  console.log(`Avg evidenceCount/entry:  ${(stats.totalEvidenceCount / entries.length).toFixed(2)}`);
  console.log(`Avg samples/entry:        ${(stats.totalUniqueSamples / entries.length).toFixed(2)}`);
  console.log(`Source-backed entries:    ${stats.entriesWithSourceBacked}/${entries.length} (${(stats.entriesWithSourceBacked/entries.length*100).toFixed(1)}%)`);
  console.log(`Comment-sample entries:   ${stats.entriesWithCommentSamples}/${entries.length} (${(stats.entriesWithCommentSamples/entries.length*100).toFixed(1)}%)`);

  console.log('\n=== Issues Found ===');

  const printIssue = (label, list, limit = 15) => {
    console.log(`\n${label}: ${list.length} entries`);
    if (list.length === 0) {
      console.log('  ✓ None');
      return;
    }
    for (const item of list.slice(0, limit)) {
      console.log(`  - [${item.family}] ${item.term}: evidenceCount=${item.evidenceCount ?? '?'}, samples=${item.sampleCount ?? item.actualSamples ?? '?'}${item.gap ? ` (gap: ${item.gap})` : ''}${item.examples ? ` e.g. "${String(item.examples[0]).slice(0,60)}"` : ''}`);
    }
    if (list.length > limit) console.log(`  ... and ${list.length - limit} more`);
  };

  printIssue('evidenceCount > actual unique samples', issues.evidenceCountGtSamples);
  printIssue('evidenceCount > 0 but zero samples', issues.evidenceCountZeroSamples);
  printIssue('Has evidence but no source URLs', issues.noSourceBacked);
  printIssue('All evidence is context-only (titles)', issues.contextOnly);
  printIssue('Samples not containing the term', issues.termNotInSamples);
  printIssue('evidenceCount differs from sample count', issues.samplesVsCountGap, 10);
  printIssue('Weak evidence (< 3)', issues.weakEvidenceCount);
  printIssue('Zero evidence', issues.zeroEvidence);

  // Honesty grade
  console.log('\n=== Honesty Assessment ===');
  const severityScores = {
    evidenceCountZeroSamples: 5,    // Most severe: claims evidence but has none
    contextOnly: 4,                  // Claims evidence but only context
    noSourceBacked: 3,              // No source attribution
    evidenceCountGtSamples: 2,      // Count inflated
    termNotInSamples: 2,            // Weak evidence match
    samplesVsCountGap: 1,           // Minor miscount
  };

  let totalSeverity = 0;
  for (const [key, weight] of Object.entries(severityScores)) {
    totalSeverity += (issues[key]?.length || 0) * weight;
  }

  const criticalIssues = issues.evidenceCountZeroSamples.length + issues.contextOnly.length;
  const moderateIssues = issues.noSourceBacked.length + issues.evidenceCountGtSamples.length + issues.termNotInSamples.length;
  const minorIssues = issues.samplesVsCountGap.length;

  console.log(`Critical issues (zero samples / context-only): ${criticalIssues}`);
  console.log(`Moderate issues (no source / inflated / weak match): ${moderateIssues}`);
  console.log(`Minor issues (count mismatch): ${minorIssues}`);

  if (criticalIssues === 0 && moderateIssues === 0) {
    console.log('\n✓ VERDICT: Coverage ratio is HONEST.');
    console.log('  All evidenceCount values are backed by real evidence samples.');
    console.log('  The 100% coverage at targetEvidence=3 is legitimate.');
  } else if (criticalIssues === 0 && moderateIssues <= 5) {
    console.log(`\n⚠ VERDICT: Coverage ratio is MOSTLY HONEST (${moderateIssues} minor concerns).`);
  } else if (criticalIssues > 0) {
    console.log(`\n✗ VERDICT: Coverage ratio has HONESTY ISSUES (${criticalIssues} critical problems).`);
  } else {
    console.log(`\n⚠ VERDICT: Coverage ratio needs review (${moderateIssues} moderate issues).`);
  }

  // Evidence distribution
  console.log('\n=== Evidence Count Distribution ===');
  const dist = {};
  for (const entry of entries) {
    const ec = evidenceCount(entry);
    const bucket = ec >= 10 ? '10+' : String(ec);
    dist[bucket] = (dist[bucket] || 0) + 1;
  }
  for (const [bucket, count] of Object.entries(dist).sort((a, b) => {
    const an = a[0] === '10+' ? 10 : Number(a[0]);
    const bn = b[0] === '10+' ? 10 : Number(b[0]);
    return an - bn;
  })) {
    const bar = '█'.repeat(Math.round(count / entries.length * 100));
    console.log(`  evidenceCount=${bucket.toString().padStart(3)}: ${String(count).padStart(4)} entries ${bar}`);
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
