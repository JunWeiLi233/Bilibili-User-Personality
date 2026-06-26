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
import './styles.css';

const INVERSE_AXES = new Set(['证据敏感', '逻辑一致', '合作讨论', '修正意愿']); // 分越低越不靠谱的轴

const analysisModes = [
  {
    id: 'hybrid',
    label: '智能融合',
    description: '语境分析 + 关键词库双引擎，综合语义理解和词汇密度两个维度。',
  },
  {
    id: 'semantic',
    label: '语境分析',
    description: '优先看表达意图：在喷谁、有没有回应原帖、给没给证据、愿不愿改口。',
  },
  {
    id: 'lexicon',
    label: '词库模式',
    description: '只用可解释的词表命中规则；结果透明但追新梗会慢半拍。',
  },
];

const axisDescriptions = {
  对抗性动机: '看攻击目标是从”就事论事”滑向”就事论人”——喷观点还是扣帽子、查成分、翻主页。',
  绝对化思维: '看有没有全称判断、一棍子打死、拒绝留余地——“全是””没一个””从来就没”这类表达越多越可疑。',
  证据敏感: '看给不给出处、回不回应反证、会不会把举证责任甩给对方，分数越低越不靠谱。',
  逻辑一致: '看有没有稻草人、偷换概念、以偏概全、因果硬扯——不是说话冲不冲，是逻辑在不在线。',
  合作讨论: '看愿不愿澄清、会让步吗、会不会加限定条件、能不能复述对方的原话——分越低越像在杠。',
  修正意愿: '看被指出问题后的反应——承认还是装死、补充还是反击、降调还是上强度。',
};

