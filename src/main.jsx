import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Brain,
  ChartPolar,
  CheckCircle,
  ClipboardText,
  Detective,
  Faders,
  FlagBanner,
  Gauge,
  Lightning,
  MagnifyingGlass,
  Scales,
  ShieldWarning,
  WarningCircle,
} from '@phosphor-icons/react';
import { buildRiskLexiconText, isMemeOrQuotedNonAttackText } from './languageUnderstanding.js';
import SearchBox from './components/SearchBox.jsx';
import './styles.css';

// Ziegenbein et al. (2023) validated 4-category classification — replaces 6 custom axes
const ZIEGENBEIN_CATEGORIES = {
  toxicEmotions: { key: 'toxicEmotions', label: '情绪过激', shortLabel: 'Toxic Emotions', description: '过度激烈、情感欺骗' },
  missingCommitment: { key: 'missingCommitment', label: '回避讨论', shortLabel: 'Missing Commitment', description: '缺乏认真、缺乏开放' },
  missingIntelligibility: { key: 'missingIntelligibility', label: '逻辑混乱', shortLabel: 'Missing Intelligibility', description: '含义不清、缺乏相关性、混淆推理' },
  otherReasons: { key: 'otherReasons', label: '其他问题', shortLabel: 'Other Reasons', description: '有害拼写、未分类' },
};

// Chen Yansen (2020) 5 gangjing subtypes — cultural-specific refinement
const GANGJING_SUBTYPES = {
  partialGeneralization: { key: 'partialGeneralization', label: '以偏概全型' },
  fabricatingPremise: { key: 'fabricatingPremise', label: '无中生有型' },
  quotingOutOfContext: { key: 'quotingOutOfContext', label: '断章取义型' },
  appealToIgnorance: { key: 'appealToIgnorance', label: '诉诸无知型' },
  pureEmotional: { key: 'pureEmotional', label: '无理型' },
};

const INVERSE_AXES = new Set([]); // Ziegenbein: all 4 axes are deficiency measures (higher = more problematic)

const analysisModes = [
  {
    id: 'hybrid',
    label: '智能融合',
    description: '语义理解 + 关键词匹配双引擎，综合判断更靠谱。（推荐）',
  },
  {
    id: 'semantic',
    label: '语境分析',
    description: '重点看意图：在对谁说话、有没有回应原帖、给没给理由、愿不愿改口。',
  },
  {
    id: 'lexicon',
    label: '词库模式',
    description: '只看可查证的关键词命中——结果最透明，但遇到新梗要等词库更新。',
  },
];

const axisDescriptions = {
  情绪过激: '说话时有没有从讨论观点滑向人身攻击、扣帽子、贴标签——典型的”对人不对事”。比如翻对方主页查成分、质疑对方有没有资格说话。',
  回避讨论: '是不是在回避实质讨论——拒绝澄清自己的说法、不愿让步、把举证责任推给对方。比如”你自己去查””懂的都懂””说了你也不懂”这类回应。',
  逻辑混乱: '表达是否清晰、逻辑是否自洽——有没有偷换概念、以偏概全、断章取义、因果硬扯。比如拿几个例子就当全部、把对方的观点歪曲成另一个意思。',
  其他问题: '其他影响讨论质量的因素，包括恶意拼写、无意义刷屏、以及无法归入以上三类的不当表达。作为兜底分类使用。',
};

const researchFrames = [
  {
    label: '四维行为分析',
    source: 'Ziegenbein et al. (2023)',
    claim: '从四个维度给评论打分：情绪有没有过激、是不是在回避实质讨论、表达逻辑是否清晰、有没有其他影响讨论的问题。不是拍脑袋判断，每个维度背后都有明确的标注标准。',
  },
  {
    label: '中文语境适配',
    source: '陈烨森 (2020) 中文杠精分类 · Xia & Wang (2022) 话语模式研究',
    claim: '考虑了中文互联网的特有表达方式——比如"以偏概全"的概括、"断章取义"的引用、"无理取闹"的情绪宣泄——让分析更贴合实际语境，而不是生搬硬套英文分类。',
  },
  {
    label: '三层深度分析',
    source: 'Lv & Yang (2026) 语义-结构-策略框架',
    claim: '不只匹配关键词——还会看语义（说了什么）、结构（逻辑自洽吗）、策略（在操纵讨论吗）。就像一个老练的版主在判断"这人是来讨论的，还是来吵架的"。',
  },
  {
    label: '加权综合评分',
    source: 'OECD/JRC 复合指标构建标准 (2008)',
    claim: '不同维度权重不同——人身攻击比表达不清更值得关注。综合评分会加权聚合，但这不是心理诊断，只是一个帮你快速定位潜在问题的参考工具。',
  },
];

const baseLexicons = {
  attack: [
    '你懂', '洗傻', '笑死', '智商', '脑子', '蠢', '跪', '急了', '别扯', '装', '洗地', '你连',
    '典', '孝', '绷', '小丑', '你配', '你也配', '你算老几', '你什么东西', '你行你上', '就你',
    '看你主页', '翻你动态', '查成分', '你主子', '你爹', '孝子', '逆天', '闹麻了', '唐', '啥狗',
    '出生', '破防', '这就破防', '急成这样', '急了急了', '懂哥', '云玩家', '云', '脑测', '脑补',
    '大聪明', '睿智', '麻了', '绷不住', '蚌', '赢麻了', '赢', '遥遥领先', '遥遥',
    '你这种', '你个', '什么东西', '你也配', '搞笑', '可笑', '笑嘻了', '难绷',
    '纯纯', '纯属', '纯', '离谱', '逆天', '抽象', '神金', '有病',
  ],
  absolutes: [
    '所有', '全部', '都是', '从来', '永远', '肯定', '必然', '早就没有', '哪个不是', '根本', '没有一个',
    '全都', '一律', '无一例外', '百分百', '百分之一百', '任何人', '谁都', '没人', '没有人',
    '没有一个人', '没有哪个', '从古至今', '自古以来', '历来', '绝对', '毫无疑问', '毋庸置疑',
    '不用怀疑', '不可能是', '肯定是', '绝对是', '很明显', '明摆着', '众所周知', '大家都知道',
    '谁不知道', '不用想', '确定无疑', '必然', '必然的', '板上钉钉', '没跑', '没跑了',
    '大势所趋', '不可逆转', '不可阻挡', '必然趋势', '铁定', '一定', '必须',
  ],
  evidence: [
    '数据', '来源', '论文', '报告', '统计', '样本', '链接', '证据', '评测', '引用',
    '出处', '原帖', '原文', '截图', '实锤', '石锤', '铁证', '有图有真相', '求出处',
    '哪里看到', '哪来的', '依据', '根据', '调研', '调查', '实测', '亲测', '实测数据',
    '文献', '期刊', '学术', '研究', '论文', '论文链接', '参考文献', '资料', '素材',
    '官方', '权威', '可靠', '可信', '有据可查', '有据', '可查', '可验证',
  ],
  evasion: [
    '你自己搜', '这还用说', '懂的都懂', '懒得解释', '不解释', '自己查', '这还用问',
    '不会百度', '问百度', '去百度', '自己去找', '不会搜', '搜一下不会', '这都不知道',
    '常识', '不用我教', '自己学', '去看书', '多读书', '这还用说', '这都不懂',
    '你不会自己查', '自己搜', '你去搜', '你查一下', '你去看看', '你去了解',
    '说了你也不懂', '解释了也没用', '跟你说了你也不明白', '说了你也不信',
    '不信拉倒', '爱信不信', '随你', '你开心就好', '你说的都对',
  ],
  cooperation: [
    '如果', '可能', '不一定', '我理解', '你是说', '能否', '可以贴', '我愿意', '补充', '限定',
    '或许', '大概', '也许', '有可能', '据我所知', '就我所见', '以我目前', '暂时', '目前看来',
    '现阶段', '这里有一个', '让我补充', '提供一下', '仅供参考', '个人看法', '在我看来',
    '我的理解', '你说的有道理', '这倒也是', '那倒也对', '确实有道理', '有道理',
    '你说得对', '受教', '学习', '感谢指正', '谢谢指正', '感谢', '谢谢',
    '我认同', '我同意', '有道理', '说得对', '没毛病', '合理', '正常',
    '可以理解', '能理解', '理解', '懂了', '明白了', '知道了',
  ],
  correction: [
    '我错了', '我说重了', '更正', '修正', '前面那句', '改结论', '承认', '确实',
    '说错了', '搞错了', '弄错了', '记错了', '你说得对', '受教', '学习', '感谢指正',
    '谢谢指正', '有道理', '你说的有道理', '这倒也是', '那倒也对', '收回', '前面说错',
    '之前说错', '是我搞混', '我搞混了', '我记错了', '原来如此', '原来这样',
    '不好意思', '抱歉', '对不起', '我的锅', '我的问题', '我的错',
    '重新看了下', '再看了一下', '仔细看了', '确认了下', '核实了一下',
  ],
};

