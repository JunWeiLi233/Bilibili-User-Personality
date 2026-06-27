/**
 * Personality analysis for 5 users from AICU database + browser-harness cross-validation.
 *
 * Usage: node .claude/analyze_db_users.js
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().normalize('NFKC').toLowerCase();
}

function buildNeedleSet(entry = {}) {
  const needles = [];
  if (entry.term) needles.push(normalizeText(entry.term));
  for (const alias of (Array.isArray(entry.aliases) ? entry.aliases : [])) {
    needles.push(normalizeText(alias));
  }
  for (const ex of (Array.isArray(entry.examples) ? entry.examples : [])) {
    needles.push(normalizeText(ex));
  }
  return needles.filter(n => n.length >= 2);
}

function extractMessages(user) {
  const messages = [];
  // From comments array
  for (const c of (Array.isArray(user.comments) ? user.comments : [])) {
    const text = normalizeText(c.message || '');
    if (text.length > 0) {
      messages.push({ text: text.slice(0, 300), time: c.time || 0, source: 'comment' });
    }
  }
  // From danmaku array
  for (const d of (Array.isArray(user.danmaku) ? user.danmaku : [])) {
    const text = normalizeText(d.content || d.message || '');
    if (text.length > 0) {
      messages.push({ text: text.slice(0, 300), time: d.time || d.ctime || 0, source: 'danmaku' });
    }
  }
  // From commentText/danmakuText (fallback: split by newlines)
  if (messages.length === 0) {
    const raw = user.commentText || user.combinedText || '';
    const lines = raw.split(/\r?\n/).map(normalizeText).filter(t => t.length > 1);
    for (const line of lines) {
      messages.push({ text: line.slice(0, 300), time: 0, source: 'text' });
    }
    for (const d of (user.danmakuText || '').split(/\r?\n/).map(normalizeText).filter(t => t.length > 1)) {
      messages.push({ text: d.slice(0, 300), time: 0, source: 'danmaku-text' });
    }
  }
  return messages;
}

function analyzeUser(user, dictionary) {
  const entries = Array.isArray(dictionary.entries) ? dictionary.entries : [];
  const messages = extractMessages(user);
  const allMatches = [];

  for (const entry of entries) {
    const needles = buildNeedleSet(entry);
    const matchedSamples = [];

    for (const msg of messages) {
      if (needles.some(needle => msg.text.includes(needle))) {
        matchedSamples.push({ text: msg.text.slice(0, 200), time: msg.time });
      }
    }

    if (matchedSamples.length > 0) {
      allMatches.push({
        term: entry.term,
        family: entry.family || 'unknown',
        meaning: entry.meaning || '',
        risk: entry.risk || 'neutral',
        matchCount: matchedSamples.length,
        samples: matchedSamples.slice(0, 3),
      });
    }
  }

  // Aggregate by family
  const familyCounts = {};
  for (const m of allMatches) {
    familyCounts[m.family] = (familyCounts[m.family] || 0) + m.matchCount;
  }

  const axes = {
    attack: familyCounts.attack || 0,
    absolutes: familyCounts.absolutes || 0,
    evasion: familyCounts.evasion || 0,
    cooperation: familyCounts.cooperation || 0,
    correction: familyCounts.correction || 0,
    evidence: familyCounts.evidence || 0,
  };

  return {
    totalMessages: messages.length,
    distinctTermsMatched: allMatches.length,
    totalKeywordMatches: allMatches.reduce((s, m) => s + m.matchCount, 0),
    axes,
    allMatches,
  };
}

function generateMarkdownReport(users, analyses, dictionary, config) {
  const lines = [];

  lines.push('# Bilibili User Personality Analysis — Model Validation Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Seed tag:** ${config.seed || 'N/A'}`);
  lines.push(`**Source video:** [${config.bvid || 'N/A'}](https://www.bilibili.com/video/${config.bvid}/)`);
  lines.push(`**Data source:** ${config.source || 'AICU user database'}`);
  lines.push(`**Users analyzed:** ${users.length} (randomly selected from ${config.poolSize || '?'} users with comment history)`);
  lines.push(`**Dictionary:** ${(Array.isArray(dictionary.entries) ? dictionary.entries.length : '?')} keyword terms across 6 behavioral families`);
  lines.push('');

  lines.push('## Methodology');
  lines.push('');
  lines.push('1. **Browser-harness** navigated to the Bilibili video page and extracted commenter UIDs via the Bilibili Reply API');
  lines.push(`2. From a pool of ${config.poolSize || '?'} users with comment history in the AICU database, 5 were randomly selected`);
  lines.push('3. Each user\'s comment + danmaku corpus was extracted (pre-scraped via AICU indexing service)');
  lines.push('4. **Keyword evidence matching** was run against the full 1,576-term dictionary');
  lines.push('5. Six behavioral axes were scored: attack, absolutes, evasion, cooperation, correction, evidence');
  lines.push('');

  lines.push('## Individual User Profiles');
  lines.push('');

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const uid = String(user.uid);
    const a = analyses[uid];

    lines.push(`### User ${i + 1}: UID ${uid}`);
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Comments | ${user.commentCount || 0} |`);
    lines.push(`| Danmaku | ${user.danmakuCount || 0} |`);
    lines.push(`| Scraped at | ${user.scrapedAt || 'unknown'} |`);
    if (a) {
      lines.push(`| Messages analyzed | ${a.totalMessages} |`);
      lines.push(`| Distinct terms matched | ${a.distinctTermsMatched} |`);
      lines.push(`| Total keyword hits | ${a.totalKeywordMatches} |`);
    }
    lines.push('');

    if (a && a.distinctTermsMatched > 0) {
      lines.push('#### Behavioral Axes');
      lines.push('');
      lines.push('| Axis | Score | Level |');
      lines.push('|------|-------|-------|');
      const maxScore = Math.max(...Object.values(a.axes), 1);
      for (const axis of ['attack', 'absolutes', 'evasion', 'cooperation', 'correction', 'evidence']) {
        const score = a.axes[axis] || 0;
        const bar = '█'.repeat(Math.min(Math.round(score / maxScore * 15), 15)) || '·';
        let level = score === 0 ? '—' : score <= 2 ? 'Low' : score <= 5 ? 'Moderate' : 'High';
        lines.push(`| ${axis} | ${score} ${bar} | ${level} |`);
      }
      lines.push('');

      // Show samples
      const topMatches = a.allMatches.sort((x, y) => y.matchCount - x.matchCount).slice(0, 5);
      lines.push('<details>');
      lines.push('<summary>Top matched terms & samples</summary>');
      lines.push('');
      for (const m of topMatches) {
        lines.push(`- **\`${m.term}\`** (${m.family}, ${m.risk}) — ${m.matchCount} hits`);
        for (const s of m.samples.slice(0, 2)) {
          lines.push(`  > ${s.text.slice(0, 150)}`);
        }
      }
      lines.push('</details>');
      lines.push('');
    } else if (a) {
      lines.push('*No keyword matches — user language does not trigger any dictionary terms.*');
      lines.push('');
    }
  }

  // Aggregate
  lines.push('## Aggregate Analysis');
  lines.push('');

  const allAxes = { attack: 0, absolutes: 0, evasion: 0, cooperation: 0, correction: 0, evidence: 0 };
  let usersWithMatches = 0, totalHits = 0, totalDistinct = 0, totalMsgs = 0;

  for (const uid of Object.keys(analyses)) {
    const a = analyses[uid];
    if (!a) continue;
    totalMsgs += a.totalMessages;
    totalHits += a.totalKeywordMatches;
    totalDistinct += a.distinctTermsMatched;
    if (a.distinctTermsMatched > 0) usersWithMatches++;
    for (const axis of Object.keys(allAxes)) {
      allAxes[axis] += a.axes[axis] || 0;
    }
  }

  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Users with keyword matches | ${usersWithMatches}/${users.length} |`);
  lines.push(`| Total messages analyzed | ${totalMsgs} |`);
  lines.push(`| Total keyword hits | ${totalHits} |`);
  lines.push(`| Total distinct terms triggered | ${totalDistinct} |`);
  lines.push(`| Avg hits per user | ${(totalHits / Math.max(users.length, 1)).toFixed(1)} |`);
  lines.push(`| Avg distinct terms per user | ${(totalDistinct / Math.max(users.length, 1)).toFixed(1)} |`);
  lines.push('');

  lines.push('### Aggregate Axis Distribution');
  lines.push('');
  const maxAgg = Math.max(...Object.values(allAxes), 1);
  for (const axis of Object.keys(allAxes)) {
    const score = allAxes[axis];
    const bar = '▓'.repeat(Math.round(score / maxAgg * 30)) || '·';
    lines.push(`- **${axis}**: ${score} ${bar}`);
  }
  lines.push('');

  // Domain distribution
  const familyHits = {};
  for (const uid of Object.keys(analyses)) {
    for (const m of (analyses[uid]?.allMatches || [])) {
      familyHits[m.family] = (familyHits[m.family] || 0) + m.matchCount;
    }
  }
  lines.push('### Hits by Behavioral Family');
  lines.push('');
  for (const [family, count] of Object.entries(familyHits).sort((a, b) => b[1] - a[1])) {
    lines.push(`- **${family}**: ${count} matches`);
  }
  lines.push('');

  lines.push('## Model Effectiveness Assessment');
  lines.push('');

  const assessments = [];

  // Coverage
  const coverageRate = usersWithMatches / Math.max(users.length, 1);
  if (coverageRate >= 0.8) {
    assessments.push('✅ **High user coverage**: ' + (coverageRate * 100).toFixed(0) + '% of users triggered keyword matches — the dictionary captures real Bilibili discourse patterns.');
  } else if (coverageRate >= 0.4) {
    assessments.push('⚠️ **Moderate user coverage**: ' + (coverageRate * 100).toFixed(0) + '% of users triggered matches. Some users use language outside the dictionary scope.');
  } else {
    assessments.push('❌ **Low user coverage**: Only ' + (coverageRate * 100).toFixed(0) + '% of users matched. Dictionary may need expansion for general Bilibili discourse.');
  }

  // Diversity
  const avgDistinct = totalDistinct / Math.max(users.length, 1);
  if (avgDistinct >= 5) {
    assessments.push('✅ **Rich multi-axis profiles**: Average ' + avgDistinct.toFixed(1) + ' distinct terms per user, capturing nuanced behavioral patterns.');
  } else if (avgDistinct >= 2) {
    assessments.push('⚠️ **Adequate signal**: ' + avgDistinct.toFixed(1) + ' terms/user — enough to distinguish behavioral tendencies but room for richer profiling.');
  } else {
    assessments.push('⚠️ **Sparse signal**: Only ' + avgDistinct.toFixed(1) + ' terms/user on average. Individual profiles may lack statistical robustness.');
  }

  // Balance
  const totalNonAttack = allAxes.absolutes + allAxes.evasion + allAxes.cooperation + allAxes.correction + allAxes.evidence;
  const attackRatio = allAxes.attack / Math.max(totalNonAttack, 1);
  if (attackRatio > 3) {
    assessments.push('⚠️ **Attack-heavy bias**: Attack-family terms dominate ' + (allAxes.attack / Math.max(totalHits, 1) * 100).toFixed(0) + '% of all hits. Dictionary may over-represent adversarial language.');
  } else if (attackRatio > 0.5) {
    assessments.push('ℹ️ **Attack present but balanced**: Attack signals co-exist with other behavioral axes in reasonable proportion.');
  } else {
    assessments.push('✅ **Well-balanced**: Non-attack behavioral signals (cooperation, correction, evidence) provide meaningful counterweight to adversarial patterns.');
  }

  // Axis coverage (how many axes are active)
  const activeAxes = Object.values(allAxes).filter(v => v > 0).length;
  if (activeAxes >= 5) {
    assessments.push('✅ **Broad axis coverage**: ' + activeAxes + '/6 behavioral axes activated — the model captures diverse communication behaviors.');
  } else if (activeAxes >= 3) {
    assessments.push('⚠️ **Moderate axis coverage**: ' + activeAxes + '/6 axes active. Some behavioral dimensions (evidence, correction) may be under-represented in entertainment discourse.');
  } else {
    assessments.push('❌ **Narrow axis coverage**: Only ' + activeAxes + '/6 axes activated. Model may not differentiate behavior types adequately.');
  }

  for (const a of assessments) {
    lines.push(a);
  }
  lines.push('');

  // Comparison with baseline
  lines.push('## Comparison with Expected Baseline');
  lines.push('');
  lines.push('Given that these users were sampled from the "历史" (History) seed video — an educational/entertainment topic — the expected behavior profile should be:');
  lines.push('- **Cooperation & evidence** axes active (educational discourse)');
  lines.push('- **Attack** at low-to-moderate levels (internet debate culture)');
  lines.push('- **Correction** axis present (historical fact-checking tendencies)');
  lines.push('- **Absolutes & evasion** at background levels');
  lines.push('');

  const actualProfile = [];
  if (allAxes.cooperation > allAxes.attack) actualProfile.push('Cooperation > Attack ✅ (matches educational context)');
  else actualProfile.push('Attack ≥ Cooperation ⚠️ (debate-heavy, may not match educational topic)');
  if (allAxes.correction > 0) actualProfile.push('Correction axis active ✅ (fact-checking behavior detected)');
  else actualProfile.push('Correction axis silent ⚠️ (no fact-checking detected in history discussion)');
  if (allAxes.evidence > 0) actualProfile.push('Evidence axis active ✅ (source-referencing behavior)');
  else actualProfile.push('Evidence axis silent (rare in entertainment comments)');
  for (const p of actualProfile) lines.push('- ' + p);
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  lines.push('1. **Run on diverse seed tags**: Test "历史" (history), "游戏" (gaming), "科技" (tech) to validate cross-domain applicability');
  lines.push('2. **Expand rare axes**: The evidence/correction axes are naturally sparse — consider lowering match thresholds or adding academic discourse patterns');
  lines.push('3. **Normalize for comment volume**: Users with 1-2 comments yield sparse profiles — weight by corpus size');
  lines.push('4. **Add Bilibili-specific slang**: Meme-stock phrases and platform-specific jargon would improve hit rates');
  lines.push('5. **Compare against human annotation**: The ultimate validation is inter-rater agreement with human-labeled behavioral profiles');
  lines.push('');

  lines.push('---');
  lines.push(`*Report generated via browser-harness + keyword evidence analysis pipeline | Dictionary: ${(Array.isArray(dictionary.entries) ? dictionary.entries.length : '?')} terms | Corpus: AICU-indexed Bilibili comments*`);

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // Load selected users
  const usersPath = join(__dirname, 'db_selected_users.json');
  const { selected_users, ...config } = JSON.parse(await readFile(usersPath, 'utf8'));
  console.log(`Loaded ${selected_users.length} users from AICU database`);

  // Load dictionary (from combined entries file or from shards)
  let dictionary;
  const combinedPath = join(__dirname, 'all_entries.json');
  try {
    dictionary = JSON.parse(await readFile(combinedPath, 'utf8'));
    console.log(`Dictionary: ${(dictionary.entries || []).length} terms (from combined file)`);
  } catch {
    // Fallback: load from production JSON
    const dictPath = join(PROJECT_ROOT, 'server/data/deepseekKeywordDictionary.json');
    dictionary = JSON.parse(await readFile(dictPath, 'utf8'));
    console.log(`Dictionary: ${(dictionary.entries || []).length} terms (from production file)`);
  }

  // Analyze each user
  const analyses = {};
  for (const user of selected_users) {
    const uid = String(user.uid);
    console.log(`\nAnalyzing UID=${uid} (${user.commentCount}c/${user.danmakuCount||0}d)...`);
    const result = analyzeUser(user, dictionary);
    analyses[uid] = result;
    console.log(`  ${result.totalMessages} msgs → ${result.distinctTermsMatched} terms, ${result.totalKeywordMatches} hits`);
    console.log(`  Axes: A=${result.axes.attack} Ab=${result.axes.absolutes} E=${result.axes.evasion} Co=${result.axes.cooperation} Cr=${result.axes.correction} Ev=${result.axes.evidence}`);
  }

  // Generate report
  const report = generateMarkdownReport(selected_users, analyses, dictionary, {
    ...config,
    poolSize: 5513,
  });
  const reportPath = join(PROJECT_ROOT, '.claude', 'personality_analysis_report.md');
  await writeFile(reportPath, report, 'utf8');
  console.log(`\nReport written to ${reportPath}`);

  // Save raw data
  const dataPath = join(PROJECT_ROOT, '.claude', 'personality_analysis_data.json');
  await writeFile(dataPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config,
    users: selected_users,
    analyses,
  }, null, 2), 'utf8');

  // Summary
  console.log('\n========================================');
  console.log('        ANALYSIS SUMMARY');
  console.log('========================================');
  let totalHits = 0, totalDistinct = 0, totalMsgs = 0, usersWith = 0;
  for (const uid of Object.keys(analyses)) {
    const a = analyses[uid];
    totalHits += a.totalKeywordMatches;
    totalDistinct += a.distinctTermsMatched;
    totalMsgs += a.totalMessages;
    if (a.distinctTermsMatched > 0) usersWith++;
  }
  console.log(`Users analyzed:           ${selected_users.length}`);
  console.log(`Users with matches:       ${usersWith}`);
  console.log(`Total messages:           ${totalMsgs}`);
  console.log(`Total keyword hits:       ${totalHits}`);
  console.log(`Distinct terms triggered: ${totalDistinct}`);
  console.log(`Avg hits/user:            ${(totalHits / Math.max(selected_users.length, 1)).toFixed(1)}`);
  console.log(`Avg terms/user:           ${(totalDistinct / Math.max(selected_users.length, 1)).toFixed(1)}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
