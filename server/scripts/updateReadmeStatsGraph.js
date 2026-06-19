import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readKeywordDictionary } from '../services/deepseekKeywordTrainer.js';
import { readJsonCorpus } from '../services/splitCorpusStorage.js';
import {
  DATA_DIR,
  DEFAULT_COVERAGE_AUDIT_REPORT_PATH,
  DEFAULT_HUGGINGFACE_CORPUS_PATH,
  DEFAULT_TIEBA_CORPUS_PATH,
} from '../utils/paths.js';

const OUTPUT_DIR = join(process.cwd(), 'docs', 'stats');
const SVG_PATH = join(OUTPUT_DIR, 'corpus-keyword-stats.svg');
const JSON_PATH = join(OUTPUT_DIR, 'corpus-keyword-stats.json');
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

function renderSvg(stats) {
  const maxValue = Math.max(stats.comments, stats.danmaku, stats.keywordTerms, 1);
  const updated = new Date(stats.generatedAt).toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="920" height="430" viewBox="0 0 920 430" role="img" aria-labelledby="title desc">
  <title id="title">Bilibili User Personality data collection and keyword analysis stats</title>
  <desc id="desc">Current counts for collected comments, danmaku, and analyzed dictionary keywords.</desc>
  <style>
    .bg { fill: #f7f0df; }
    .panel { fill: #fffaf0; stroke: #27231c; stroke-width: 2; }
    .title { font: 700 28px Georgia, 'Times New Roman', serif; fill: #27231c; }
    .sub { font: 14px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #6c6355; }
    .label { font: 700 18px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }
    .value { font: 700 18px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; text-anchor: start; }
    .small { font: 13px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #5d5548; }
    .metric { font: 700 26px ui-monospace, SFMono-Regular, Consolas, monospace; fill: #27231c; }
  </style>
  <rect class="bg" width="920" height="430" rx="24"/>
  <rect class="panel" x="18" y="18" width="884" height="394" rx="20"/>
  <text x="40" y="62" class="title">Corpus Collection + Keyword Analysis</text>
  <text x="40" y="88" class="sub">auto-generated from repo data on ${escapeXml(updated)}</text>
  <g>
    <rect x="40" y="112" width="250" height="82" rx="16" fill="#eadfca" stroke="#27231c"/>
    <text x="62" y="146" class="small">comments / replies</text>
    <text x="62" y="177" class="metric">${formatNumber(stats.comments)}</text>
    <rect x="318" y="112" width="250" height="82" rx="16" fill="#dbe8df" stroke="#27231c"/>
    <text x="340" y="146" class="small">danmaku</text>
    <text x="340" y="177" class="metric">${formatNumber(stats.danmaku)}</text>
    <rect x="596" y="112" width="250" height="82" rx="16" fill="#e5d7bc" stroke="#27231c"/>
    <text x="618" y="146" class="small">keyword terms analyzed</text>
    <text x="618" y="177" class="metric">${formatNumber(stats.keywordTerms)}</text>
  </g>
  <g>
    ${barRow({ label: 'Comments', value: stats.comments, color: '#8c5f32', y: 246, maxValue })}
    ${barRow({ label: 'Danmaku', value: stats.danmaku, color: '#3f7558', y: 292, maxValue })}
    ${barRow({ label: 'Keywords', value: stats.keywordTerms, color: '#b98522', y: 338, maxValue })}
  </g>
  <text x="40" y="382" class="small">Coverage: ${escapeXml(stats.coverageRatioLabel)} | Weak terms: ${formatNumber(stats.weakTerms)} | Evidence deficit: ${formatNumber(stats.evidenceDeficit)}</text>
</svg>
`;
}

function readmeBlock(stats) {
  return `${START_MARKER}
## Data Growth / 数据增长

![Corpus and keyword analysis stats](docs/stats/corpus-keyword-stats.svg)

| Metric | Value |
|---|---:|
| Comments / replies | ${formatNumber(stats.comments)} |
| Danmaku | ${formatNumber(stats.danmaku)} |
| Keyword terms analyzed | ${formatNumber(stats.keywordTerms)} |
| Coverage ratio | ${stats.coverageRatioLabel} |
| Weak terms | ${formatNumber(stats.weakTerms)} |

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

const direct = await readJsonCorpus(join(DATA_DIR, 'bilibiliDirectProbeCorpus.json'), { comments: [] });
const external = await readJsonCorpus(DEFAULT_HUGGINGFACE_CORPUS_PATH, { comments: [] });
const tieba = await readJsonCorpus(DEFAULT_TIEBA_CORPUS_PATH, { comments: [] });
const dictionary = await readKeywordDictionary();
const coverage = await readOptionalJson(DEFAULT_COVERAGE_AUDIT_REPORT_PATH, {});

const sources = [
  summarizeCorpus('Bilibili direct probe corpus', direct.comments || []),
  summarizeCorpus('External Bilibili/Tieba corpus', external.comments || []),
  summarizeCorpus('Tieba corpus', tieba.comments || []),
];
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
};

await mkdir(dirname(SVG_PATH), { recursive: true });
await writeFile(SVG_PATH, renderSvg(stats), 'utf8');
await writeFile(JSON_PATH, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
await updateReadme(stats);

console.log(JSON.stringify({
  comments: stats.comments,
  danmaku: stats.danmaku,
  keywordTerms: stats.keywordTerms,
  coverageRatio: stats.coverageRatioLabel,
  svg: SVG_PATH,
  json: JSON_PATH,
}, null, 2));