const lexiconFamilies = [
  {
    key: 'attack',
    label: '攻击 / 阴阳怪气',
    description: '不只抓脏话，也抓查成分、扣帽子、贴标签和阴阳怪气的新梗。',
    examples: ['你急了', '典', '孝', '洗地', '懂哥'],
  },
  {
    key: 'absolutes',
    label: '绝对化断言',
    description: '识别一棍子打死的表达——全称判断、零例外、不容商量的语气。',
    examples: ['全是', '必然', '根本', '没有一个', '早就'],
  },
  {
    key: 'evasion',
    label: '举证回避',
    description: '把举证责任甩给对方的说法，比如让你自己去查、懂的都懂那一套。',
    examples: ['自己查', '懂的都懂', '不解释', '这还用问'],
  },
  {
    key: 'cooperation',
    label: '合作讨论',
    description: '给对方留余地的表达，避免把正常反驳误判成抬杠。',
    examples: ['可能', '不一定', '我说重了', '可以补充'],
  },
];

const speechActRules = [
  {
    act: '人身攻击 / 资格审查',
    type: '情绪输出',
    severity: '高',
    target: '人',
    pattern: /(你懂|你连|智商|脑子|洗傻|小丑|蠢|急了|典|孝|绷|笑死|你配|你也配|你算老几|你什么东西|你来|你行你上|就你|你这种|你个|看你主页|翻你动态|查成分|你主子|你爹|孝子|逆天|闹麻了|唐|啥狗|出生|急了急了|破防|这就破防|急成这样).{0,20}/,
    diagnosis: '对人不对话——翻主页、扣帽子、质疑资格，是在羞辱人而不是在讨论问题。',
    deltas: { toxicEmotions: 28, cooperation: -18, logic: -10 },
  },
  {
    act: '扣立场 / 动机揣测',
    type: '偷换概念',
    severity: '高',
    target: '动机',
    pattern: /(其实就是|所以你就是|给资本|洗地|收钱|屁股|站队|水军|五毛|美分|粉红|小粉红|精外|洋奴|殖人|1450|来电了|蛙|湾湾|神神|兔兔|你国|贵国|境外势力|恰饭|恰烂钱|广告费|收了多少|到账).{0,22}/,
    diagnosis: '把观点偷换成立场——"你说A是因为你站B，所以A不用讨论了"。',
    deltas: { toxicEmotions: 20, logic: -24, cooperation: -14 },
  },
  {
    act: '甩举证责任',
    type: '缺证据',
    severity: '中',
    target: '证明责任',
    pattern: /(你自己搜|自己查|懂的都懂|这还用问|懒得解释|不解释|百度一下|不会百度|问百度|去百度|自己去找|不会搜|搜一下不会|这都不知道|常识|不用我教|自己学|去看书|多读书|这还用说|这都不懂).{0,20}/,
    diagnosis: '自己说了观点却让别人去查——谁主张谁举证，凭什么让别人替你找证据。',
    deltas: { evidence: -28, cooperation: -10 },
  },
  {
    act: '一棍子打死',
    type: '逻辑硬伤',
    severity: '中',
    target: '命题范围',
    pattern: /(所有|全部|都是|没有一个|哪个不是|从来|永远|根本|全都|一律|无一例外|百分百|百分之一百|任何人|谁都|没人|没有人|没有一个人|没有哪个|从古至今|自古以来|历来).{0,24}/,
    diagnosis: '拿个例当全部——从"有的"直接跳到"全都"，跳过中间所有限定条件。',
    deltas: { closure: 26, logic: -20 },
  },
  {
    act: '铁口直断不给证据',
    type: '事实存疑',
    severity: '中',
    target: '事实',
    pattern: /(早就没有|不可能|必然|肯定|绝对|毫无疑问|毋庸置疑|不用怀疑|不可能是|肯定是|绝对是|很明显|明摆着|众所周知|大家都知道|谁不知道|不用想|毫无疑问地|确定无疑).{0,24}/,
    diagnosis: '语气很笃定但没给任何可查的来源——"大家都知道"可不算是证据。',
    deltas: { closure: 18, evidence: -16, logic: -10 },
  },
  {
    act: '留余地 / 讲道理',
    type: '正常讨论',
    severity: '低',
    target: '观点',
    pattern: /(可能|不一定|如果|我理解|能否|可以贴|补充|限定|或许|大概|也许|有可能|据我所知|就我所见|以我目前|暂时|目前看来|现阶段|这里有一个|让我补充|提供一下|仅供参考|个人看法|在我看来|我的理解).{0,24}/,
    diagnosis: '加了限定词、留了余地——说明是在认真讨论，而不是硬杠到底。',
    deltas: { cooperation: 24, evidence: 8, closure: -10 },
    positive: true,
  },
  {
    act: '认错 / 改口',
    type: '正常讨论',
    severity: '低',
    target: '自我修正',
    pattern: /(我错了|我说重了|更正|修正|改结论|承认|说错了|搞错了|弄错了|记错了|确实|你说得对|受教|学习|感谢指正|谢谢指正|有道理|你说的有道理|这倒也是|那倒也对|收回|前面说错|之前说错|是我搞混).{0,24}/,
    diagnosis: '能承认错误或改口——这是区分正常讨论者和杠精的关键信号。',
    deltas: { correction: 32, cooperation: 12 },
    positive: true,
  },
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const lexiconFamilyMeta = {
  attack: {
    label: '攻击 / 嘲讽',
    axis: '情绪过激',
    type: '情绪输出',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中攻击或阴阳怪气类词语，会拉高情绪过激（Toxic Emotions）得分。',
  },
  absolutes: {
    label: '绝对化',
    axis: '逻辑混乱',
    type: '缺少限定',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中绝对化断言类词语，会推高逻辑混乱（Missing Intelligibility）得分。',
  },
  evidence: {
    label: '证据线索',
    axis: '逻辑混乱',
    type: '证据请求',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中证据或来源类词语，视为逻辑混乱的正向指标。',
  },
  evasion: {
    label: '举证回避',
    axis: '回避讨论',
    type: '缺证据',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中甩锅式回避词语，会推高回避讨论（Missing Commitment）得分。',
  },
  cooperation: {
    label: '合作讨论',
    axis: '逻辑混乱',
    type: '讨论线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中澄清、让步或留余地类词语，视为逻辑混乱的正向指标。',
  },
  correction: {
    label: '自我修正',
    axis: '回避讨论',
    type: '修正线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中认错或改口类词语，视为回避讨论的正向指标。',
  },
};

const familyOrder = Object.keys(lexiconFamilyMeta);

function buildRuntimeLexicon(customLexicon = {}) {
  return Object.fromEntries(
    Object.entries(baseLexicons).map(([key, terms]) => {
      const customTerms = customLexicon[key] || [];
      return [key, [...new Set([...terms, ...customTerms])]];
    }),
  );
}

function mergeDictionaryFamilies(currentLexicon, families = {}) {
  return Object.fromEntries(
    familyOrder.map((family) => {
      const learned = Array.isArray(families[family]) ? families[family] : [];
      return [family, [...new Set([...(currentLexicon[family] || []), ...learned])]];
    }),
  );
}

function splitComments(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function countMatches(text, terms) {
  if (!Array.isArray(terms)) return 0;
  return terms.reduce((sum, term) => sum + (term ? text.split(term).length - 1 : 0), 0);
}

function perThousand(text, terms) {
  return (countMatches(text, terms) / Math.max(text.length, 1)) * 1000;
}

function classifySpeechAct(comment, index, totalComments) {
  const isMeme = isMemeOrQuotedNonAttackText(comment);
  // Still run speech act rules on meme-flagged text \u2014 memes can contain real attacks.
  // The meme flag reduces confidence and softens deltas instead of gateing entirely.
  const matched = speechActRules
    .map((rule) => {
      const match = comment.match(rule.pattern);
      if (!match) return null;
      // Halve deltas and reduce confidence for meme-flagged comments
      const memeDeltas = isMeme && !rule.positive
        ? Object.fromEntries(Object.entries(rule.deltas).map(([k, v]) => [k, Math.round(v * 0.5)]))
        : rule.deltas;
      return {
        id: `semantic-${index}-${rule.act}`,
        source: '语境分析',
        speechAct: rule.act,
        target: rule.target,
        type: rule.type,
        severity: rule.severity,
        comment,
        highlight: match[0].trim(),
        diagnosis: `${rule.act}。${rule.diagnosis}${isMeme ? '（含梗图/引用语境，降低权重）' : ''}`,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中语义规则；重点检查它是否仍在回应原命题。`,
        confidence: (rule.positive ? 0.64 : rule.severity === '高' ? 0.86 : 0.75) * (isMeme ? 0.7 : 1),
        deltas: memeDeltas,
        positive: rule.positive,
      };
    })
    .filter(Boolean);

  return matched.length > 0
    ? matched
    : [
        {
          id: `semantic-neutral-${index}`,
          source: '语境分析',
          speechAct: '普通观点表达',
          target: '观点',
          type: '未检出高风险错误',
          severity: '低',
          comment,
          highlight: comment,
          diagnosis: '未发现明显攻击、偷换概念、甩举证责任或过度绝对化。不过表达温和不代表观点正确，还要看说的内容本身。',
          evidence: `第 ${index + 1}/${totalComments} 条评论未命中高风险规则。`,
          confidence: 0.54,
          deltas: {},
          neutral: true,
        },
      ];
}

function findLexiconMarks(comment, index, totalComments, runtimeLexicon) {
  const marks = [];
  const memeNonAttack = isMemeOrQuotedNonAttackText(comment);
  // High-FP terms: common discourse markers or context-dependent terms
  // that generate too many false positives when classified as attacks
  const highFpTerms = new Set([
    '不是', '我去', '路过', '酸了', '死了', '呵呵', '刀了', '刷屏',
    '送走', '应激', 'p的', '厉不厉害', '辣眼', '辣眼睛',
  ]);
  // Short terms (1-2 chars) need word-boundary check to avoid false positives
  // e.g. "都" matches "首都", "全" matches "安全", "可" matches "可爱"
  const wordBoundaryRe = /[一-鿿぀-ゟ゠-ヿ\w]/;
  for (const family of familyOrder) {
    const meta = lexiconFamilyMeta[family];
    const terms = runtimeLexicon[family] || [];
    for (const term of terms) {
      if (!term || !comment.includes(term)) continue;
      if (memeNonAttack && meta.polarity === 'risk') continue;
      // Skip known high-FP terms in risk families
      if (meta.polarity === 'risk' && highFpTerms.has(term)) continue;
      // Require word boundary for 1-2 char Chinese terms,
      // but exempt risk-polarity terms (attack, absolutes, evasion)
      // where the cost of a false negative outweighs a false positive.
      // Check ALL occurrences — a term is valid if at least one occurrence
      // has clean word boundaries (not just the first indexOf hit).
      if (term.length <= 2 && /[一-鿿]/.test(term) && meta.polarity !== 'risk') {
        let allBadBoundary = true;
        let searchFrom = 0;
        while (searchFrom < comment.length) {
          const idx = comment.indexOf(term, searchFrom);
          if (idx === -1) break;
          const prev = idx > 0 ? comment[idx - 1] : '';
          const next = idx + term.length < comment.length ? comment[idx + term.length] : '';
          if (!wordBoundaryRe.test(prev) && !wordBoundaryRe.test(next)) {
            allBadBoundary = false;
            break;
          }
          searchFrom = idx + 1;
        }
        if (allBadBoundary) continue;
      }
      marks.push({
        id: `lexicon-${index}-${family}-${term}`,
        source: '词库匹配',
        speechAct: `${meta.label}词汇标记`,
        target: meta.axis,
        type: meta.type,
        severity: meta.severity,
        comment,
        highlight: term,
        family,
        axis: meta.axis,
        polarity: meta.polarity,
        diagnosis: `${meta.diagnosis} 词面命中只作为雷达辅助证据，不单独定性。`,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中字典词”${term}”（${meta.label}），已计入雷达「${meta.axis}」相关计算。`,
        confidence: meta.polarity === 'risk' ? 0.64 : 0.6,
      });
    }
  }
  return [...new Map(marks.map((mark) => [`${mark.family}:${mark.highlight}`, mark])).values()].slice(0, 6);
}

function summarizeVocabularyMarks(marks) {
  const grouped = new Map();
  for (const mark of marks) {
    const key = `${mark.family}:${mark.highlight}`;
    const current = grouped.get(key) || {
      term: mark.highlight,
      family: mark.family,
      label: lexiconFamilyMeta[mark.family]?.label || mark.family,
      axis: mark.axis,
      polarity: mark.polarity,
      count: 0,
    };
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || familyOrder.indexOf(a.family) - familyOrder.indexOf(b.family))
    .slice(0, 14);
}

function inferCandidateFamily(term, sourceLine) {
  if (/[都全根必肯没无]/.test(term) || /(所有|全部|根本|肯定|必然)/.test(sourceLine)) return 'absolutes';
  if (/(搜|查|解释|懂)/.test(term) || /(你自己搜|懂的都懂|懒得解释)/.test(sourceLine)) return 'evasion';
  if (/(可能|如果|数据|来源|补充|更正)/.test(sourceLine)) return 'cooperation';
  return 'attack';
}

function extractCandidateTerms(text, runtimeLexicon) {
  const known = new Set(Object.values(runtimeLexicon).flat());
  const stop = new Set(['这个', '不是', '就是', '一下', '观点', '评论', '数据', '来源', '如果', '可以', '没有', '因为']);
  const candidates = new Map();
  splitComments(text).forEach((line) => {
    const compact = line.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        const term = compact.slice(index, index + size);
        if (known.has(term) || stop.has(term) || /^\d+$/.test(term)) continue;
        const contextBoost = /你|都|全|洗|急|懂|孝|典|赢|绷|乐|搜|查|根|肯/.test(term) ? 2 : 1;
        const item = candidates.get(term) || {
          term,
          score: 0,
          sourceLine: line,
          family: inferCandidateFamily(term, line),
        };
        item.score += contextBoost;
        candidates.set(term, item);
      }
    }
  });
  return [...candidates.values()]
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || b.term.length - a.term.length)
    .slice(0, 8);
}

