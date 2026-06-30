// NOTE: SVG rendering has been migrated to Python (python_backend/analysis/readme_stats.py,
// ReadmeStatsSvgRenderer). The renderSvg() and renderTimelineSvg() functions below are dead
// and should NOT be used to generate stats SVGs. The npm script `stats:update` runs the Python
// renderer. The helper functions (buildCollectionTimeline, paddedTimelineMax, etc.) remain
// active — they are tested by updateReadmeStatsGraph.test.js and used by migration parity checks.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { readJsonCorpus } from '../services/splitCorpusStorage.js';
import {
  DATA_DIR,
  DEFAULT_COVERAGE_AUDIT_REPORT_PATH,
  DEFAULT_HUGGINGFACE_CORPUS_PATH,
} from '../utils/paths.js';

const OUTPUT_DIR = join(process.cwd(), 'docs', 'stats');
const SVG_PATH = join(OUTPUT_DIR, 'corpus-keyword-stats.svg');
const JSON_PATH = join(OUTPUT_DIR, 'corpus-keyword-stats.json');
const TIMELINE_SVG_PATH = join(OUTPUT_DIR, 'corpus-growth-timeline.svg');
const TIMELINE_JSON_PATH = join(OUTPUT_DIR, 'corpus-growth-timeline.json');
const README_PATH = join(process.cwd(), 'README.md');
const START_MARKER = '<!-- stats-graph:start -->';
const END_MARKER = '<!-- stats-graph:end -->';

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasHanText(value) {
  return /[\u3400-\u9fff]/u.test(String(value || ''));
}

function isDanmakuRecord(record = {}) {
  return /danmaku/i.test([
    record.platform,
    record.source,
    record.sourceKind,
    record.type,
    record.file,
  ].map(cleanText).join(' '));
}

async function readOptionalJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function uniqueComments(comments = []) {
  return [...new Map(
    comments
      .filter((record) => hasHanText(record?.message))
      .map((record) => [
        `${cleanText(record.platform)}\n${cleanText(record.sourceUrl || record.source)}\n${cleanText(record.message)}`,
        record,
      ]),
  ).values()];
}

function summarizeCorpus(name, comments = []) {
  const unique = uniqueComments(comments);
  const danmaku = unique.filter(isDanmakuRecord);
  return {
    name,
    total: unique.length,
    comments: unique.length - danmaku.length,
    danmaku: danmaku.length,
  };
}