const researchFrames = [
  {
    label: '反讽识别',
    source: 'Chinese social media sarcasm studies',
    claim: '嘴上说的和心里想的可能是反的，必须结合上下文和说话动机来看，不能只看字面意思。',
  },
  {
    label: '匿名去抑制',
    source: 'Suler, 2004',
    claim: '反正没人认识我、看不到脸、说完就走——这种匿名感会让人更容易说出攻击性的话。',
  },
  {
    label: '立场偏见',
    source: 'Kunda, 1990',
    claim: '人天然偏向找支持自己立场的证据，对反面证据会本能地抬高标准。',
  },
  {
    label: '论证分析',
    source: 'van Eemeren & Grootendorst',
    claim: '杠不是说话难听，是破坏了好好讨论的规则——比如偷换概念、转移话题、拒绝举证。',
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
    diagnosis: '对人不对话——翻主页、扣帽子、质疑资格，目的是羞辱而不是讨论。',
    deltas: { attack: 28, cooperation: -18, logic: -10 },
  },
  {
    act: '扣立场 / 动机揣测',
    type: '偷换概念',
    severity: '高',
    target: '动机',
    pattern: /(其实就是|所以你就是|给资本|洗地|收钱|屁股|站队|水军|五毛|美分|粉红|小粉红|精外|洋奴|殖人|1450|来电了|蛙|湾湾|神神|兔兔|你国|贵国|境外势力|恰饭|恰烂钱|广告费|收了多少|到账).{0,22}/,
    diagnosis: '把对方的观点偷换成立场问题——你说A是因为你站B，所以A不用讨论了。',
    deltas: { attack: 20, logic: -24, cooperation: -14 },
  },
  {
    act: '甩举证责任',
    type: '缺证据',
    severity: '中',
    target: '证明责任',
    pattern: /(你自己搜|自己查|懂的都懂|这还用问|懒得解释|不解释|百度一下|不会百度|问百度|去百度|自己去找|不会搜|搜一下不会|这都不知道|常识|不用我教|自己学|去看书|多读书|这还用说|这都不懂).{0,20}/,
    diagnosis: '自己说的东西让别人去查——又不是别人提出的观点凭什么替你举证。',
    deltas: { evidence: -28, cooperation: -10 },
  },
  {
    act: '一棍子打死',
    type: '逻辑硬伤',
    severity: '中',
    target: '命题范围',
    pattern: /(所有|全部|都是|没有一个|哪个不是|从来|永远|根本|全都|一律|无一例外|百分百|百分之一百|任何人|谁都|没人|没有人|没有一个人|没有哪个|从古至今|自古以来|历来).{0,24}/,
    diagnosis: '拿几个例子就当全部——从"有的"直接跳到"全是"，缺少限定条件。',
    deltas: { closure: 26, logic: -20 },
  },
  {
    act: '铁口直断不给证据',
    type: '事实存疑',
    severity: '中',
    target: '事实',
    pattern: /(早就没有|不可能|必然|肯定|绝对|毫无疑问|毋庸置疑|不用怀疑|不可能是|肯定是|绝对是|很明显|明摆着|众所周知|大家都知道|谁不知道|不用想|毫无疑问地|确定无疑).{0,24}/,
    diagnosis: '语气斩钉截铁但没给任何可查的来源——大家都知道不算出处。',
    deltas: { closure: 18, evidence: -16, logic: -10 },
  },
  {
    act: '留余地 / 讲道理',
    type: '正常讨论',
    severity: '低',
    target: '观点',
    pattern: /(可能|不一定|如果|我理解|能否|可以贴|补充|限定|或许|大概|也许|有可能|据我所知|就我所见|以我目前|暂时|目前看来|现阶段|这里有一个|让我补充|提供一下|仅供参考|个人看法|在我看来|我的理解).{0,24}/,
    diagnosis: '加了限定词、留了余地，说明还在好好聊而不是硬杠。',
    deltas: { cooperation: 24, evidence: 8, closure: -10 },
    positive: true,
  },
  {
    act: '认错 / 改口',
    type: '正常讨论',
    severity: '低',
    target: '自我修正',
    pattern: /(我错了|我说重了|更正|修正|改结论|承认|说错了|搞错了|弄错了|记错了|确实|你说得对|受教|学习|感谢指正|谢谢指正|有道理|你说的有道理|这倒也是|那倒也对|收回|前面说错|之前说错|是我搞混).{0,24}/,
    diagnosis: '能承认错误或改口——这是区分正常人和纯杠精的关键信号。',
    deltas: { correction: 32, cooperation: 12 },
    positive: true,
  },
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const lexiconFamilyMeta = {
  attack: {
    label: '攻击 / 嘲讽',
    axis: '对抗性动机',
    type: '情绪输出',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中攻击或阴阳怪气类词语，会拉高对抗性动机并压低合作讨论分数。',
  },
  absolutes: {
    label: '绝对化',
    axis: '绝对化思维',
    type: '缺少限定',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中绝对化断言类词语，会推高绝对化思维并影响逻辑一致性。',
  },
  evidence: {
    label: '证据线索',
    axis: '证据敏感',
    type: '证据请求',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中证据或来源类词语，视为证据敏感的加分项。',
  },
  evasion: {
    label: '举证回避',
    axis: '证据敏感',
    type: '缺证据',
    severity: '中',
    polarity: 'risk',
    diagnosis: '词库命中甩锅式回避词语，会拉低证据敏感并增加举证转移风险。',
  },
  cooperation: {
    label: '合作讨论',
    axis: '合作讨论',
    type: '讨论线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中澄清、让步或留余地类词语，视为合作讨论的加分项。',
  },
  correction: {
    label: '自我修正',
    axis: '修正意愿',
    type: '修正线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '词库命中认错或改口类词语，视为修正意愿的加分项。',
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
        diagnosis: `${rule.act}。${rule.diagnosis}${isMeme ? '（整句含 meme/引用语境，降低权重）' : ''}`,
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
          diagnosis: '未发现明显攻击、偷换、举证回避或强全称化。仍需结合上下文判断事实真伪。',
          evidence: `第 ${index + 1}/${totalComments} 条评论未命中高风险表达规则。`,
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
  if (index >= 70) return '高风险对抗型';
  if (index >= 45) return '混合争辩型';
  return '低风险讨论型';
}

function getTrollIndex(user) {
  const weights = {
    对抗性动机: 0.2,
    绝对化思维: 0.16,
    证据敏感: 0.18,
    逻辑一致: 0.18,
    合作讨论: 0.16,
    修正意愿: 0.12,
  };
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

  const semanticSeed = {
    attack: 26,
    closure: 30,
    evidence: 56,
    logic: 68,
    cooperation: 46,
    correction: 36,
  };

  semanticActs.forEach((act) => {
    Object.entries(act.deltas || {}).forEach(([key, value]) => {
      semanticSeed[key] = clamp(semanticSeed[key] + value);
    });
  });

  const lexiconSeed = {
    attack: clamp(28 + riskDensity(runtimeLexicon.attack) * 24 + perThousand(riskLexiconText, runtimeLexicon.attack) * 2.8),
    closure: clamp(30 + riskDensity(runtimeLexicon.absolutes) * 18 + perThousand(riskLexiconText, runtimeLexicon.absolutes) * 2.2),
    evidence: clamp(55 + density(runtimeLexicon.evidence) * 16 - riskDensity(runtimeLexicon.evasion) * 22),
    logic: clamp(68 - (riskLexiconMarks.length / total) * 18 + density(runtimeLexicon.evidence) * 5),
    cooperation: clamp(46 + density(runtimeLexicon.cooperation) * 18 - riskDensity(runtimeLexicon.attack) * 16 - riskDensity(runtimeLexicon.evasion) * 12),
    correction: clamp(36 + density(runtimeLexicon.correction) * 28 + density(runtimeLexicon.cooperation) * 8 - riskDensity(runtimeLexicon.evasion) * 12),
  };

  const mix = (key) => {
    if (analysisMode === 'semantic') return semanticSeed[key];
    if (analysisMode === 'lexicon') return lexiconSeed[key];
    // hybrid (default): blend both engines
    return semanticSeed[key] * 0.65 + lexiconSeed[key] * 0.35;
  };

  const scores = [
    {
      axis: '对抗性动机',
      value: mix('attack'),
      benchmark: 52,
      note: `语境分析检出 ${negativeActs.filter((act) => ['人', '动机'].includes(act.target)).length} 条人/动机攻击；字典 attack 标记 ${allLexiconMarks.filter((mark) => mark.family === 'attack').length} 次，密度 ${perThousand(riskLexiconText, runtimeLexicon.attack).toFixed(1)} / 千字。`,
    },
    {
      axis: '绝对化思维',
      value: mix('closure'),
      benchmark: 49,
      note: `全称化或强事实断言 ${negativeActs.filter((act) => ['命题范围', '事实'].includes(act.target)).length} 条；字典 absolutes 标记 ${allLexiconMarks.filter((mark) => mark.family === 'absolutes').length} 次。`,
    },
    {
      axis: '证据敏感',
      value: mix('evidence'),
      benchmark: 58,
      note: `证据词 ${countMatches(joined, runtimeLexicon.evidence)} 次，举证回避 ${countMatches(joined, runtimeLexicon.evasion)} 次；两类字典标记共同影响此轴。`,
    },
    {
      axis: '逻辑一致',
      value: mix('logic'),
      benchmark: 61,
      note: `语境分析检出 ${negativeActs.length} 条高风险表达；风险类字典标记 ${riskLexiconMarks.length} 条作为辅助扣分。`,
    },
    {
      axis: '合作讨论',
      value: mix('cooperation'),
      benchmark: 55,
      note: `澄清、让步或条件化表达 ${countMatches(joined, runtimeLexicon.cooperation)} 次；cooperation 字典标记 ${allLexiconMarks.filter((mark) => mark.family === 'cooperation').length} 次。`,
    },
    {
      axis: '修正意愿',
      value: mix('correction'),
      benchmark: 46,
      note: `修正或承认表达 ${countMatches(joined, runtimeLexicon.correction)} 次；correction 字典标记 ${allLexiconMarks.filter((mark) => mark.family === 'correction').length} 次。`,
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
            diagnosis: '当前样本没有明显攻击、偷换、举证回避或强全称化。低风险不等于观点正确，只表示此样本缺少高冲突语言证据。',
            evidence: `已检查 ${comments.length} 条评论。`,
            confidence: 0.58,
          },
        ];

  const confidence = clamp(0.5 + Math.min(total, 30) / 100 + Math.min(primaryErrors.length, 10) / 85, 0.45, 0.92);

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

function RadarChart({ scores }) {
  const size = 360;
  const center = size / 2;
  const radius = 128;
  const levels = [0.25, 0.5, 0.75, 1];
  const angleStep = (Math.PI * 2) / scores.length;
  const point = (index, value) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const distance = radius * (value / 100);
    return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
  };
  const polygon = scores.map((score, index) => point(index, normalizeForRisk(score)).join(',')).join(' ');
  const baseline = scores
    .map((score, index) => point(index, normalizeForRisk({ ...score, value: score.benchmark })).join(','))
    .join(' ');

  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="杠精倾向雷达图">
      {levels.map((level) => {
        const ring = scores.map((_, index) => point(index, level * 100).join(',')).join(' ');
        return <polygon key={level} points={ring} className="radar-ring" />;
      })}
      {scores.map((score, index) => {
        const [x, y] = point(index, 100);
        const [labelX, labelY] = point(index, 116);
        return (
          <g key={score.axis}>
            <line x1={center} y1={center} x2={x} y2={y} className="radar-axis" />
            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" className="radar-label">
              {score.axis}
            </text>
          </g>
        );
      })}
      <polygon points={baseline} className="radar-baseline" />
      <polygon points={polygon} className="radar-shape" />
      {scores.map((score, index) => {
        const [x, y] = point(index, normalizeForRisk(score));
        return <circle key={score.axis} cx={x} cy={y} r="4.5" className="radar-dot" />;
      })}
    </svg>
  );
}

function ErrorComment({ item }) {
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
        <span>置信度</span>
        <div>
          <i style={{ width: `${item.confidence * 100}%` }} />
        </div>
        <b>{Math.round(item.confidence * 100)}%</b>
      </div>
    </article>
  );
}