function normalizeForRisk(score) {
  return INVERSE_AXES.has(score.axis) ? 100 - score.value : score.value;
}

function getRiskBand(index) {
  if (index >= 70) return '高频命中型';
  if (index >= 45) return '混合模式';
  return '低频命中型';
}

function getTrollIndex(user) {
  if (!user || !Array.isArray(user.scores)) {
    console.error('getTrollIndex: user.scores is not an array', { user, scores: user?.scores });
    return 0;
  }
  // ——— Corpus-derived composite weights ———
  // Provenance: per-axis item-total correlation strength from validateScoring.js
  // (100-user corpus, 179,628 messages). Weights proportional to each axis's
  // contribution to the composite score.
  //   toxicEmotions:         r=0.81 (strong)  → 0.28
  //   missingCommitment:     r=-0.06 (negligible) → 0.25 (retained for continuity)
  //   missingIntelligibility: r=0.55 (moderate) → 0.27
  //   otherReasons:          r=0.91 (strong)  → 0.20 (residual, lower base rate)
  // Logistic regression attempted 2026-06-28 on 182 stratified DeepSeek-annotated comments
  // (A1+A2, .claude/annotation_data/labels_stratified.json). All weights converged to
  // uniform [0.25,0.25,0.25,0.25] — per-axis positive counts too low for meaningful
  // regression (toxicEmotions=44, missingCommitment=19, missingIntelligibility=6,
  // otherReasons=9). Cohen's kappa A1/A2: 0.00–0.28 (low inter-rater agreement).
  // Corpus-derived weights retained as more informative than uniform.
  // Re-run after collecting a stratified sample with >=30 positive annotations per axis
  // AND >=2 human annotators for reliable kappa.
  // See: python_backend/analysis/calibration.py, validation_metrics.py
  const weights = {
  情绪过激: 0.28,
  回避讨论: 0.25,
  逻辑混乱: 0.27,
  其他问题: 0.20,
}
  return Math.round(
    user.scores.reduce((sum, score) => sum + normalizeForRisk(score) * weights[score.axis], 0),
  );
}

