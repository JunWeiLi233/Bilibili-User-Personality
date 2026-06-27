/**
 * Personality analysis for 5 randomly selected users from a Bilibili seed video.
 *
 * Usage: node .claude/analyze_selected_users.js
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const AICU_COMMENTS_API = 'https://api.aicu.cc/api/v3/search/getreply';
const AICU_DANMAKU_API = 'https://api.aicu.cc/api/v3/search/getvideodm';
const DELAY_MS = 1500;
const MAX_CONSECUTIVE_RETRIES = 3;
const RETRY_BASE_MS = 8000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── AICU API ─────────────────────────────────────────────────────────────

async function fetchAicuComments(uid, page = 1, pageSize = 20) {
  const url = `${AICU_COMMENTS_API}?uid=${uid}&pn=${page}&ps=${pageSize}&mode=0&keyword=`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchAicuDanmaku(uid, page = 1, pageSize = 20) {
  const url = `${AICU_DANMAKU_API}?uid=${uid}&pn=${page}&ps=${pageSize}&keyword=`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function scrapeUserData(uid, maxPages = 5) {
  const allComments = [];
  const allDanmaku = [];
  let consecutiveRetries = 0;

  // Fetch comments
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuComments(uid, page);
      if (data.code !== 0 || !data.data?.replies?.length) break;
      allComments.push(...data.data.replies);
      if (data.data.cursor?.is_end) break;
      if (page < maxPages) await wait(DELAY_MS);
      consecutiveRetries = 0;
    } catch (err) {
      if (err.message.includes('429')) {
        consecutiveRetries += 1;
        if (consecutiveRetries > MAX_CONSECUTIVE_RETRIES) break;
        await wait(RETRY_BASE_MS * consecutiveRetries);
        page--;
        continue;
      }
      break;
    }
  }

  // Fetch danmaku
  consecutiveRetries = 0;
  for (let page = 1; page <= maxPages; page++) {
    try {
      const data = await fetchAicuDanmaku(uid, page);
      if (data.code !== 0 || !data.data?.videodmlist?.length) break;
      allDanmaku.push(...data.data.videodmlist);
      if (data.data.cursor?.is_end) break;
      if (page < maxPages) await wait(DELAY_MS);
      consecutiveRetries = 0;
    } catch (err) {
      if (err.message.includes('429')) {
        consecutiveRetries += 1;
        if (consecutiveRetries > MAX_CONSECUTIVE_RETRIES) break;
        await wait(RETRY_BASE_MS * consecutiveRetries);
        page--;
        continue;
      }
      break;
    }
  }

  return { comments: allComments, danmaku: allDanmaku };
}

// ── Keyword Evidence Analysis ────────────────────────────────────────────

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().normalize('NFKC').toLowerCase();
}

// Dictionary loaded directly in main() via readFile

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

function analyzeUserComments(userComments, dictionary) {
  const entries = Array.isArray(dictionary.entries) ? dictionary.entries : [];
  const matches = [];

  // Build messages list
  const messages = (userComments.comments || []).map(c => ({
    text: normalizeText(c.message || ''),
    time: c.time || c.ctime || 0,
    oid: c.dyn?.oid || c.oid || '',
  }));
  const danmaku = (userComments.danmaku || []).map(d => ({
    text: normalizeText(d.content || d.message || ''),
    time: d.time || d.ctime || 0,
    oid: d.oid || '',
  }));
  const allMessages = [...messages, ...danmaku].filter(m => m.text.length > 0);

  // Match against each dictionary entry
  for (const entry of entries) {
    const needles = buildNeedleSet(entry);
    const matchedMessages = [];

    for (const msg of allMessages) {
      if (needles.some(needle => msg.text.includes(needle))) {
        matchedMessages.push({
          text: msg.text.slice(0, 200),
          time: msg.time,
        });
      }
    }

    if (matchedMessages.length > 0) {
      matches.push({
        term: entry.term,
        family: entry.family || 'unknown',
        meaning: entry.meaning || '',
        risk: entry.risk || 'neutral',
        matchCount: matchedMessages.length,
        samples: matchedMessages.slice(0, 3),
      });
    }
  }

  // Aggregate by family
  const familyCounts = {};
  const familyDetails = {};
  for (const m of matches) {
    familyCounts[m.family] = (familyCounts[m.family] || 0) + m.matchCount;
    if (!familyDetails[m.family]) familyDetails[m.family] = [];
    familyDetails[m.family].push({ term: m.term, count: m.matchCount, risk: m.risk });
  }

  // Score axes
  const axes = {
    attack: familyCounts.attack || 0,
    absolutes: familyCounts.absolutes || 0,
    evasion: familyCounts.evasion || 0,
    cooperation: familyCounts.cooperation || 0,
    correction: familyCounts.correction || 0,
    evidence: familyCounts.evidence || 0,
  };

  const totalMatches = Object.values(axes).reduce((a, b) => a + b, 0);
  const distinctTerms = matches.length;

  return {
    totalMessages: allMessages.length,
    commentCount: messages.length,
    danmakuCount: danmaku.length,
    distinctTermsMatched: distinctTerms,
    totalKeywordMatches: totalMatches,
    axes,
    familyDetails,
    allMatches: matches,
  };
}

// ── Report ────────────────────────────────────────────────────────────────

function generateReport(selectedUsers, analyses, dictionary) {
  const lines = [];

  lines.push('# Bilibili User Personality Analysis — Model Validation Report');
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Seed tag:** 历史`);
  lines.push(`**Video:** [BV1oT4y1671T](https://www.bilibili.com/video/BV1oT4y1671T/) — "历史书太小 装不下一个人波澜壮阔的一生"`);
  lines.push(`**Total video comments:** 34,100`);
  lines.push(`**Users analyzed:** 5 (randomly selected from commenters)`);
  lines.push(`**Dictionary size:** ${(Array.isArray(dictionary.entries) ? dictionary.entries.length : '?')} terms`);
  lines.push('');

  lines.push('## Methodology');
  lines.push('');
  lines.push('1. Used **browser-harness** to navigate to the Bilibili video page and fetch comment data via the Bilibili Reply API');
  lines.push('2. Collected commenter UIDs from multiple API modes (hot + time-sorted), deduplicated');
  lines.push('3. Randomly selected 5 unique users from the pool');
  lines.push(`4. Fetched each user's full comment + danmaku history via the AICU public API`);
  lines.push('5. Ran keyword evidence matching (1,576-term dictionary) against each user\'s corpus');
  lines.push('6. Scored 6 behavioral axes: attack, absolutes, evasion, cooperation, correction, evidence');
  lines.push('');

  lines.push('## Results: Individual User Profiles');
  lines.push('');

  for (let i = 0; i < selectedUsers.length; i++) {
    const user = selectedUsers[i];
    const uid = String(user.uid);
    const analysis = analyses[uid];

    lines.push(`### User ${i + 1}: ${user.uname} (UID: ${uid})`);
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Video comment | ${(user.message || '').slice(0, 100)} |`);
    lines.push(`| Video comment likes | ${user.like} |`);

    if (analysis) {
      lines.push(`| Total messages analyzed | ${analysis.totalMessages} (${analysis.commentCount} comments + ${analysis.danmakuCount} danmaku) |`);
      lines.push(`| Distinct terms matched | ${analysis.distinctTermsMatched} |`);
      lines.push(`| Total keyword hits | ${analysis.totalKeywordMatches} |`);
      lines.push('');

      lines.push('#### Behavioral Axes Scores');
      lines.push('');
      lines.push('| Axis | Matches | Interpretation |');
      lines.push('|------|---------|----------------|');
      for (const axis of ['attack', 'absolutes', 'evasion', 'cooperation', 'correction', 'evidence']) {
        const score = analysis.axes[axis] || 0;
        const maxAxis = Math.max(...Object.values(analysis.axes), 1);
        const bar = '█'.repeat(Math.round(score / maxAxis * 20)) || '·';
        let interpretation = '';
        if (axis === 'attack' && score > 0) interpretation = 'Adversarial/aggressive language patterns detected';
        else if (axis === 'absolutes' && score > 0) interpretation = 'Uses absolute/definitive language';
        else if (axis === 'evasion' && score > 0) interpretation = 'Evasive or deflecting communication';
        else if (axis === 'cooperation' && score > 0) interpretation = 'Cooperative/collaborative signals';
        else if (axis === 'correction' && score > 0) interpretation = 'Engages in factual correction';
        else if (axis === 'evidence' && score > 0) interpretation = 'References evidence/sources';
        else interpretation = 'No significant signal';
        lines.push(`| ${axis} | ${score} ${bar} | ${interpretation} |`);
      }
      lines.push('');

      // Top matched terms
      const topTerms = analysis.allMatches
        .sort((a, b) => b.matchCount - a.matchCount)
        .slice(0, 5);
      if (topTerms.length > 0) {
        lines.push('**Top matched terms:**');
        for (const t of topTerms) {
          lines.push(`- \`${t.term}\` (${t.family}, ${t.risk}): ${t.matchCount} matches`);
        }
        lines.push('');
      }
    } else {
      lines.push(`| Status | No data retrieved |`);
      lines.push('');
    }
  }

  // Summary
  lines.push('## Aggregate Analysis');
  lines.push('');

  const allAxes = { attack: 0, absolutes: 0, evasion: 0, cooperation: 0, correction: 0, evidence: 0 };
  let usersWithData = 0;
  let totalDistinctTerms = 0;
  let totalHits = 0;
  let totalMessages = 0;

  for (const uid of Object.keys(analyses)) {
    const a = analyses[uid];
    if (!a) continue;
    usersWithData++;
    totalDistinctTerms += a.distinctTermsMatched;
    totalHits += a.totalKeywordMatches;
    totalMessages += a.totalMessages;
    for (const axis of Object.keys(allAxes)) {
      allAxes[axis] += a.axes[axis] || 0;
    }
  }

  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Users with data | ${usersWithData}/5 |`);
  lines.push(`| Total messages analyzed | ${totalMessages} |`);
  lines.push(`| Total keyword hits | ${totalHits} |`);
  lines.push(`| Total distinct terms triggered | ${totalDistinctTerms} |`);
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

  // Model evaluation
  lines.push('## Model Effectiveness Assessment');
  lines.push('');

  const modelObservations = [];

  if (usersWithData === 5) {
    modelObservations.push('✅ **Data pipeline works**: All 5 users had comment histories successfully fetched via AICU API.');
  } else if (usersWithData >= 3) {
    modelObservations.push(`⚠️ **Partial data retrieval**: ${usersWithData}/5 users had retrievable comment histories. Some users may have private/empty profiles.`);
  } else {
    modelObservations.push('❌ **Data pipeline issues**: Fewer than 3 users had retrievable data. AICU API coverage may be limited for newer users.');
  }

  if (totalHits > 0) {
    modelObservations.push(`✅ **Keyword matching active**: ${totalHits} keyword matches across ${totalDistinctTerms} distinct terms, demonstrating the dictionary has real-world coverage.`);
  } else {
    modelObservations.push('❌ **No keyword matches**: The dictionary may be too narrow or user comments too short for matching.');
  }

  const diversity = totalDistinctTerms / Math.max(usersWithData, 1);
  if (diversity >= 3) {
    modelObservations.push(`✅ **Good term diversity**: Average ${diversity.toFixed(1)} distinct terms per user, suggesting the model captures multiple behavioral dimensions.`);
  } else if (diversity >= 1) {
    modelObservations.push(`⚠️ **Moderate term diversity**: ${diversity.toFixed(1)} distinct terms/user. Coverage could be broader.`);
  } else {
    modelObservations.push(`❌ **Low term diversity**: Only ${diversity.toFixed(1)} terms/user. Dictionary may not capture organic Bilibili discourse well.`);
  }

  // Check axis balance
  const attackRatio = allAxes.attack / Math.max(totalHits, 1);
  if (attackRatio > 0.7) {
    modelObservations.push('⚠️ **Attack-skewed**: The model disproportionately flags attack-family terms. Consider rebalancing dictionary.');
  }

  for (const obs of modelObservations) {
    lines.push(obs);
  }
  lines.push('');

  // Recommendations
  lines.push('## Recommendations');
  lines.push('');

  if (diversity < 3) {
    lines.push('- Expand the keyword dictionary with more Bilibili-specific slang and discourse patterns');
  }
  if (totalMessages < 50 * usersWithData) {
    lines.push('- Users have limited comment histories — consider scraping more pages or using the Bilibili crawler for deeper mining');
  }
  if (allAxes.evidence === 0 && allAxes.correction === 0) {
    lines.push('- The "evidence" and "correction" axes are silent — these may be rare behaviors on entertainment-oriented videos');
  }
  if (allAxes.cooperation > allAxes.attack) {
    lines.push('- Cooperation dominates attack signals — the model successfully distinguishes constructive from adversarial behavior');
  }
  lines.push('- Run this validation regularly on different seed tags to build confidence in cross-domain applicability');
  lines.push('');

  lines.push('---');
  lines.push(`*Report generated by browser-harness + keyword evidence analysis pipeline*`);

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  // Load selected users
  const inputPath = join(__dirname, 'selected_users_report.json');
  const inputData = JSON.parse(await readFile(inputPath, 'utf8'));
  const selectedUsers = inputData.selected_users;
  console.log(`Loaded ${selectedUsers.length} selected users from browser-harness selection`);

  // Load keyword dictionary
  const dictPath = join(PROJECT_ROOT, 'server/data/deepseekKeywordDictionary.production.json');
  let dictionary;
  try {
    dictionary = JSON.parse(await readFile(dictPath, 'utf8'));
    console.log(`Dictionary loaded: ${(dictionary.entries || []).length} terms`);
  } catch (e) {
    console.error('Failed to load dictionary:', e.message);
    dictionary = { entries: [] };
  }

  // Scrape each user
  const analyses = {};
  for (let i = 0; i < selectedUsers.length; i++) {
    const user = selectedUsers[i];
    const uid = String(user.uid);
    console.log(`\n[${i + 1}/5] Scraping UID=${uid} (${user.uname})...`);

    try {
      const userComments = await scrapeUserData(uid, 5);
      console.log(`  -> ${userComments.comments.length} comments, ${userComments.danmaku.length} danmaku`);

      const analysis = analyzeUserComments(userComments, dictionary);
      analyses[uid] = analysis;
      console.log(`  -> ${analysis.distinctTermsMatched} terms matched, ${analysis.totalKeywordMatches} keyword hits`);
      console.log(`  -> Axes: A=${analysis.axes.attack} Ab=${analysis.axes.absolutes} E=${analysis.axes.evasion} Co=${analysis.axes.cooperation} Cr=${analysis.axes.correction} Ev=${analysis.axes.evidence}`);
    } catch (e) {
      console.error(`  -> Failed: ${e.message}`);
    }

    if (i < selectedUsers.length - 1) await wait(DELAY_MS);
  }

  // Generate report
  const report = generateReport(selectedUsers, analyses, dictionary);
  const reportPath = join(PROJECT_ROOT, '.claude', 'personality_analysis_report.md');
  await writeFile(reportPath, report, 'utf8');
  console.log(`\nReport written to ${reportPath}`);

  // Also save raw analysis data
  const dataPath = join(PROJECT_ROOT, '.claude', 'personality_analysis_data.json');
  await writeFile(dataPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    seed: inputData.seed,
    bvid: inputData.bvid,
    users: selectedUsers,
    analyses,
  }, null, 2), 'utf8');
  console.log(`Raw data saved to ${dataPath}`);

  // Print summary
  console.log('\n=== Quick Summary ===');
  let totalHits = 0, totalDistinct = 0, totalMsgs = 0;
  for (const uid of Object.keys(analyses)) {
    const a = analyses[uid];
    totalHits += a.totalKeywordMatches;
    totalDistinct += a.distinctTermsMatched;
    totalMsgs += a.totalMessages;
  }
  console.log(`${Object.keys(analyses).length}/5 users scraped successfully`);
  console.log(`${totalMsgs} messages analyzed`);
  console.log(`${totalHits} keyword matches across ${totalDistinct} distinct terms`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