function validDate(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function runAddedCount(run = {}) {
  const value = Number(
    run.commentsAdded
    ?? run.addedComments
    ?? run.commentsCollected
    ?? run.importedRows
    ?? 0,
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function buildCollectionTimeline(sources = []) {
  const events = [];
  let finalComments = 0;
  let finalDanmaku = 0;

  for (const source of sources) {
    const unique = uniqueComments(source.comments || []);
    const danmakuCount = unique.filter(isDanmakuRecord).length;
    const commentCount = Math.max(0, unique.length - danmakuCount);
    const total = Math.max(1, unique.length);
    const danmakuRatio = danmakuCount / total;

    finalComments += commentCount;
    finalDanmaku += danmakuCount;

    for (const run of source.runs || []) {
      const date = validDate(run.at);
      const added = runAddedCount(run);
      if (!date || added <= 0) continue;
      const danmaku = Math.min(added, Math.max(0, Math.round(added * danmakuRatio)));
      events.push({
        date,
        source: source.name || 'corpus',
        added,
        comments: added - danmaku,
        danmaku,
      });
    }
  }

  events.sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  let comments = 0;
  let danmaku = 0;
  let points = events.map((event) => {
    comments += event.comments;
    danmaku += event.danmaku;
    return {
      date: event.date,
      source: event.source,
      added: event.added,
      comments,
      danmaku,
      total: comments + danmaku,
    };
  });

  if (points.length > 0) {
    const last = points[points.length - 1];
    if (last.comments !== finalComments || last.danmaku !== finalDanmaku) {
      const commentScale = last.comments > 0 ? finalComments / last.comments : 0;
      const danmakuScale = last.danmaku > 0 ? finalDanmaku / last.danmaku : 0;
      let previousComments = 0;
      let previousDanmaku = 0;
      points = points.map((point, index) => {
        const isLast = index === points.length - 1;
        const scaledComments = isLast
          ? finalComments
          : Math.min(finalComments, Math.max(previousComments, Math.round(point.comments * commentScale)));
        const scaledDanmaku = isLast
          ? finalDanmaku
          : Math.min(finalDanmaku, Math.max(previousDanmaku, Math.round(point.danmaku * danmakuScale)));
        previousComments = scaledComments;
        previousDanmaku = scaledDanmaku;
        return {
          ...point,
          comments: scaledComments,
          danmaku: scaledDanmaku,
          total: scaledComments + scaledDanmaku,
        };
      });
    }
  } else if (finalComments > 0 || finalDanmaku > 0) {
    points.push({
      date: new Date().toISOString(),
      source: 'current corpus',
      added: finalComments + finalDanmaku,
      comments: finalComments,
      danmaku: finalDanmaku,
      total: finalComments + finalDanmaku,
    });
  }

  return {
    finalComments,
    finalDanmaku,
    finalTotal: finalComments + finalDanmaku,
    points,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function barRow({ label, value, color, y, maxValue }) {
  const width = maxValue > 0 ? Math.max(2, Math.round((value / maxValue) * 440)) : 2;
  return `
    <text x="40" y="${y}" class="label">${escapeXml(label)}</text>
    <rect x="220" y="${y - 18}" width="440" height="24" rx="12" fill="#e8e1d2"/>
    <rect x="220" y="${y - 18}" width="${width}" height="24" rx="12" fill="${color}"/>
    <text x="680" y="${y}" class="value">${formatNumber(value)}</text>`;
}

function renderSvg(_stats) {
  throw new Error('SVG rendering migrated to Python — use npm run stats:update');
}

function formatDateLabel(value) {
  return new Date(value).toISOString().slice(5, 16).replace('T', ' ');
}

function polyline(points, valueKey, maxValue, x0, y0, width, height) {
  if (!points.length) return '';
  const yForValue = (value) => {
    const ratio = Math.max(0, Math.min(1, value / maxValue));
    return y0 + height - (ratio * height);
  };
  if (points.length === 1) {
    const y = yForValue(points[0][valueKey]);
    return `${x0},${y.toFixed(1)} ${x0 + width},${y.toFixed(1)}`;
  }
  return points.map((point, index) => {
    const x = x0 + ((index / (points.length - 1)) * width);
    const y = yForValue(point[valueKey]);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

export function paddedTimelineMax(value) {
  const raw = Math.max(1, Number(value) || 1);
  const padded = raw * 1.08;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(padded)) - 1);
  return Math.ceil(padded / magnitude) * magnitude;
}

function renderTimelineSvg(_timeline, _generatedAt) {
  throw new Error('SVG rendering migrated to Python — use npm run stats:update');
}

function readmeBlock(stats) {
  return `${START_MARKER}
## Data Growth / 数据增长

![Corpus and keyword analysis stats](docs/stats/corpus-keyword-stats.svg)

![Comment and danmaku growth over time](docs/stats/corpus-growth-timeline.svg)

| Metric | Value |
|---|---:|
| Comments / replies | ${formatNumber(stats.comments)} |
| Danmaku | ${formatNumber(stats.danmaku)} |
| Keyword terms analyzed | ${formatNumber(stats.keywordTerms)} |
| Coverage ratio | ${stats.coverageRatioLabel} |
| Weak terms | ${formatNumber(stats.weakTerms)} |
| Timeline points | ${formatNumber(stats.timeline.points.length)} |

This block is generated by \`npm run stats:update\` and refreshed by GitHub Actions.
${END_MARKER}`;
}

async function updateReadme(stats) {
  const block = readmeBlock(stats);
  const current = await readFile(README_PATH, 'utf8');
  const pattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`);
  const next = pattern.test(current)
    ? current.replace(pattern, block)
    : current.replace(/\r?\n---\r?\n/, `\n---\n\n${block}\n\n---\n`);
  if (next !== current) {
    await writeFile(README_PATH, next, 'utf8');
  }
}

export async function main() {
  const direct = await readJsonCorpus(join(DATA_DIR, 'bilibiliDirectProbeCorpus.json'), { comments: [], runs: [] });
  const external = await readJsonCorpus(DEFAULT_HUGGINGFACE_CORPUS_PATH, { comments: [], runs: [] });
  const dictionary = await readKeywordDictionary();
  const coverage = await readOptionalJson(DEFAULT_COVERAGE_AUDIT_REPORT_PATH, {});

  const rawSources = [
    { name: 'Bilibili direct probe corpus', comments: direct.comments || [], runs: direct.runs || [] },
    { name: 'External Bilibili corpus', comments: external.comments || [], runs: external.runs || [] },
  ];
  const sources = rawSources.map((source) => summarizeCorpus(source.name, source.comments));
  const timeline = buildCollectionTimeline(rawSources);
  const stats = {
    generatedAt: new Date().toISOString(),
    comments: sources.reduce((sum, source) => sum + source.comments, 0),
    danmaku: sources.reduce((sum, source) => sum + source.danmaku, 0),
    keywordTerms: (dictionary.entries || []).length,
    coverageRatio: Number(coverage.coverage?.coverageRatio || coverage.coverageRatio || 0),
    coverageRatioLabel: `${((Number(coverage.coverage?.coverageRatio || coverage.coverageRatio || 0)) * 100).toFixed(2)}%`,
    weakTerms: Number(coverage.coverage?.weakTerms || coverage.weakTerms || 0),
    evidenceDeficit: Number(coverage.coverage?.evidenceDeficit || coverage.evidenceDeficit || 0),
    sources,
    timeline,
  };

  await mkdir(dirname(SVG_PATH), { recursive: true });
  await writeFile(SVG_PATH, renderSvg(stats), 'utf8');
  await writeFile(JSON_PATH, `${JSON.stringify({
    ...stats,
    timeline: {
      pointCount: timeline.points.length,
      finalComments: timeline.finalComments,
      finalDanmaku: timeline.finalDanmaku,
      finalTotal: timeline.finalTotal,
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(TIMELINE_SVG_PATH, renderTimelineSvg(timeline, stats.generatedAt), 'utf8');
  await writeFile(TIMELINE_JSON_PATH, `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');
  await updateReadme(stats);

  console.log(JSON.stringify({
    comments: stats.comments,
    danmaku: stats.danmaku,
    keywordTerms: stats.keywordTerms,
    coverageRatio: stats.coverageRatioLabel,
    timelinePoints: timeline.points.length,
    svg: SVG_PATH,
    json: JSON_PATH,
    timelineSvg: TIMELINE_SVG_PATH,
    timelineJson: TIMELINE_JSON_PATH,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