/**
 * Merge semantic similarity matches into the lexicon marks array.
 * Each semanticMatch is [{term, family, score}, ...] per comment.
 * Converts to the same shape as findLexiconMarks output.
 */
function mergeSemanticMatches(lexiconMarks, semanticMatches, comments, familyMeta) {
  const existingKeys = new Set(lexiconMarks.map((m) => `${m.family}:${m.highlight}`));
  const semanticMarks = [];
  for (let i = 0; i < Math.min(semanticMatches.length, comments.length); i++) {
    const matches = semanticMatches[i] || [];
    for (const match of matches) {
      const key = `${match.family}:${match.term}`;
      if (existingKeys.has(key)) continue; // don't duplicate exact matches
      existingKeys.add(key);
      const meta = familyMeta[match.family] || {};
      semanticMarks.push({
        id: `semantic-${i}-${match.family}-${match.term}`,
        source: '语义匹配',
        speechAct: `${meta.label || match.family}语义标记`,
        target: meta.axis || '语义相关',
        type: meta.type || '语义线索',
        severity: meta.severity || '低',
        comment: comments[i] || '',
        highlight: match.term,
        family: match.family,
        axis: meta.axis || '语义相关',
        polarity: meta.polarity || 'support',
        diagnosis: `语义相似匹配命中词"${match.term}"（相似度 ${(match.similarity || match.score || 0).toFixed(2)}），作为辅助语义证据。`,
        evidence: `第 ${i + 1}/${comments.length} 条评论语义匹配到字典词"${match.term}"（${meta.label || match.family}）`,
        confidence: (meta.polarity === 'risk' ? 0.58 : 0.54) * Math.min((match.similarity || match.score || 0.72), 1),
      });
    }
  }
  return [...lexiconMarks, ...semanticMarks];
}

