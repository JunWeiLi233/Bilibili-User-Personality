import { findDictionaryEntriesWithTextEvidence } from './deepseekKeywordTrainer.js';

function hasChinese(text) {
  return /[\p{Script=Han}]/u.test(String(text || ''));
}

function cleanComment(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripMentionScaffolding(text) {
  return cleanComment(text)
    .replace(/回复\s*@[^:：\s]+[\s:：]*/gu, '')
    .replace(/@[^:：\s]+/gu, '')
    .trim();
}

function summarizeHit(entry) {
  return {
    term: entry.term,
    family: entry.family,
    meaning: entry.meaning,
  };
}

const EMOTE_SEMANTICS = [
  {
    pattern: /\[(?:tv_)?doge(?:[_-][^\]]+)?\]|doge|🙃|🙂|😏/iu,
    term: 'doge/反讽表情',
    family: 'attack',
    meaning: '中文平台评论中常用来标记反讽、阴阳怪气、保命式玩笑或“话里有话”的语气，不能当作普通装饰忽略。',
  },
  {
    pattern: /\[(?:藏狐|tv_斜眼笑|斜眼笑|滑稽|妙啊|阴险)\]|😅|😂|🤣|🤭/u,
    term: '嘲讽/看戏表情',
    family: 'attack',
    meaning: '表达调侃、看戏、嘲笑或讽刺态度；需要结合句子判断是玩梗还是指向具体对象的攻击。',
  },
  {
    pattern: /\[(?:吃瓜|嗑瓜子|热词系列[_-]吃瓜|doge[_-]金箍)\]|🍉/u,
    term: '吃瓜/旁观表情',
    family: 'evasion',
    meaning: '表示围观、拱火、旁观或回避直接论证，常弱化说话者责任或把严肃争论娱乐化。',
  },
  {
    pattern: /\[(?:捂脸|喜极而泣|允悲|辣眼睛)\]|😓|🤦|🤦‍♂️|🤦‍♀️/u,
    term: '无语/尴尬表情',
    family: 'attack',
    meaning: '表达无语、尴尬、轻蔑或讽刺；在中文评论里经常承担态度和攻击缓冲功能。',
  },
  {
    pattern: /🐶/u,
    term: '狗头/狗称呼表情',
    family: 'attack',
    meaning: '狗头或狗符号在中文评论中可表示保命玩笑，也可配合羞辱、置顶、嘲笑等语境指向贬损称呼，需要作为语气信号保留。',
  },
  {
    pattern: /(?:\^[_-]?\^|>[_-]?<|T[_-]?T|Q(?:A|w)Q|orz|xswl|2333+|(?<!https?):[:;=8xX][-o*']?[)(DPp/\\])/u,
    term: 'ASCII emoticon tone marker',
    family: 'cooperation',
    meaning: 'Plain-text emoticons common in Tieba/BBS comments can soften, tease, self-mock, or mark playful/satirical tone when no platform emote shortcode is present.',
  },
];

export function detectEmoteSemanticHits(comment) {
  const message = cleanComment(comment);
  if (!message) return [];
  return EMOTE_SEMANTICS
    .filter((item) => item.pattern.test(message))
    .map((item) => summarizeHit(item));
}

const SUPPLEMENTAL_SEMANTICS = [
  {
    pattern: /(?:\u8822\u662f\u8822|(?:\u4f60|\u4ed6|\u5979|\u5b83|\u4ed6\u4eec|\u5979\u4eec|\u8fd9\u4eba|\u90a3\u4eba|[\p{Script=Han}]{1,6}\u4eba).{0,6}\u8822|\u8822(?:\u8d27|\u903c|\u6bd4|\u72d7))/u,
    term: '\u8822',
    family: 'attack',
    meaning: '\u201c\u8822\u201d\u5728\u6307\u5411\u4e2a\u4eba\u3001\u7fa4\u4f53\u6216\u52a8\u7269\u5316\u8d2c\u79f0\u65f6\u662f\u76f4\u63a5\u667a\u529b\u8fb1\u9a82\uff0c\u4f1a\u653e\u5927\u5bf9\u8c61\u8d2c\u635f\u548c\u7fa4\u4f53\u653b\u51fb\u8bed\u6c14\u3002',
  },
  {
    pattern: /^[\s"'“”‘’]*\u5478[\s"'“”‘’!！?？。]*$/u,
    term: '\u5478',
    family: 'attack',
    meaning: '\u5355\u72ec\u51fa\u73b0\u7684\u201c\u5478\u201d\u662f\u8868\u8fbe\u538c\u6076\u3001\u9119\u5937\u6216\u9a71\u8d76\u7684\u53e3\u8bed\u653b\u51fb\u4fe1\u53f7\uff0c\u5373\u4f7f\u662f\u77ed\u5f39\u5e55\u4e5f\u5e94\u4fdd\u7559\u5176\u8d1f\u9762\u8bed\u6c14\u3002',
  },
  {
    pattern: /(?:\u522b|\u4e0d\u8981|\u522b\u518d|\u591f\u4e86?)[^\n。！？!?]{0,4}\u6d17(?!\u8863\u670d|\u8863|\u624b|\u8138|\u5934|\u6fa1|\u7897|\u8f66)(?:\u4e86|\u767d|\u5730|\u4ec0\u4e48)?/u,
    term: '\u522b\u6d17\u4e86',
    family: 'evasion',
    meaning: '\u4e2d\u6587\u7f51\u7edc\u8bed\u5883\u91cc\u201c\u522b\u6d17\u4e86\u201d\u5e38\u6307\u8d28\u7591\u5bf9\u65b9\u5728\u6d17\u767d\u3001\u63a9\u9970\u6216\u5f3a\u884c\u8fa9\u62a4\uff0c\u5c5e\u4e8e\u5bf9\u8bba\u8bc1\u52a8\u673a\u7684\u8d1f\u9762\u5224\u65ad\u3002',
  },
  {
    pattern: /\u6709\u54c1\u5473.{0,30}\u6ee1\u6c5f\u7ea2/u,
    term: '\u6709\u54c1\u5473...\u6ee1\u6c5f\u7ea2',
    family: 'attack',
    meaning: '\u7528\u201c\u5982\u679c\u771f\u6709\u54c1\u5473\u600e\u4e48\u4f1a...\u201d\u5f0f\u53cd\u95ee\u6765\u8d2c\u4f4e\u7fa4\u4f53\u5ba1\u7f8e\u6216\u54c1\u5473\uff0c\u662f\u9762\u5411\u89c2\u4f17\u7fa4\u4f53\u7684\u8bbd\u523a\u6027\u653b\u51fb\u3002',
  },
  {
    pattern: /\u6211\u5200\u5462[?!\uff1f\uff01]*/u,
    term: '\u6211\u5200\u5462',
    family: 'attack',
    meaning: '\u4e2d\u6587\u5f39\u5e55\u548c\u8bc4\u8bba\u91cc\u201c\u6211\u5200\u5462\u201d\u662f\u628a\u6124\u6012\u6216\u653b\u51fb\u6b32\u620f\u5267\u5316\u7684\u5a01\u80c1\u5f0fmeme\uff0c\u5e94\u4f5c\u4e3a\u5f3a\u70c8\u653b\u51fb\u8bed\u6c14\u4fe1\u53f7\uff0c\u4e0d\u7b49\u540c\u4e8e\u666e\u901a\u5200\u5177\u63cf\u8ff0\u3002',
  },
  {
    pattern: /(?:\u6218\u795e\u72d7|\u98de\u821e\u8d3c)/u,
    term: '\u6218\u795e\u72d7/\u98de\u821e\u8d3c',
    family: 'attack',
    meaning: '\u201c\u6218\u795e\u72d7\u201d\u548c\u201c\u98de\u821e\u8d3c\u201d\u8fd9\u7c7b\u7ec4\u5408\u7ef0\u53f7\u5e38\u628a\u5bf9\u8c61\u52a8\u7269\u5316\u6216\u8d3c\u5316\uff0c\u7528\u4e8e\u8d2c\u635f\u7c89\u4e1d\u3001\u89d2\u8272\u6216\u73a9\u5bb6\u7fa4\u4f53\u3002',
  },
  {
    pattern: /^[\s"'“”‘’]*\u6eda[\s"'“”‘’!！?？。]*$/u,
    term: '\u6eda',
    family: 'attack',
    meaning: '\u5355\u72ec\u51fa\u73b0\u7684\u201c\u6eda\u201d\u662f\u76f4\u63a5\u9a71\u8d76\u3001\u8fb1\u9a82\u6216\u4e0d\u53cb\u5584\u7684\u653b\u51fb\u8868\u8fbe\uff0c\u5373\u4f7f\u88ab\u5f15\u53f7\u5305\u88f9\u4e5f\u4e0d\u5e94\u89c6\u4e3a\u4e2d\u6027\u8bed\u53e5\u3002',
  },
  {
    pattern: /(?:好|真|太|很)?恶心/u,
    term: '恶心',
    family: 'attack',
    meaning: '强烈厌恶或反感评价；即使没有显式辱骂对象，也对人格/语气分析有负面情绪价值。',
  },
  {
    pattern: /(?:沙壁|傻逼|傻b|sb)(?![a-z])/iu,
    term: '沙壁/傻逼',
    family: 'attack',
    meaning: '中文网络常见谐音辱骂，表示把对象贬为愚蠢或低能。',
  },
  {
    pattern: /你祖宗/u,
    term: '你祖宗',
    family: 'attack',
    meaning: '以祖宗称呼对方常带有挑衅、压人或辱骂意味，在“到此一游”等涂鸦式表达中也可能是被动攻击。',
  },
  {
    pattern: /(?:女鼠|母狗|母猪)/u,
    term: '女鼠/母狗/母猪',
    family: 'attack',
    meaning: '将女性或特定群体动物化的中文网络贬称，常用于羞辱、物化或群体攻击。',
  },
  {
    pattern: /(?:我[艹草操]|卧槽|卧艹|雾草|握草)(?!本|书|药|莓|坪|地)/u,
    term: '我草/卧槽',
    family: 'attack',
    meaning: '中文平台常见粗口或强烈情绪感叹，可表达震惊、烦躁、攻击性语气或低礼貌度，即使不直接指向他人也应作为语气风险信号。',
  },
  {
    pattern: /(?:笑)?(?:他|她|你|您|ta|TA|这人|那人|谁|买的人|买家).{0,6}是(?:条|只)?狗/u,
    term: '是狗',
    family: 'attack',
    meaning: '把人或群体称为狗的动物化贬损表达，常用于嘲笑、羞辱或条件式辱骂，需要区别于真实动物描述。',
  },
  {
    pattern: /(?:眼神|弹幕|评论|这|又|开始|已经|直接).{0,6}开车|开车(?:开始|了|警告|现场|弹幕)/u,
    term: '开车/眼神开车',
    family: 'attack',
    meaning: '中文网络语境里“开车”常指性暗示、擦边或低俗玩笑，尤其与眼神、弹幕、开始等搭配时不是字面驾驶。',
  },
  {
    pattern: /(?:这个|那个|这|那|你|他|她|中单|上单|队友|主播|作者).{0,6}逼/u,
    term: '这个逼',
    family: 'attack',
    meaning: '中文平台常见粗口指称，把对象称为“逼”通常带有辱骂、轻蔑或强烈不满，应作为攻击性语气信号。',
  },
  {
    pattern: /反复去世|当场去世|原地去世/u,
    term: '反复去世',
    family: 'cooperation',
    meaning: 'Bilibili 等平台常见夸张 meme，用“去世”表达被作品、颜值或情绪强烈冲击，通常是高情绪表达和玩梗语气。',
  },
  {
    pattern: /(?:纯|又|已经|一直|天天|继续|开始|想)?白嫖/u,
    term: '白嫖',
    family: 'evasion',
    meaning: '中文网络语境中表示不付费、免费占用或薅资源的俗语，可用于自嘲、批评或消费态度表达，区别于字面颜色与行为。',
  },
];

function detectSupplementalSemanticHits(comment) {
  const message = cleanComment(comment);
  if (!message) return [];
  return SUPPLEMENTAL_SEMANTICS
    .filter((item) => item.pattern.test(message))
    .map((item) => summarizeHit(item));
}

function cleanNeedle(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function isLiteralYinYangContext(entry, message) {
  if (entry?.family !== 'attack') return false;
  if (!['阴阳', '阴阳怪气'].includes(String(entry?.term || ''))) return false;
  return /阴阳(?:逆乱|五行|两仪|调和|平衡|师|术|家|鱼|眼|怪|合同|交界)/u.test(message)
    || /(?:天道|魑魅魍魉|金光神咒|天地玄宗|三魂|七魄|补天|本根).{0,80}阴阳/u.test(message)
    || /阴阳.{0,80}(?:天道|魑魅魍魉|金光神咒|天地玄宗|三魂|七魄|补天|本根)/u.test(message);
}

function isFactualNoHaveContext(entry, message) {
  if (entry?.family !== 'absolutes') return false;
  if (String(entry?.term || '') !== '没有') return false;
  return /(?:频道|CCTV\d+|iptv|运营商|广电|关系|影响|证据|资料|机会|时间|办法).{0,12}没有/u.test(message)
    || /没有.{0,12}(?:频道|CCTV\d+|iptv|运营商|广电|关系|影响|证据|资料|机会|时间|办法)/u.test(message)
    || /一点关系没有/u.test(message);
}

function isLogicalNotIsContext(entry, message) {
  if (entry?.family !== 'attack') return false;
  if (String(entry?.term || '') !== '不是') return false;
  return /不是(?:做|当|为了|因为|说|指|指的是|这个|那个|一种|同一个|一回事|问题|重点|原因)/u.test(message);
}

function isSelfReferentialNoviceHit(entry, message) {
  if (entry?.family !== 'attack') return false;
  const term = String(entry?.term || '');
  const aliases = Array.isArray(entry?.aliases) ? entry.aliases.map(String) : [];
  if (![term, ...aliases].some((value) => value.includes('小白'))) return false;
  return /(?:^|[，,。！？!?\s])我(?:也|是|就是|也算|算)?[^，,。！？!?]{0,8}小白/u.test(message);
}

function isSuppressedLexicalHit(entry, message) {
  return isSelfReferentialNoviceHit(entry, message)
    || isLiteralYinYangContext(entry, message)
    || isFactualNoHaveContext(entry, message)
    || isLogicalNotIsContext(entry, message);
}

function exactDictionaryEntries(dictionary, message) {
  const cleanMessage = cleanNeedle(message);
  if (!cleanMessage) return [];
  const hits = [];
  for (const entry of Array.isArray(dictionary?.entries) ? dictionary.entries : []) {
    const needles = [entry.term, ...(Array.isArray(entry.aliases) ? entry.aliases : []), ...(Array.isArray(entry.examples) ? entry.examples : [])]
      .map(cleanNeedle)
      .filter((item) => item.length >= 2);
    if (needles.some((needle) => cleanMessage.includes(needle))) hits.push(entry);
  }
  return hits;
}

export function classifyCommentCoverage(dictionary, comment, options = {}) {
  const message = cleanComment(comment);
  if (!message) {
    return {
      covered: false,
      mode: 'uncovered',
      reason: 'empty comment',
      hits: [],
      comment: message,
    };
  }

  const attributableMessage = stripMentionScaffolding(message);
  const evidenceEntries = findDictionaryEntriesWithTextEvidence(dictionary, attributableMessage, {
    source: options.source || 'comment coverage check',
  }).filter((entry) => !isSuppressedLexicalHit(entry, attributableMessage));
  const lexicalEntries = evidenceEntries.length > 0
    ? evidenceEntries
    : exactDictionaryEntries(dictionary, attributableMessage)
      .filter((entry) => !isSuppressedLexicalHit(entry, attributableMessage));
  const lexicalHits = lexicalEntries.map(summarizeHit);
  const emoteHits = detectEmoteSemanticHits(message);
  const supplementalHits = detectSupplementalSemanticHits(message);
  const hits = [...lexicalHits, ...emoteHits, ...supplementalHits];

  if (hits.length > 0) {
    return {
      covered: true,
      mode: 'keyword',
      reason: [
        lexicalHits.length > 0 ? 'dictionary term' : null,
        emoteHits.length > 0 ? 'emoji/emote semantic marker' : null,
        supplementalHits.length > 0 ? 'supplemental semantic marker' : null,
      ].filter(Boolean).join(' and ') + ' matched',
      hits,
      comment: message,
    };
  }

  if (hasChinese(message)) {
    return {
      covered: true,
      mode: 'neutral',
      reason: 'no dictionary risk term matched; comment remains analyzable as neutral/no-keyword speech',
      hits: [],
      comment: message,
    };
  }

  return {
    covered: false,
    mode: 'uncovered',
    reason: 'non-Chinese or unsupported empty lexical content',
    hits: [],
    comment: message,
  };
}

export function sampleCommentCoverage(dictionary, comments = [], options = {}) {
  const sampleSize = Math.max(0, Number(options.sampleSize) || comments.length);
  const picked = comments.slice(0, sampleSize);
  const samples = picked.map((comment) => classifyCommentCoverage(dictionary, comment, options));
  const byMode = { keyword: 0, neutral: 0, uncovered: 0 };
  for (const sample of samples) {
    byMode[sample.mode] = (byMode[sample.mode] || 0) + 1;
  }
  const covered = samples.filter((sample) => sample.covered).length;
  return {
    total: samples.length,
    covered,
    uncovered: samples.length - covered,
    coverageRatio: samples.length > 0 ? covered / samples.length : 1,
    byMode,
    samples,
  };
}