function App() {
  const [profiles, setProfiles] = React.useState([]);
  const [selectedId, setSelectedId] = React.useState(null);
  const [activeError, setActiveError] = React.useState('全部');
  const [query, setQuery] = React.useState('');
  const [bilibiliCookie, setBilibiliCookie] = React.useState('');
  const [uid, setUid] = React.useState('');
  const [commentText, setCommentText] = React.useState('');
  const [fetchState, setFetchState] = React.useState({
    status: 'idle',
    message: '输入 UID 或视频链接后会直接扫描 B 站公开对象，并用 DeepSeek V4 Pro max 学习关键词。',
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

  const fetchUidComments = async () => {
    const searchUid = query.trim().match(/\d+/)?.[0] || '';
    if (!searchUid) {
      setFetchState({ status: 'error', message: '请输入数字 UID。' });
      return;
    }
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
          const commentLines = nextCommentText.split(/\r?\n/).filter(Boolean).slice(0, 50);
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
            <span>模型版本 PDI-0.6</span>
            <span>{selectedUser.engineLabel || '混合模式'}</span>
          </div>
        </nav>

        <div className="hero-grid">
          <section className="intro-panel">
            <div className="eyebrow"><MagnifyingGlass size={16} /> research first</div>
            <h1>用语义理解而不是死板词表来识别”杠精倾向”</h1>
            <p>
              输入 UID 后直接扫描 B 站公开资料、投稿、动态和评论互动，再用语义模型生成分析画像。
              词表只做辅助召回，核心判断转向：是否回应原命题、是否转向人身或阵营、是否转移举证责任、是否愿意修正。
            </p>
            <div className="search-row">
              <label htmlFor="user-query">B 站 UID</label>
              <div>
                <input
                  id="user-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例如 453244911"
                />
                <button type="button" onClick={fetchUidComments} disabled={analysisState === 'loading'}>
                  <Lightning size={17} weight="fill" />
                  {analysisState === 'loading' ? '抓取中' : '搜索 UID'}
                </button>
              </div>
              <p className={`fetch-status fetch-${fetchState.status}`}>{fetchState.message}</p>
              <div className="mode-selector" role="radiogroup" aria-label="分析模式">
                {analysisModes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`mode-chip ${analysisMode === mode.id ? 'active' : ''}`}
                    onClick={() => setAnalysisMode(mode.id)}
                    title={mode.description}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              {keywordResults.length > 0 && (
                <div className="keyword-results" aria-label="DeepSeek 提取关键词">
                  {keywordResults.slice(0, 12).map((entry) => (
                    <span className="keyword-chip" key={`${entry.family}-${entry.term}`} title={entry.meaning || entry.family}>
                      {entry.term}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="research-panel" aria-label="研究框架">
            <div className="section-title">
              <Brain size={20} weight="duotone" />
              <span>心理学与论辩学框架</span>
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
              <span className="eyebrow"><Gauge size={16} /> profile output</span>
              <h2>{selectedUser.name}</h2>
              <p>{selectedUser.uid} · {selectedUser.bio}</p>
            </div>
            <div className="score-block">
              <span>杠精指数</span>
              <strong>{trollIndex}</strong>
              <small>{getRiskBand(trollIndex)}</small>
            </div>
          </div>

          <div className={`radar-card ${analysisState === 'loading' ? 'is-loading' : ''}`}>
            <div className="chart-area">
              <RadarChart scores={selectedUser.scores} />
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
              <div className="vocabulary-radar" aria-label="字典词汇 radar 标记">
                <div className="vocabulary-radar-head">
                  <strong>字典词汇标记</strong>
                  <span>这些词来自本地 / DeepSeek 词库，并参与雷达对应轴计算</span>
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
              <ErrorComment item={error} key={error.id} />
            ))}
          </div>
        </aside>
      </section>

      <section className="model-section">
        <div className="model-header">
          <span className="eyebrow"><Faders size={16} /> scoring protocol</span>
          <h2>从评论到雷达图的计算路径</h2>
        </div>
        <div className="protocol-grid">
          <article>
            <FlagBanner size={24} />
            <strong>1. 语料清洗</strong>
            <p>按行切分评论，保留带有主张、评价或反驳的文本片段。</p>
          </article>
          <article>
            <WarningCircle size={24} />
            <strong>2. 语义规则判定</strong>
            <p>判断攻击对象、举证责任、命题回应和是否出现自我修正。</p>
          </article>
          <article>
            <ChartPolar size={24} />
            <strong>3. 词库辅助打分</strong>
            <p>新梗和近义变体只作为风险线索，避免静态词表直接定性。</p>
          </article>
          <article>
            <CheckCircle size={24} />
            <strong>4. 证据回放</strong>
            <p>每个评分都保留可追溯评论片段，避免只给抽象标签或主观印象。</p>
          </article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