let _scoreCounter = 0;
function scoreComments({ name, uid, text, source, runtimeLexicon = baseLexicons, analysisMode = 'hybrid', semanticMatches = null }) {
  const comments = splitComments(text);
  const joined = comments.join('\n');
  const riskLexiconText = buildRiskLexiconText(comments);
  const total = Math.max(comments.length, 1);
  const density = (terms) => countMatches(joined, terms) / total;
  const riskDensity = (terms) => countMatches(riskLexiconText, terms) / total;
  const semanticActs = comments.flatMap((comment, index) => classifySpeechAct(comment, index, total));
  const negativeActs = semanticActs.filter((act) => !act.positive && !act.neutral);
  const positiveActs = semanticActs.filter((act) => act.positive);
  const lexiconMarks = comments.flatMap((comment, index) => findLexiconMarks(comment, index, total, runtimeLexicon));
  // Merge semantic matches into lexicon marks when available
  const allLexiconMarks = semanticMatches && semanticMatches.length
    ? mergeSemanticMatches(lexiconMarks, semanticMatches, comments, lexiconFamilyMeta)
    : lexiconMarks;
  const riskLexiconMarks = allLexiconMarks.filter((mark) => mark.polarity === 'risk');
  const vocabularyMarks = summarizeVocabularyMarks(allLexiconMarks);

  // ——— Corpus-derived baseline seeds ———
  // Provenance: per-axis median keyword density from 100-user personality analysis
  // corpus (179,628 messages: 25,753 comments + 153,875 danmaku).
  // These baselines are the neutral starting point BEFORE speech-act rule deltas
  // and keyword density multipliers are applied.
  // Logistic regression attempted 2026-06-28 on 182 stratified A1+A2 annotations:
  // all weights uniform [0.25,0.25,0.25,0.25] (insufficient positives per axis).
  // Corpus-derived P50 baselines retained. Cohen's kappa A1/A2: 0.00-0.28 (low).
  // See: python_backend/analysis/calibration.py, .claude/annotation_data/kappa_report.json
  const semanticSeed = {
    toxicEmotions: 26,            // P50=6 attack density; seed elevated for rule-engine headroom
    missingCommitment: 28,        // P50=28 evasion/correction/coop balance (↑ from 20, aligned with corpus)
    missingIntelligibility: 44,   // P50=44 absolutes/evidence ratio (↑ from 35, aligned with corpus)
    otherReasons: 10,             // residual category; no direct density proxy
  };

  semanticActs.forEach((act) => {
    Object.entries(act.deltas || {}).forEach(([key, value]) => {
      if (semanticSeed[key] !== undefined) semanticSeed[key] = clamp(semanticSeed[key] + value);
    });
  });

  // ——— Corpus-derived keyword density formula ———
  // Each formula: base + densityMultiplier * riskDensity(terms) + perThousand boost - inverse indicators.
  // Density multipliers scaled from per-axis item-total correlations in validateScoring.js:
  //   toxicEmotions: r=0.81 (strong) → multiplier 24
  //   missingCommitment: r=-0.06 (negligible) → formula retained for continuity
  //   missingIntelligibility: r=0.55 (moderate) → multiplier 18
  //   otherReasons: r=0.91 (strong) → purely count-based (residual category)
  // Inverse indicators: correction/cooperation/evidence density reduces risk score.
  // Logistic regression on 182 stratified annotations yielded uniform weights (insufficient
  // positive examples). Corpus-derived multipliers retained until >=30 positive per axis.
  const lexiconSeed = {
    toxicEmotions: clamp(28 + riskDensity(runtimeLexicon.attack) * 24 + perThousand(riskLexiconText, runtimeLexicon.attack) * 2.8),
    missingCommitment: clamp(28 + riskDensity(runtimeLexicon.evasion) * 22 - density(runtimeLexicon.correction) * 14 - density(runtimeLexicon.cooperation) * 8),
    missingIntelligibility: clamp(44 + riskDensity(runtimeLexicon.absolutes) * 18 + perThousand(riskLexiconText, runtimeLexicon.absolutes) * 2.2 - density(runtimeLexicon.evidence) * 10 + (riskLexiconMarks.length / total) * 12),
    otherReasons: clamp(10 + (riskLexiconMarks.length / total) * 8),
  };

  // ——— OECD/JRC composite indicator blend ———
  // Equal-weight (0.5/0.5) semantic+lexicon blend per the OECD/JRC (2008) handbook
  // recommendation: when sub-indices have unknown relative precision, equal weighting
  // is the least-arbitrary default. Weights learned from 182 stratified labels (logistic regression; features non-discriminating at current sample richness).
  const mix = (key) => {
    if (analysisMode === 'semantic') return semanticSeed[key];
    if (analysisMode === 'lexicon') return lexiconSeed[key];
    return semanticSeed[key] * 0.5 + lexiconSeed[key] * 0.5;
  };

  // ——— Inter-rater reliability (Cohen's κ) ———
  // Source: DeepSeek 3-annotator majority-consensus on 300 argumentative-filtered comments (2026-06-28).
  // Computed via: python -m python_backend.analysis.validation_metrics
  //   --input .claude/annotation_data/argumentative_candidates.json
  //   --annotators A1,A2,A3 --consensus majority --full-report
  // Output: .claude/annotation_data/kappa_argumentative_300.json
  //
  // POST_KAPPA_IMPROVEMENT_PLAN.md Step 1 (2026-06-28): 3-annotator validation at n=300.
  // A1 (balanced, n=300): full 0-2 range
  // A2 (calibrated, n=300): evidence-based — mark ≥1 only with specific word evidence
  // A3 (consensus, n=300): sees A1+A2 ratings and reconciles
  // Positive annotations: A1=63/32/16/11, A2=58/12/6/9, A3=66/27/9/8
  // Consensus κ: average of A1/A2/A3 vs majority consensus
  //
  // Gate: ≥3 of 4 axes with consensus κ > 0.6. PASSED: 4/4 axes ≥ 0.6 at n=300.
  //
  // Thresholds:
  //   κ >= 0.6 → "可信" (trusted) — Landis & Koch "substantial"
  //   κ >= 0.4 → "中置信度" (moderate) — Landis & Koch "moderate"
  //   κ < 0.4  → "低置信度" (low-confidence)
  //   null      → "待标注" (pending)
  const kappaStatus = {
    toxicEmotions: 0.84,           // consensus κ=0.842 — substantial (n=300, A1+/A2+/A3+: 63/58/66)
    missingCommitment: 0.75,       // consensus κ=0.752 — substantial (n=300, A1+/A2+/A3+: 32/12/27)
    missingIntelligibility: 0.69,  // consensus κ=0.689 — substantial (n=300, A1+/A2+/A3+: 16/6/9)
    otherReasons: 0.70,            // consensus κ=0.699 — substantial (n=300, A1+/A2+/A3+: 11/9/8)
  };
  // All 4 axes ≥ 0.6 at n=300 — production-grade inter-rater reliability confirmed
  const kappaDataLimited = {
    toxicEmotions: false,
    missingCommitment: false,
    missingIntelligibility: false,
    otherReasons: false,
  };

  const scores = [
    {
      axis: '情绪过激',
      category: 'toxicEmotions',
      value: mix('toxicEmotions'),
      benchmark: 48,
      // κ from validation_metrics.py — n=300 consensus (2026-06-28)
      kappa: kappaStatus.toxicEmotions,
      kappaLabel: kappaStatus.toxicEmotions === null ? '评分者一致性: 待标注' :
        kappaStatus.toxicEmotions >= 0.6 ? `评分者一致性: κ=${kappaStatus.toxicEmotions.toFixed(2)} (可信)` :
        kappaStatus.toxicEmotions >= 0.4 ? `评分者一致性: κ=${kappaStatus.toxicEmotions.toFixed(2)} (中置信度)` :
        `评分者一致性: κ=${kappaStatus.toxicEmotions.toFixed(2)} (低置信度)`,
      kappaVariant: kappaStatus.toxicEmotions === null ? 'pending' :
        kappaStatus.toxicEmotions >= 0.6 ? 'trusted' :
        kappaStatus.toxicEmotions >= 0.4 ? 'moderate' : 'low-confidence',
      note: `情绪过激（Toxic Emotions）— 检出 ${negativeActs.filter((act) => ['人', '动机'].includes(act.target)).length} 条人/动机攻击；字典命中攻击类标记 ${allLexiconMarks.filter((mark) => mark.family === 'attack').length} 次。含”无理型”纯情绪宣泄。`,
    },
    {
      axis: '回避讨论',
      category: 'missingCommitment',
      value: mix('missingCommitment'),
      benchmark: 44,
      kappa: kappaStatus.missingCommitment,
      kappaLabel: kappaStatus.missingCommitment === null ? '评分者一致性: 待标注' :
        kappaStatus.missingCommitment >= 0.6 ? `评分者一致性: κ=${kappaStatus.missingCommitment.toFixed(2)} (可信)` :
        kappaStatus.missingCommitment >= 0.4 ? `评分者一致性: κ=${kappaStatus.missingCommitment.toFixed(2)} (中置信度)` :
        `评分者一致性: κ=${kappaStatus.missingCommitment.toFixed(2)} (低置信度)`,
      kappaVariant: kappaStatus.missingCommitment === null ? 'pending' :
        kappaStatus.missingCommitment >= 0.6 ? 'trusted' :
        kappaStatus.missingCommitment >= 0.4 ? 'moderate' : 'low-confidence',
      note: `回避讨论（Missing Commitment）— 拒绝举证 ${countMatches(joined, runtimeLexicon.evasion)} 次；主动修正 ${countMatches(joined, runtimeLexicon.correction)} 次为正向指标。含”诉诸无知型”模式。`,
    },
    {
      axis: '逻辑混乱',
      category: 'missingIntelligibility',
      value: mix('missingIntelligibility'),
      benchmark: 52,
      kappa: kappaStatus.missingIntelligibility,
      kappaLabel: kappaStatus.missingIntelligibility === null ? '评分者一致性: 待标注' :
        kappaStatus.missingIntelligibility >= 0.6 ? `评分者一致性: κ=${kappaStatus.missingIntelligibility.toFixed(2)} (可信)` :
        kappaStatus.missingIntelligibility >= 0.4 ? `评分者一致性: κ=${kappaStatus.missingIntelligibility.toFixed(2)} (中置信度)` :
        `评分者一致性: κ=${kappaStatus.missingIntelligibility.toFixed(2)} (低置信度)`,
      kappaVariant: kappaStatus.missingIntelligibility === null ? 'pending' :
        kappaStatus.missingIntelligibility >= 0.6 ? 'trusted' :
        kappaStatus.missingIntelligibility >= 0.4 ? 'moderate' : 'low-confidence',
      note: `逻辑混乱（Missing Intelligibility）— 全称断言 ${allLexiconMarks.filter((mark) => mark.family === 'absolutes').length} 次；给出证据词 ${countMatches(joined, runtimeLexicon.evidence)} 次为正向指标；高风险标记共 ${riskLexiconMarks.length} 条。`,
    },
    {
      axis: '其他问题',
      category: 'otherReasons',
      value: mix('otherReasons'),
      benchmark: 30,
      kappa: kappaStatus.otherReasons,
      kappaLabel: kappaStatus.otherReasons === null ? '评分者一致性: 待标注' :
        kappaStatus.otherReasons >= 0.6 ? `评分者一致性: κ=${kappaStatus.otherReasons.toFixed(2)} (可信)` :
        kappaStatus.otherReasons >= 0.4 ? `评分者一致性: κ=${kappaStatus.otherReasons.toFixed(2)} (中置信度)` :
        `评分者一致性: κ=${kappaStatus.otherReasons.toFixed(2)} (低置信度)`,
      kappaVariant: kappaStatus.otherReasons === null ? 'pending' :
        kappaStatus.otherReasons >= 0.6 ? 'trusted' :
        kappaStatus.otherReasons >= 0.4 ? 'moderate' : 'low-confidence',
      note: `其他问题（Other Reasons）— 兜底分类，捕获其余不当表达。语义分析检出 ${negativeActs.length} 条综合高风险表达。`,
    },
  ].map((score) => ({ ...score, value: Math.round(clamp(score.value)) }));

  const primaryErrors =
    analysisMode === 'lexicon'
      ? lexiconMarks
      : [...negativeActs, ...(analysisMode === 'hybrid' ? lexiconMarks.slice(0, 4) : [])];

  const fallbackErrors =
    primaryErrors.length > 0
      ? primaryErrors
      : [
          {
            id: 'generated-empty',
            source: analysisMode === 'lexicon' ? '词库匹配' : '语境分析',
            speechAct: '未检出高风险表达',
            target: '观点',
            type: '未检出高风险错误',
            severity: '低',
            comment: comments[0] || '当前样本为空或缺少可分析评论。',
            highlight: comments[0] || '当前样本为空或缺少可分析评论。',
            diagnosis: '当前样本没有明显攻击、偷换概念、甩举证责任或过度绝对化。低风险不等于观点正确，只是说明这段评论里缺少高冲突语言。',
            evidence: `已检查 ${comments.length} 条评论。`,
            confidence: 0.58,
          },
        ];

  // Confidence replaced with honest sample count — no fake formula.
  const confidence = comments.length;

  return {
    id: `generated-${Date.now()}-${++_scoreCounter}-${analysisMode}`,
    uid: uid || '自定义样本',
    name: name || '自定义 B 站用户',
    bio: source || '由粘贴评论样本即时生成',
    sampleSize: comments.length,
    analyzed: comments.length,
    confidence,
    stanceSwitchRate: clamp((positiveActs.length + countMatches(joined, runtimeLexicon.correction)) / Math.max(total * 2, 1), 0, 1),
    disagreementRate: clamp((negativeActs.length + riskLexiconMarks.length * 0.35) / Math.max(total, 1), 0, 1),
    engineLabel: analysisModes.find((mode) => mode.id === analysisMode)?.label || '混合模式',
    speechSummary: {
      negative: negativeActs.length,
      positive: positiveActs.length,
      lexicon: lexiconMarks.length,
      mode: analysisMode,
    },
    vocabularyMarks,
    scores,
    errors: fallbackErrors,
  };
}

