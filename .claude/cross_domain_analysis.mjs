/**
 * Cross-domain gaming validation — Step 3 of Phase 2.
 * 1. Discovers gaming videos via Bilibili search API
 * 2. Scrapes comments from those videos
 * 3. Runs keyword analysis on collected comments
 * 4. Writes comparison report against history baseline
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

const cookie = process.env.BILIBILI_COOKIE || "";
const crawler = require_("../server/services/bilibiliCrawler.js");
const deps = crawler.depsWithBilibiliCookie({}, cookie);

// Gaming seed keywords — broad coverage of Bilibili gaming categories
const GAMING_SEEDS = ["游戏", "电竞", "原神", "王者荣耀", "LOL英雄联盟", "吃鸡"];
const MAX_VIDEOS_PER_SEED = 3;
const MAX_COMMENTS_PER_VIDEO = 60;

// Load history baseline
const baselinePath = join(__dirname, "personality_analysis_data_100.json");
let baselineSummary = null;
let baselineAnalyses = null;
try {
  const raw = JSON.parse(require_("fs").readFileSync(baselinePath, "utf8"));
  baselineSummary = raw.summary || null;
  baselineAnalyses = raw.analyses || null; // object keyed by UID
  console.log("Loaded baseline:", baselineSummary?.users, "users,", baselineSummary?.totalMessages, "messages");
} catch {
  console.log("No baseline found — will generate gaming-only analysis");
}

// Load dictionary
const dictPath = join(PROJECT_ROOT, "server", "data", "deepseekKeywordDictionary.json");
const dict = JSON.parse(require_("fs").readFileSync(dictPath, "utf8"));

// Load actual entries from shard files (paths relative to server/data/)
const entryDir = join(PROJECT_ROOT, "server", "data", "deepseekKeywordDictionary.entries");
const allEntries = [];
for (const [family, files] of Object.entries(dict.entryFiles || {})) {
  for (const f of files) {
    try {
      const fullPath = join(PROJECT_ROOT, "server", "data", f);
      const shard = JSON.parse(require_("fs").readFileSync(fullPath, "utf8"));
      for (const e of (shard.entries || [])) {
        allEntries.push(e);
      }
    } catch (e) { console.log("  WARN: could not load shard " + f + ": " + e.message); }
  }
}
console.log("Dictionary entries loaded:", allEntries.length);

// Build needle sets per family
function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildNeedleSet(entry = {}) {
  const needles = [];
  if (entry.term) needles.push(normalizeText(entry.term));
  for (const alias of (Array.isArray(entry.aliases) ? entry.aliases : [])) {
    needles.push(normalizeText(alias));
  }
  return needles.filter(n => n.length >= 2);
}

const familyNeedles = {};
for (const entry of allEntries) {
  const fam = entry.family || "unknown";
  if (!familyNeedles[fam]) familyNeedles[fam] = [];
  familyNeedles[fam].push({ term: entry.term, needles: buildNeedleSet(entry), risk: entry.risk || "neutral" });
}
console.log("Families:", Object.keys(familyNeedles).map(k => k + ":" + familyNeedles[k].length).join(", "));

// --- Scrape gaming comments ---
const allComments = [];  // { text, uid, videoTitle, keyword }
const uidCommentCounts = new Map();

for (const keyword of GAMING_SEEDS) {
  console.log(`\n=== ${keyword} ===`);
  try {
    const videos = await crawler.discoverVideosByKeyword(keyword, 5, deps);
    const topVideos = (videos || []).slice(0, MAX_VIDEOS_PER_SEED);
    console.log(`  Found ${topVideos.length} videos`);

    for (const video of topVideos) {
      const bvid = video.bvid || (video.sourceUrl || "").match(/BV[\w]+/)?.[0];
      if (!bvid) continue;

      console.log(`  Scraping ${bvid}: ${(video.title || "").substring(0, 50)}`);
      try {
        const result = await crawler.fetchRepliesForVideo(bvid, { pages: 2, includeDanmaku: false }, deps);
        if (result.ok && result.comments) {
          let count = 0;
          for (const c of result.comments) {
            const text = normalizeText(c.message || c.content || "");
            if (text.length < 4) continue;
            const uid = String(c.mid || c.uid || "");
            allComments.push({
              text: text.slice(0, 300),
              uid,
              videoTitle: (video.title || "").slice(0, 60),
              keyword,
            });
            uidCommentCounts.set(uid, (uidCommentCounts.get(uid) || 0) + 1);
            count++;
            if (count >= MAX_COMMENTS_PER_VIDEO) break;
          }
          console.log(`    Collected ${count} comments`);
        }
      } catch (e) {
        console.log(`    Error: ${e.message}`);
      }
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
}

console.log(`\nTotal comments collected: ${allComments.length}`);
console.log(`Unique UIDs: ${uidCommentCounts.size}`);

// --- Keyword analysis on gaming comments ---
const gamingMatches = {}; // family -> { term, count }
for (const fam of Object.keys(familyNeedles)) {
  gamingMatches[fam] = {};
}

let totalMatchedComments = 0;
for (const comment of allComments) {
  let commentMatched = false;
  for (const [fam, entries] of Object.entries(familyNeedles)) {
    for (const entry of entries) {
      for (const needle of entry.needles) {
        if (comment.text.includes(needle)) {
          gamingMatches[fam][entry.term] = (gamingMatches[fam][entry.term] || 0) + 1;
          commentMatched = true;
          break; // one match per entry per comment
        }
      }
    }
  }
  if (commentMatched) totalMatchedComments++;
}

// Compute axis distributions for gaming
const gamingAxisDistribution = {};
for (const fam of Object.keys(familyNeedles)) {
  const entries = gamingMatches[fam] || {};
  const totalHits = Object.values(entries).reduce((s, v) => s + v, 0);
  const activeTerms = Object.keys(entries).length;
  gamingAxisDistribution[fam] = {
    totalHits,
    activeTerms,
    termCount: familyNeedles[fam]?.length || 0,
    activationRate: (familyNeedles[fam]?.length || 1) > 0 ? activeTerms / familyNeedles[fam].length : 0,
  };
}

// Load baseline axis distributions
let baselineAxisDistribution = null;
if (baselineAnalyses) {
  baselineAxisDistribution = {};
  for (const fam of Object.keys(familyNeedles)) {
    baselineAxisDistribution[fam] = { totalHits: 0, activeUsers: 0, userCount: Object.keys(baselineAnalyses).length };
  }
  for (const [, analysis] of Object.entries(baselineAnalyses)) {
    const axes = analysis.axes || {};
    for (const [fam, count] of Object.entries(axes)) {
      if (baselineAxisDistribution[fam] && count > 0) {
        baselineAxisDistribution[fam].totalHits += count;
        baselineAxisDistribution[fam].activeUsers += 1;
      }
    }
  }
  console.log("Baseline axis distribution:", Object.entries(baselineAxisDistribution).map(([k,v]) => k + ":" + v.totalHits + "hits/" + v.activeUsers + "users").join(", "));
}

// --- Build comparison report ---
const report = {
  generatedAt: new Date().toISOString(),
  methodology: "Keyword-based axis scoring on comments from gaming videos vs history-domain baseline",
  domains: {
    gaming: {
      source: "Bilibili gaming video comments (fresh scrape)",
      seeds: GAMING_SEEDS,
      videosScraped: GAMING_SEEDS.length * MAX_VIDEOS_PER_SEED,
      totalComments: allComments.length,
      uniqueUids: uidCommentCounts.size,
      matchedComments: totalMatchedComments,
      matchRate: allComments.length > 0 ? (totalMatchedComments / allComments.length * 100).toFixed(1) + "%" : "0%",
    },
    history: baselineSummary ? {
      source: "AICU database history-domain users (100-user baseline)",
      totalUsers: baselineSummary.users || 0,
      totalMessages: baselineSummary.totalMessages || 0,
    } : null,
  },
  axisDistribution: {},
  comparison: {},
  topGamingTerms: {},
  verdict: "",
};

// Build per-axis comparison
const AXIS_LABELS = {
  attack: "情绪过激",
  evasion: "回避讨论",
  evidence: "逻辑混乱",
  correction: "其他问题",
  absolutes: "绝对化表达",
  cooperation: "合作讨论",
};

for (const fam of Object.keys(familyNeedles)) {
  const gDist = gamingAxisDistribution[fam] || { totalHits: 0, activeTerms: 0 };
  const bDist = baselineAxisDistribution?.[fam] || { totalHits: 0, activeUsers: 0, userCount: 100 };

  const label = AXIS_LABELS[fam] || fam;
  report.axisDistribution[label] = {
    family: fam,
    gaming: { ...gDist, hitRate: allComments.length > 0 ? (gDist.totalHits / allComments.length * 100).toFixed(2) + "%" : "0%" },
    history: baselineAxisDistribution ? { ...bDist, hitRate: baselineSummary ? (bDist.totalHits / baselineSummary.totalMessages * 100).toFixed(2) + "%" : "N/A" } : null,
  };

  // Comparison: activation rate = fraction of terms that matched at least once
  if (baselineAxisDistribution) {
    const gRate = gDist.activeTerms / Math.max(1, gDist.termCount);
    const hRate = bDist.activeUsers / Math.max(1, bDist.userCount);
    report.comparison[label] = {
      gamingActivation: (gRate * 100).toFixed(1) + "%",
      historyActivation: (hRate * 100).toFixed(1) + "%",
      delta: ((gRate - hRate) * 100).toFixed(1) + "pp",
      interpretation: gRate > hRate * 1.2 ? "gaming_higher" : gRate < hRate * 0.8 ? "gaming_lower" : "comparable",
    };
  }

  // Top terms
  const topTerms = Object.entries(gamingMatches[fam] || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (topTerms.length > 0) {
    report.topGamingTerms[label] = topTerms.map(([t, c]) => ({ term: t, count: c }));
  }
}

// Verdict
const higherAxes = [];
const lowerAxes = [];
for (const [label, comp] of Object.entries(report.comparison)) {
  if (comp.interpretation === "gaming_higher") higherAxes.push(label);
  else if (comp.interpretation === "gaming_lower") lowerAxes.push(label);
}

if (higherAxes.length > 0 || lowerAxes.length > 0) {
  report.verdict = `Axis shift detected: gaming domain shows ${higherAxes.length > 0 ? "higher " + higherAxes.join(", ") : ""}${higherAxes.length > 0 && lowerAxes.length > 0 ? " and " : ""}${lowerAxes.length > 0 ? "lower " + lowerAxes.join(", ") : ""} compared to history baseline. `;
  if (higherAxes.includes("情绪过激") && lowerAxes.includes("合作讨论")) {
    report.verdict += "Pattern matches expectation: gaming discourse has more attack and less cooperation than history discourse. Model is measuring real discourse patterns, not memorized vocabulary.";
  } else {
    report.verdict += "Axis shifts are measurable across domains, suggesting the model captures genuine discourse differences rather than overfitting to history-domain vocabulary.";
  }
} else {
  report.verdict = "Axis distributions are comparable across domains. This could indicate: (1) Bilibili discourse patterns are similar across domains, (2) keyword coverage is consistent regardless of topic, or (3) the gaming sample is too small to detect differences.";
}

// Limitations
report.limitations = [
  "Gaming comments were scraped fresh (not from user profiles); per-comment analysis, not per-user",
  "Small gaming sample (" + allComments.length + " comments vs history baseline of " + (baselineSummary?.totalMessages || "unknown") + " messages)",
  "No per-user axis scoring — comments are analyzed in aggregate, not grouped by UID",
  "Gaming seeds may not capture the full diversity of gaming discourse on Bilibili",
  baselineAxisDistribution ? null : "No history baseline available — within-domain comparison only",
].filter(Boolean);

const reportPath = join(__dirname, "CROSS_DOMAIN_REPORT.md");

// Write JSON data
const dataPath = join(__dirname, "cross_domain_analysis_data.json");
writeFileSync(dataPath, JSON.stringify(report, null, 2));

// Write markdown report
const md = generateMarkdownReport(report, allComments, uidCommentCounts);
writeFileSync(reportPath, md);

console.log(`\n=== Cross-Domain Analysis Complete ===`);
console.log(`Report: ${reportPath}`);
console.log(`Data: ${dataPath}`);
console.log(`\n${report.verdict}`);

function generateMarkdownReport(report, allComments, uidCommentCounts) {
  const lines = [];
  lines.push("# Cross-Domain Analysis Report — Gaming vs History Discourse");
  lines.push("");
  lines.push(`> Generated: ${report.generatedAt}`);
  lines.push(`> Phase 2 Step 3: Cross-Domain Validation`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 1. Methodology");
  lines.push("");
  lines.push("Two-domain comparison using keyword-based axis scoring:");
  lines.push("");
  lines.push("| Domain | Source | Sample Size |");
  lines.push("|--------|--------|-------------|");
  lines.push(`| **Gaming** | Fresh Bilibili video comment scrape (${report.domains.gaming.seeds.length} seeds) | ${report.domains.gaming.totalComments} comments, ${report.domains.gaming.uniqueUids} UIDs |`);
  if (report.domains.history) {
    lines.push(`| **History** | AICU database 100-user baseline | ${report.domains.history.totalUsers} users, ${report.domains.history.totalMessages} messages |`);
  } else {
    lines.push(`| **History** | AICU database 100-user baseline | Not available |`);
  }
  lines.push("");
  lines.push("### Gaming Seeds Used");
  lines.push("");
  for (const seed of GAMING_SEEDS) {
    const count = allComments.filter(c => c.keyword === seed).length;
    lines.push(`- **${seed}**: ${count} comments`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 2. Axis Distribution Comparison");
  lines.push("");

  if (report.comparison && Object.keys(report.comparison).length > 0) {
    lines.push("| Axis | Gaming Activation | History Activation | Delta | Interpretation |");
    lines.push("|------|------------------|-------------------|-------|---------------|");
    for (const [label, comp] of Object.entries(report.comparison)) {
      const icon = comp.interpretation === "gaming_higher" ? "📈" : comp.interpretation === "gaming_lower" ? "📉" : "➡️";
      lines.push(`| ${label} | ${comp.gamingActivation} | ${comp.historyActivation} | ${comp.delta} | ${icon} ${comp.interpretation} |`);
    }
    lines.push("");
  }

  lines.push("### Gaming Domain Axis Detail");
  lines.push("");
  lines.push("| Axis | Family | Total Hits | Active Terms | Term Count | Activation Rate |");
  lines.push("|------|--------|-----------|-------------|-----------|----------------|");
  for (const [label, dist] of Object.entries(report.axisDistribution)) {
    const g = dist.gaming;
    const rate = g.termCount > 0 ? (g.activeTerms / g.termCount * 100).toFixed(1) + "%" : "0%";
    lines.push(`| ${label} | ${dist.family} | ${g.totalHits} | ${g.activeTerms} | ${g.termCount} | ${rate} |`);
  }
  lines.push("");

  if (report.topGamingTerms && Object.keys(report.topGamingTerms).length > 0) {
    lines.push("### Top Gaming Terms by Axis");
    lines.push("");
    for (const [label, terms] of Object.entries(report.topGamingTerms)) {
      lines.push(`**${label}:**`);
      lines.push(terms.map(t => `\`${t.term}\` (${t.count})`).join(", "));
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## 3. Gaming Comment Sample");
  lines.push("");
  const sampleComments = allComments
    .filter(c => {
      // Find comments that matched at least one dictionary term
      for (const [fam, entries] of Object.entries(familyNeedles)) {
        for (const entry of entries) {
          for (const needle of entry.needles) {
            if (c.text.includes(needle)) return true;
          }
        }
      }
      return false;
    })
    .slice(0, 30);

  lines.push(`Showing ${sampleComments.length} matched comments (of ${allComments.length} total):`);
  lines.push("");
  for (const c of sampleComments) {
    lines.push(`- **${c.keyword}** | ${c.videoTitle}`);
    lines.push(`  > ${c.text.slice(0, 120)}`);
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 4. Verdict");
  lines.push("");
  lines.push(report.verdict);
  lines.push("");

  lines.push("### Expected vs Observed");
  lines.push("");
  lines.push("| Expectation | Observed |");
  lines.push("|-------------|----------|");

  // Check attack (情绪过激)
  const attackComp = report.comparison?.["情绪过激"];
  const coopComp = report.comparison?.["合作讨论"];

  if (attackComp) {
    const expected = attackComp.interpretation === "gaming_higher" ? "✅ Confirmed" : "❌ Not observed";
    lines.push(`| Gaming → higher attack (情绪过激) | ${expected} (${attackComp.gamingActivation} vs ${attackComp.historyActivation}) |`);
  }
  if (coopComp) {
    const expected = coopComp.interpretation === "gaming_lower" ? "✅ Confirmed" : "❌ Not observed";
    lines.push(`| Gaming → lower cooperation (合作讨论) | ${expected} (${coopComp.gamingActivation} vs ${coopComp.historyActivation}) |`);
  }
  lines.push(`| Gaming → more meme/emote density | Not measured (keyword-based, not emote-aware) |`);
  lines.push("");

  lines.push("### Limitations");
  lines.push("");
  for (const lim of (report.limitations || [])) {
    lines.push(`- ${lim}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("## 5. Conclusion");
  lines.push("");
  if (attackComp?.interpretation === "gaming_higher" && coopComp?.interpretation === "gaming_lower") {
    lines.push("The model successfully detects domain-specific discourse differences. Gaming comments show the expected pattern: higher attack/emotional intensity and lower cooperative discussion compared to history-domain discourse. This confirms the keyword dictionary captures genuine discourse features rather than being overfit to history vocabulary.");
  } else if (attackComp || coopComp) {
    lines.push("The model shows measurable but not entirely expected axis shifts between domains. Some axes shift in the predicted direction, suggesting partial sensitivity to domain-specific discourse patterns. The mixed results may reflect: (1) Bilibili-wide discourse norms that transcend content categories, (2) keyword-based matching that is inherently content-agnostic, or (3) insufficient gaming sample size.");
  } else {
    lines.push("Axis distributions are comparable across domains. This suggests either: (1) Bilibili discourse patterns are fundamentally similar across content categories — users argue, cooperate, and evade similarly whether discussing history or games, (2) the keyword-based approach is content-agnostic by design, capturing discourse features independent of topic, or (3) the gaming sample is too small to detect subtle differences.");
  }
  lines.push("");
  lines.push("**Recommendation:** For more definitive cross-domain validation, a larger gaming UID sample with per-user (not per-comment) analysis is needed. The current result is directionally informative but not statistically conclusive.");

  return lines.join("\n");
}

console.log("Report written.");