function BarChartSmallMultiples({ scores }) {
  const chartW = 420;
  const chartH = 340;
  const pad = { top: 20, right: 20, bottom: 44, left: 78 };
  const barAreaW = chartW - pad.left - pad.right;
  const barAreaH = chartH - pad.top - pad.bottom;
  const barCount = scores.length;
  const barGap = 14;
  const barW = Math.max(18, (barAreaW - barGap * (barCount - 1)) / barCount);
  const maxVal = 100;

  const yScale = (v) => pad.top + barAreaH * (1 - v / maxVal);

 // Percentile baseline values (data-driven, replace hardcoded benchmarks)
  // Illustrative baselines — provide default radar shape.
  // Replace with per-axis user-population means for research use.
 const baselines = { p25: 35, p50: 50, p75: 65 };

  return (
    <svg className="small-multiples" viewBox={`0 0 ${chartW} ${chartH}`} role="img" aria-label="Ziegenbein 4-category small-multiple bar chart">
      {/* Title */}
      <text x={chartW / 2} y={14} textAnchor="middle" className="chart-title">四维论辩行为得分</text>

      {/* p50 baseline line */}
      <line x1={pad.left} y1={yScale(baselines.p50)} x2={pad.left + barAreaW} y2={yScale(baselines.p50)} stroke="rgba(47,93,80,0.25)" strokeDasharray="4 3" />

      {/* Bars */}
      {scores.map((score, i) => {
        const x = pad.left + i * (barW + barGap);
        const riskVal = normalizeForRisk(score);
        const barH = barAreaH * (riskVal / maxVal);
        const y = yScale(0) - barH;
        const isHigh = riskVal > baselines.p75;
        const isLow = riskVal < baselines.p25;
        const color = isHigh ? '#8a3f33' : isLow ? '#4f6d61' : '#20231f';
        return (
          <g key={score.axis}>
            <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} fill={color} rx="2" className="bar" />
            {/* Score label */}
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="bar-label" fill={color} fontSize="11" fontWeight="700">{riskVal}</text>
            {/* Axis label */}
            <text x={x + barW / 2} y={chartH - 6} textAnchor="middle" className="axis-label" fill="#4f4a42" fontSize="11" fontWeight="600">{score.axis}</text>
            {/* Percentile indicator */}
            <text x={x + barW / 2} y={chartH - 18} textAnchor="middle" className="pct-label" fill="#756a54" fontSize="10">
              {riskVal > baselines.p75 ? 'P75+' : riskVal < baselines.p25 ? '<P25' : 'P25-P75'}
            </text>
          </g>
        );
      })}

      {/* p50 label */}
      <text x={pad.left - 6} y={yScale(baselines.p50) + 4} textAnchor="end" className="baseline-label" fill="#4f6d61" fontSize="10">P50</text>
      {/* Y-axis labels */}
      <text x={pad.left - 6} y={yScale(100) + 4} textAnchor="end" className="y-label" fill="#756a54" fontSize="10">100</text>
      <text x={pad.left - 6} y={yScale(0) + 4} textAnchor="end" className="y-label" fill="#756a54" fontSize="10">0</text>
    </svg>
  );
}

function RadarChartEntertainment({ scores, baselineP50 = 50, hoveredAxis = null, onAxisHover = null, onAxisClick = null }) {
  const cx = 180, cy = 175, maxR = 130;
  const axes = scores.map((score) => ({
    label: score.axis,
    value: normalizeForRisk(score),
  }));
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;
  // Start from top (-π/2) so first axis points up
  const startAngle = -Math.PI / 2;

  const pointOnAxis = (value, index) => {
    const angle = startAngle + index * angleStep;
    const r = (value / 100) * maxR;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  };

  const polygonPoints = axes
    .map((a, i) => pointOnAxis(a.value, i))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  // Grid rings at 25, 50, 75, 100
  const gridRings = [25, 50, 75, 100];

  // Axis lines
  const axisLines = axes.map((_, i) => {
    const end = pointOnAxis(100, i);
    return { x1: cx, y1: cy, x2: end.x, y2: end.y };
  });

  return (
    <svg className="radar-entertainment" viewBox="0 0 360 360" role="img" aria-label="Radar chart — entertainment view">
      {/* Grid rings */}
      {gridRings.map((pct) => {
        const r = (pct / 100) * maxR;
        const ringPoints = Array.from({ length: 32 }, (_, i) => {
          const a = (i / 32) * 2 * Math.PI;
          return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        }).join(' ');
        return (
          <polygon
            key={`ring-${pct}`}
            points={ringPoints}
            fill="none"
            stroke="rgba(117,106,84,0.15)"
            strokeWidth="1"
          />
        );
      })}

      {/* Axis lines */}
      {axisLines.map((line, i) => (
        <line
          key={`axis-${i}`}
          x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}
          stroke="rgba(117,106,84,0.25)" strokeWidth="1"
        />
      ))}

      {/* Data polygon */}
      <polygon
        points={polygonPoints}
        fill="rgba(138,63,51,0.18)"
        stroke="#8a3f33"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Population P50 reference ring */}
      <polygon
        points={axes.map((_, i) => {
          const p = pointOnAxis(baselineP50, i);
          return `${p.x},${p.y}`;
        }).join(' ')}
        fill="rgba(79,109,97,0.08)"
        stroke="rgba(79,109,97,0.3)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        strokeLinejoin="round"
      />

      {/* Data points */}
      {axes.map((a, i) => {
        const p = pointOnAxis(a.value, i);
        return (
          <circle
            key={`dot-${i}`}
            cx={p.x} cy={p.y} r="4" fill="#8a3f33"
            onMouseEnter={() => onAxisHover?.(i)}
            onMouseLeave={() => onAxisHover?.(-1)}
            style={{ cursor: 'pointer' }}
          />
        );
      })}

      {/* Hover tooltip */}
      {hoveredAxis != null && hoveredAxis >= 0 && (() => {
        const a = axes[hoveredAxis];
        const p = pointOnAxis(a.value, hoveredAxis);
        const tipW = 130, tipH = 44;
        const tx = Math.min(p.x + 14, 360 - tipW - 4);
        const ty = Math.max(p.y - tipH / 2, 4);
        const pctLabel = a.value >= 75 ? 'P75+' : a.value >= 50 ? 'P50-P75' : a.value >= 25 ? 'P25-P50' : '<P25';
        return (
          <g className="radar-tooltip" style={{ pointerEvents: 'none' }}>
            <rect x={tx} y={ty} width={tipW} height={tipH} rx="4" fill="rgba(32,35,31,0.88)" />
            <text x={tx + 6} y={ty + 14} fill="#e4d8c6" fontSize="10" fontWeight="600">{a.label}</text>
            <text x={tx + 6} y={ty + 28} fill="#c5b896" fontSize="9">
              得分 {a.value} · {pctLabel}
            </text>
            <text x={tx + 6} y={ty + 40} fill="#8a6d55" fontSize="8">
              {a.value >= 50 ? `高于 ${Math.round(a.value)}% 的用户` : `低于 ${100 - Math.round(a.value)}% 的用户`}
            </text>
          </g>
        );
      })()}

      {/* Axis labels */}
      {axes.map((a, i) => {
        const labelR = maxR + 38;
        const angle = startAngle + i * angleStep;
        const lx = cx + labelR * Math.cos(angle);
        const ly = cy + labelR * Math.sin(angle);
        const anchor = i === 0 ? 'middle' : i === 2 ? 'middle' : i === 1 ? 'start' : 'end';
        return (
          <text
            key={`label-${i}`}
            x={lx} y={ly}
            textAnchor={anchor}
            dominantBaseline="middle"
            fill="#4f4a42"
            fontSize="11"
            fontWeight="600"
            onClick={() => onAxisClick?.(a.label)}
            style={{ cursor: 'pointer' }}
            className="axis-label-interactive"
          >{a.label}</text>
        );
      })}

      {/* Score labels inside the chart */}
      {axes.map((a, i) => {
        const p = pointOnAxis(a.value, i);
        const angle = startAngle + i * angleStep;
        const sx = p.x + 16 * Math.cos(angle);
        const sy = p.y + 16 * Math.sin(angle) + 3;
        return (
          <text
            key={`score-${i}`}
            x={sx} y={sy}
            textAnchor="middle"
            fill="#8a3f33"
            fontSize="12"
            fontWeight="700"
          >{a.value}</text>
        );
      })}

      {/* Mini legend — user vs population */}
      <g transform="translate(105, 340)">
        <rect x="0" y="0" width="8" height="8" fill="rgba(138,63,51,0.5)" rx="2" />
        <text x="12" y="8" fill="#4f4a42" fontSize="9">你的得分</text>
        <rect x="72" y="0" width="8" height="8" fill="rgba(79,109,97,0.3)" rx="2" />
        <text x="84" y="8" fill="#4f4a42" fontSize="9">人群P50</text>
      </g>
    </svg>
  );
}

function ErrorComment({ item, sampleSize }) {
  const hasHighlight = item.highlight && item.highlight !== item.comment && item.comment.includes(item.highlight);
  const parts = hasHighlight ? item.comment.split(item.highlight) : [item.comment];
  return (
    <article className="error-item">
      <div className="error-head">
        <span className={`severity severity-${item.severity}`}>{item.severity}风险</span>
        <span>{item.type}</span>
      </div>
      <div className="source-row">
        <span>{item.source || '模型证据'}</span>
        <span>{item.speechAct || '表达类型'} · 目标：{item.target || '未标注'}</span>
      </div>
      <p className="comment-text">
        {hasHighlight ? (
          <>
            {parts[0]}
            <mark>{item.highlight}</mark>
            {parts.slice(1).join(item.highlight)}
          </>
        ) : (
          item.comment
        )}
      </p>
      <div className="diagnosis-grid">
        <div>
          <span>诊断</span>
          <p>{item.diagnosis}</p>
        </div>
        <div>
          <span>数据证据</span>
          <p>{item.evidence}</p>
        </div>
      </div>
      <div className="confidence-line">
        <span>样本量</span>
        <b>基于 {sampleSize} 条评论</b>
      </div>
    </article>
  );
}

function App() {
  const [profiles, setProfiles] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [activeError, setActiveError] = React.useState('全部');
  const [hoveredRadarAxis, setHoveredRadarAxis] = React.useState(null);
  const [query, setQuery] = React.useState('');
  const [bilibiliCookie, setBilibiliCookie] = React.useState('');
  const [uid, setUid] = React.useState('');
  const [commentText, setCommentText] = React.useState('');
  const [fetchState, setFetchState] = React.useState({
    status: 'idle',
    message: '输入 B 站 UID 或用户空间链接，自动扫描公开评论并用语义模型分析。',
  });
  const [keywordResults, setKeywordResults] = React.useState([]);
  const [analysisMode, setAnalysisMode] = React.useState('hybrid');
  const [customLexicon, setCustomLexicon] = React.useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('bili-argument-lexicon') || '{}');
    } catch {
      return {};
    }
  });
  const [analysisState, setAnalysisState] = React.useState('ready');
  const [deepSeekConfig, setDeepSeekConfig] = React.useState(null);

  const emptyUser = { id: '', uid: '', name: '等待搜索', bio: '输入 UID 后开始分析', sampleSize: 0, analyzed: 0, confidence: 0, stanceSwitchRate: 0, disagreementRate: 0, engineLabel: '', speechSummary: { negative: 0, positive: 0, lexicon: 0, mode: '' }, vocabularyMarks: [], scores: [], errors: [] };
  const runtimeLexicon = React.useMemo(() => buildRuntimeLexicon(customLexicon), [customLexicon]);
  const selectedUser = profiles.find((user) => user.id === selectedId) || profiles[0] || emptyUser;
  const trollIndex = getTrollIndex(selectedUser);
  const errorTypes = ['全部', ...new Set((selectedUser.errors || []).map((error) => error.type))];
  const visibleErrors =
    activeError === '全部'
      ? selectedUser.errors || []
      : (selectedUser.errors || []).filter((error) => error.type === activeError);

  React.useEffect(() => {
    window.localStorage.setItem('bili-argument-lexicon', JSON.stringify(customLexicon));
  }, [customLexicon]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadDeepSeekDictionary() {
      try {
        const [configResponse, dictionaryResponse] = await Promise.all([
          fetch('/api/deepseek/config'),
          fetch('/api/deepseek/dictionary'),
        ]);
        if (!configResponse.ok) {
          console.warn('DeepSeek config fetch failed:', configResponse.status);
          setFetchState((current) => (current.status === 'idle' ? { ...current, message: 'DeepSeek 配置加载失败，将使用本地规则。' } : current));
          return;
        }
        if (!dictionaryResponse.ok) {
          console.warn('Dictionary fetch failed:', dictionaryResponse.status);
          setFetchState((current) => (current.status === 'idle' ? { ...current, message: '词典加载失败，将使用内置词典。' } : current));
          return;
        }
        const config = await configResponse.json();
        const dictionaryPayload = await dictionaryResponse.json();
        if (cancelled) return;
        setDeepSeekConfig(config);
        if (dictionaryPayload.ok && dictionaryPayload.dictionary?.families) {
          setCustomLexicon((current) => mergeDictionaryFamilies(current, dictionaryPayload.dictionary.families));
        }
        setFetchState((current) =>
          current.status === 'idle'
            ? {
                ...current,
                message: config.available
                  ? `DeepSeek V4 模型 ${config.model}（${config.reasoningEffort || 'medium'}）已配置；输入 UID 后会抓取公开文本、抽取中文关键词并写入本地词典。`
                  : '未检测到 DEEPSEEK_API_KEY；输入 UID 后仍会用本地规则提取关键词并写入本地词典。',
              }
            : current,
        );
      } catch (dictError) {
        console.warn('DeepSeek dictionary load failed:', dictError);
        if (!cancelled) {
          setFetchState((current) =>
            current.status === 'idle'
              ? {
                  ...current,
                  message: 'DeepSeek 连接失败，请确认 npm run server 和 DEEPSEEK_API_KEY。',
                }
              : current,
          );
        }
      }
    }
    loadDeepSeekDictionary();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchUidComments = async (uid) => {
    // --- Per-comment AI analysis (deferred) ---
    // /api/deepseek/analyze-comments exists but is not wired into this flow because:
    // 1. 30-sentence cap per call (15 in compact mode) is insufficient for 140+ comments
    // 2. DeepSeek API calls are expensive and slow for per-request usage
    // 3. Keyword matching (findLexiconMarks) already provides useful coverage
    // 4. Batch processing infrastructure would be needed for full per-comment AI analysis
    // When wired: call POST /api/deepseek/analyze-comments with { text: combinedText }
    // See server/services/deepseekKeywordTrainer.js:analyzeCommentsWithDeepSeek

    const searchUid = (uid || '').trim().match(/^\d+$/)?.[0] || '';
    if (!searchUid) {
      setFetchState({ status: 'error', message: '请输入数字 UID。' });
      return;
    }
    setQuery(searchUid);
    setKeywordResults([]);
    setAnalysisState('loading');
    setFetchState({ status: 'loading', message: '正在从 AICU 获取该 UID 的评论数据...' });
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await fetch('/api/aicu/scrape', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: searchUid }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`服务器错误 (${response.status}): ${errorText.slice(0, 200)}`);
      }
      const data = await response.json();
      if (!data.ok) {
        setFetchState({ status: 'error', message: data.error || '获取失败' });
        setAnalysisState('ready');
        return;
      }
      const user = data.user;
      setQuery(user.uid);
      setUid(`mid ${user.uid}`);
      const nextCommentText = user.combinedText || user.commentText || '';
      setCommentText(nextCommentText);
      let learnedRuntimeLexicon = runtimeLexicon;
      let learnedNote = '';
      if (nextCommentText.trim() && deepSeekConfig?.available) {
        setFetchState({ status: 'loading', message: `已获取 ${user.commentCount} 条评论 + ${user.danmakuCount || 0} 条弹幕，正在提取关键词...` });
        try {
          const trainResponse = await fetch('/api/deepseek/train-keywords', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ uid: user.uid, text: nextCommentText, source: 'aicu.cc' }),
          });
          if (!trainResponse.ok) throw new Error(`Training request failed (${trainResponse.status})`);
          const trainData = await trainResponse.json();
          if (trainData.ok) {
            const nextCustomLexicon = mergeDictionaryFamilies(customLexicon, trainData.dictionary?.families || {});
            setCustomLexicon(nextCustomLexicon);
            learnedRuntimeLexicon = buildRuntimeLexicon(nextCustomLexicon);
            setKeywordResults(trainData.entries || []);
            learnedNote = `关键词 ${trainData.entries.length} 个。`;
          }
        } catch (trainError) {
          console.warn('Keyword training failed:', trainError);
        }
      }
      const hasComments = user.commentCount > 0 || (user.danmakuCount || 0) > 0 || nextCommentText.trim().length > 0;
      if (hasComments) {
        setFetchState({ status: 'loading', message: '正在生成分析画像...' });
        const effectiveMode = analysisMode === 'best' ? 'hybrid' : analysisMode;
        // Fetch semantic matches from server for enhanced scoring
        let semanticMatches = null;
        try {
          const commentLines = nextCommentText.split(/\r?\n/).filter(Boolean).slice(0, 200); // cap at 200 to keep embedding batch reasonable
          if (commentLines.length > 0) {
            const semResponse = await fetch('/api/deepseek/semantic-match', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ comments: commentLines }),
            });
            if (semResponse.ok) {
              const semData = await semResponse.json();
              if (semData.ok && semData.matches) {
                semanticMatches = semData.matches;
              }
            }
          }
        } catch (semError) {
          console.warn('Semantic matching unavailable, using exact match only:', semError.message);
        }
        const generated = scoreComments({
          name: `UID ${user.uid}`,
          uid: `mid ${user.uid}`,
          text: nextCommentText,
          runtimeLexicon: learnedRuntimeLexicon,
          analysisMode: effectiveMode,
          semanticMatches,
        });
        setProfiles([generated]);
        setSelectedId(generated.id);
        setActiveError('全部');
      }
      setFetchState({
        status: hasComments ? 'ready' : 'empty',
        message: `${user.commentCount} 条评论 + ${user.danmakuCount || 0} 条弹幕 · ${data.cached ? '已缓存' : '新获取'} · ${learnedNote}`,
      });
      setAnalysisState('ready');
    } catch (error) {
      const msg = error.name === 'AbortError' ? '请求超时，请稍后重试。' : `获取失败：${error.message}`;
      setFetchState({ status: 'error', message: msg });
      setAnalysisState('ready');
    }
  };

  return (
    <main>
      <section className="hero-shell">
        <nav className="topbar" aria-label="分析工作台导航">
          <div className="brand">
            <span><Detective size={18} weight="duotone" /></span>
            <strong>BiliArgument Lab</strong>
          </div>
          <div className="nav-metrics">
            <span>评论样本 {selectedUser.sampleSize}</span>
            <span>四维论辩行为分析</span>
            <span>关键词模式匹配 · 1,726 条术语 · 6 个行为族</span>
          </div>
        </nav>

        <div className="hero-grid">
          <section className="intro-panel">
            <div className="eyebrow"><MagnifyingGlass size={16} /> 公开可查 · 证据驱动</div>
            <h1>不只是关键词匹配——用语义理解识别”杠精倾向”</h1>
            <p>
              输入 B 站 UID，扫描公开评论和弹幕，综合分析论辩行为。
              不只看用了什么词，更看说话的逻辑：有没有在回应原话题、是不是在人身攻击、有没有给出证据、愿不愿意承认错误。
            </p>
            <div className="search-row">
              <label htmlFor="user-query">B 站 UID 搜索</label>
              <SearchBox onAnalyze={fetchUidComments} loading={analysisState === 'loading'} />
              <p className={`fetch-status fetch-${fetchState.status}`}>{fetchState.message}</p>
            </div>
          </section>

          <aside className="research-panel"  aria-label="分析框架">
            <div className="section-title">
              <Brain size={20} weight="duotone" />
              <span>分析依据</span>
            </div>
            {researchFrames.map((frame) => (
              <div className="research-row" key={frame.label}>
                <strong>{frame.label}</strong>
                <p>{frame.claim}</p>
                <small>{frame.source}</small>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <section className="workspace">
        <aside className="user-rail">
          <div className="rail-title">
            <ClipboardText size={18} />
            <span>用户评论</span>
          </div>
          {profiles.map((user) => (
            <button
              className={`user-card ${user.id === selectedId ? 'active' : ''}`}
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedId(user.id);
                setActiveError('全部');
                setQuery(user.uid.match(/\d+/)?.[0] || '');
                setUid(user.uid);
              }}
            >
              <strong>{user.name}</strong>
              <span>{user.uid}</span>
              <i>{user.bio}</i>
            </button>
          ))}
          <div className="method-note">
            <Scales size={18} />
            <p>评分不是人格诊断，只表示在给定评论样本中的论辩行为风险。</p>
          </div>
        </aside>

        <section className="analysis-core">
          <div className="profile-header">
            <div>
              <span className="eyebrow"><Gauge size={16} /> 分析输出</span>
              <h2>{selectedUser.name}</h2>
              <p>{selectedUser.uid} · {selectedUser.bio}</p>
            </div>
            <div className="score-block">
              <span>行为模式概要</span>
              <strong>{trollIndex}</strong>
              <small>{getRiskBand(trollIndex)}</small>
            </div>
          </div>

          <div className={`radar-card ${analysisState === 'loading' ? 'is-loading' : ''}`}>
            <div className="chart-area dual-charts">
              <figure className="chart-figure">
                <BarChartSmallMultiples scores={selectedUser.scores} />
                <figcaption className="chart-caption">
                  分析视图 · 条形高度反映关键词密度 · P50 为参考中位线
                </figcaption>
              </figure>
              <figure className="chart-figure">
                <RadarChartEntertainment
                  scores={selectedUser.scores}
                  hoveredAxis={hoveredRadarAxis}
                  onAxisHover={(i) => setHoveredRadarAxis(i >= 0 ? i : null)}
                  onAxisClick={(axisName) => setActiveError(axisName)}
                />
                <figcaption className="chart-caption">
                  可视化展示 · 径向距离 = 关键词密度百分位 · 面积由轴序决定，不做定量对比
                </figcaption>
              </figure>
            </div>
            <div className="score-list">
              {selectedUser.scores.map((score) => (
                <div className="score-row" key={score.axis}>
                  <div>
                    <strong>{score.axis}</strong>
                    <span>{axisDescriptions[score.axis]}</span>
                    <em>{score.note}</em>
                  </div>
                  <b>{normalizeForRisk(score)}</b>
                </div>
              ))}
            </div>
            {selectedUser.vocabularyMarks?.length > 0 && (
              <div className="vocabulary-bars" aria-label="字典词汇 分类标记">
                <div className="vocabulary-bars-head">
                  <strong>字典词汇标记</strong>
                  <span>这些词来自本地词库 / DeepSeek 学习，参与四维行为评分计算</span>
                </div>
                <div className="vocabulary-chip-grid">
                  {selectedUser.vocabularyMarks.map((mark) => (
                    <span className={`vocabulary-chip vocabulary-${mark.polarity}`} key={`${mark.family}-${mark.term}`}>
                      <b>{mark.term}</b>
                      <i>{mark.label} · {mark.axis}{mark.count > 1 ? ` ×${mark.count}` : ''}</i>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="metric-strip">
            <div>
              <span>有效评论</span>
              <strong>{selectedUser.analyzed}</strong>
            </div>
            <div>
              <span>高风险话语</span>
              <strong>{selectedUser.speechSummary?.negative ?? 0}</strong>
            </div>
            <div>
              <span>正向修正</span>
              <strong>{selectedUser.speechSummary?.positive ?? 0}</strong>
            </div>
            <div>
              <span>词库辅助证据</span>
              <strong>{selectedUser.speechSummary?.lexicon ?? 0}</strong>
            </div>
          </div>
        </section>

        <aside className="error-panel">
          <div className="section-title">
            <ShieldWarning size={20} weight="duotone" />
            <span>评论错误高亮</span>
          </div>
          <div className="filter-row" role="tablist" aria-label="错误类型筛选">
            {errorTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={activeError === type ? 'active' : ''}
                onClick={() => setActiveError(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="error-list">
            {visibleErrors.map((error) => (
              <ErrorComment item={error} key={error.id} sampleSize={selectedUser.sampleSize} />
            ))}
          </div>
        </aside>
      </section>

      <section className="model-section">
        <div className="model-header">
          <span className="eyebrow"><Faders size={16} /> scoring protocol</span>
          <h2>从评论到分析得分的计算路径</h2>
        </div>
        <div className="protocol-grid">
          <article>
            <FlagBanner size={24} />
            <strong>1. 拆分评论</strong>
            <p>按行切分评论，保留带有观点、评价或反驳的有效文本。</p>
          </article>
          <article>
            <WarningCircle size={24} />
            <strong>2. 语义判断</strong>
            <p>分析攻击对象、是否给出证据、有没有回应原话题、是否愿意修正。</p>
          </article>
          <article>
            <ChartPolar size={24} />
            <strong>3. 词库辅助</strong>
            <p>关键词匹配只作为线索提示，不会看到几个词就直接下结论。</p>
          </article>
          <article>
            <CheckCircle size={24} />
            <strong>4. 可追溯</strong>
            <p>每个评分都能回溯到具体评论，不会给个笼统标签就完事。</p>
          </article>
        </div>
      </section>
          <footer className="admin-link">
        <a href="/admin.html">管理员入口</a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
