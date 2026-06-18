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

function isScrapeDiagnosticMessage(text) {
  const message = String(text || '');
  return /(?:^|[:\s])(?:discover|explicit Tieba thread URLs):\s+.*HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?:\/\//iu.test(message)
    || /HTTP\s+(?:403|4\d\d|5\d\d)\s+from\s+https?:\/\/(?:tieba|c\.tieba|www\.bilibili|api\.bilibili)\./iu.test(message);
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
  {
    pattern: /\[(?:\u6253call|call)(?:[_-][^\]]+)?\]/iu,
    term: '\u6253call\u8868\u60c5',
    family: 'cooperation',
    meaning: '\u201c[\u6253call]\u201d\u662fB\u7ad9\u5e38\u89c1\u652f\u6301\u3001\u5e94\u63f4\u548c\u5174\u594b\u8868\u60c5\uff0c\u548c\u201c\u5feb\u4e50\u56de\u6765\u4e86\u201d\u3001\u5927\u7b11\u8fde\u7528\u65f6\u5e94\u4f5c\u4e3a\u6b63\u5411\u5408\u4f5c/\u8d5e\u540c\u8bed\u6c14\u4fdd\u7559\u3002',
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
    pattern: /\u98a0\u5a46/u,
    term: '\u98a0\u5a46',
    family: 'attack',
    meaning: '\u201c\u98a0\u5a46\u201d\u662f\u5bf9\u5973\u6027\u7684\u8d2c\u635f\u6027\u7f51\u7edc\u79f0\u547c\uff0c\u5e38\u8868\u793a\u5bf9\u65b9\u75af\u766b\u3001\u5931\u63a7\u6216\u4e0d\u53ef\u7406\u55bb\uff0c\u5c5e\u4e8e\u76f4\u63a5\u4eba\u8eab\u653b\u51fb\u3002',
  },
  {
    pattern: /\u8ba4\u77e5.{0,4}200|\u4f60.{0,8}200[\uff0c,]/u,
    term: '200',
    family: 'attack',
    meaning: '\u201c200\u201d\u5728\u201c\u8ba4\u77e5200\u201d\u7b49\u8bed\u5883\u4e2d\u5e38\u662f\u201c\u4e8c\u767e\u4e94\u201d\u7684\u7f29\u5199\u5f0f\u5632\u8bbd\uff0c\u7528\u6765\u8d2c\u4f4e\u5bf9\u65b9\u7406\u89e3\u529b\u6216\u667a\u529b\u3002',
  },
  {
    pattern: /\u548c\u4f60\u662f\u670b\u53cb[\uff0c,].{0,16}\u8fd8\u662f.{0,8}\u7238\u7238\u5462/u,
    term: '\u7238\u7238\u5462',
    family: 'attack',
    meaning: '\u7528\u201cX\u548c\u4f60\u662f\u670b\u53cb\uff0cY\u8fd8\u662f\u6211\u4eec\u7238\u7238\u5462\u201d\u7c7b\u6bd4\u6765\u5632\u8bbd\u524d\u4e00\u8bf4\u6cd5\u8352\u8c2c\uff0c\u662f\u9488\u5bf9\u5bf9\u65b9\u4fe1\u606f\u53ef\u4fe1\u5ea6\u7684\u654c\u610f\u6027\u53cd\u8bbd\u3002',
  },
  {
    pattern: /\u6bc1\u539f\u4f5c|\u6bc1.{0,4}\u539f\u4f5c/u,
    term: '\u6bc1\u539f\u4f5c',
    family: 'attack',
    meaning: '\u201c\u6bc1\u539f\u4f5c\u201d\u662f\u5bf9\u6539\u7f16\u65b9\u6216\u521b\u4f5c\u65b9\u7684\u5f3a\u70c8\u8d1f\u9762\u8bc4\u4ef7\uff0c\u6307\u5176\u7834\u574f\u539f\u4f5c\u6c14\u8d28\u6216\u8d28\u91cf\u3002',
  },
  {
    pattern: /(?:\u5435|\u8042|\u95f9|\u55e1).{0,8}\u8111\u4ec1\u75bc|\u8111\u4ec1\u75bc/u,
    term: '\u8111\u4ec1\u75bc',
    family: 'attack',
    meaning: '\u201c\u8111\u4ec1\u75bc\u201d\u5728\u8bc4\u8bba\u91cc\u5e38\u8868\u793a\u88ab\u5435\u95f9\u3001\u4f4e\u8d28\u6216\u96be\u53d7\u5185\u5bb9\u6298\u78e8\u5230\u5934\u75bc\uff0c\u5c5e\u4e8e\u5f3a\u70c8\u8d1f\u9762\u5410\u69fd\u4fe1\u53f7\u3002',
  },
  {
    pattern: /(?:\u82f1\u96c4|\u771f\u6b63|\u6211|\u4f60|\u4ed6|\u5979|\u8fd9\u4eba|\u90a3\u4eba|up|UP).{0,12}[\uff08(]\u54b8\u9c7c[\uff09)]|\u54b8\u9c7c(?:\u4e00\u6761|\u672c\u9c7c|\u4eba\u751f|\u8eba\u5e73)/u,
    term: '\u54b8\u9c7c',
    family: 'attack',
    meaning: '\u201c\u54b8\u9c7c\u201d\u5728\u4e2d\u6587\u7f51\u7edc\u8bed\u5883\u91cc\u5e38\u6307\u61d2\u6563\u3001\u8eba\u5e73\u6216\u6ca1\u6709\u8ffd\u6c42\u7684\u4eba\uff0c\u5c24\u5176\u4e0e\u201c\u82f1\u96c4\u201d\u7b49\u79f0\u53f7\u5bf9\u7167\u65f6\u4f1a\u5f62\u6210\u53cd\u8bbd\u6216\u81ea\u5632\u8bed\u6c14\u3002',
  },
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
    pattern: /\u4e0d\u810f.{0,12}\u4f60\u7684\u8bdd\u662f\u5929\u7c41/u,
    term: '\u4f60\u7684\u8bdd\u662f\u5929\u7c41',
    family: 'attack',
    meaning: '\u201c\u4e0d\u810f\uff0c\u4f60\u7684\u8bdd\u662f\u5929\u7c41\u201d\u5f0f\u8868\u8fbe\u628a\u8d5e\u7f8e\u8bed\u653e\u5728\u5426\u5b9a\u6216\u53cd\u8bdd\u8bed\u5883\u91cc\uff0c\u5e38\u7528\u4e8e\u5a49\u8f6c\u5632\u8bbd\u5bf9\u65b9\u8bf4\u8bdd\u96be\u542c\u6216\u8352\u8c2c\uff0c\u4e0d\u7b49\u540c\u4e8e\u666e\u901a\u201c\u5929\u7c41\u201d\u8d5e\u7f8e\u3002',
  },
  {
    pattern: /\u8fd9\u53e5[“"']?[^”"']{0,20}\u90fd\u662f[^”"']{0,20}[”"']?.{0,12}(?:\u641e\u7b11|\u597d\u7b11|\u7b11\u6b7b|\u96be\u7ef7|\u96be\u868c)/u,
    term: '\u5f15\u8bed\u91cc\u7684\u90fd\u662f',
    family: 'evasion',
    meaning: '\u628a\u201c\u90fd\u662f...\u201d\u4f5c\u4e3a\u5f15\u7528\u5185\u5bb9\u540e\u63a5\u201c\u641e\u7b11\u201d\u7b49\u8bc4\u8bed\uff0c\u901a\u5e38\u662f\u5632\u8bbd\u522b\u4eba\u7684\u7edd\u5bf9\u5316\u8bf4\u6cd5\uff0c\u800c\u4e0d\u662f\u8bf4\u8bdd\u8005\u672c\u4eba\u5728\u4e0b\u5168\u79f0\u65ad\u8a00\u3002',
  },
  {
    pattern: /(?:\u96be[\u868c\u7ef7].{0,8}(?:\u6807\u9898|\u5c5e\u5b9e|\u771f|\u6709\u70b9|\u4e86|\u4f4f)|(?:\u6807\u9898|\u5c5e\u5b9e).{0,6}\u96be[\u868c\u7ef7])/u,
    term: '\u96be\u868c/\u96be\u7ef7',
    family: 'attack',
    meaning: '\u201c\u96be\u868c/\u96be\u7ef7\u201d\u5e38\u8868\u793a\u7ef7\u4e0d\u4f4f\u3001\u65e0\u6cd5\u4fdd\u6301\u4e25\u8083\u7684\u5632\u8bbd\u6216\u5426\u5b9a\u6001\u5ea6\uff0c\u5c24\u5176\u548c\u201c\u6807\u9898\u201d\u7b49\u5bf9\u8c61\u642d\u914d\u65f6\u662f\u5bf9\u5185\u5bb9\u5957\u8def\u7684\u8c03\u4f83\u3002',
  },
  {
    pattern: /(?:\u5f39\u5e55.{0,8}\u597d\u6025\u554a|\u597d\u6025\u554a.{0,16}(?:\u73a9\u7b11|\u670b\u53cb|\u751f\u6d3b))/u,
    term: '\u5f39\u5e55\u597d\u6025\u554a',
    family: 'attack',
    meaning: '\u201c\u5f39\u5e55\u597d\u6025\u554a\u201d\u628a\u5bf9\u65b9\u89e3\u8bfb\u4e3a\u8fc7\u5ea6\u4e0a\u5934\u6216\u7834\u9632\uff0c\u5e38\u63a5\u201c\u73a9\u7b11\u201d\u3001\u201c\u6ca1\u670b\u53cb\u201d\u7b49\u8d2c\u4e49\u89e3\u91ca\uff0c\u5c5e\u4e8e\u5bf9\u5f39\u5e55\u7fa4\u4f53\u7684\u5632\u8bbd\u6216\u653b\u51fb\u3002',
  },
  {
    pattern: /(?:\u6401[\u8fd9\u7740].{0,8}(?:\u770b\u77ed\u5267|\u770b\u620f|\u6f14\u5462|\u88c5\u5462).{0,4}[?\uff1f]{1,})/u,
    term: '\u6401\u7740\u770b\u77ed\u5267\u5462',
    family: 'attack',
    meaning: '\u201c\u6401\u7740...\u5462\uff1f\uff1f\u201d\u5f0f\u95ee\u53e5\u5e38\u7528\u6765\u53cd\u8bbd\u5bf9\u65b9\u5728\u6f14\u3001\u8d70\u795e\u6216\u628a\u4e8b\u60c5\u5a31\u4e50\u5316\uff0c\u4e0d\u662f\u666e\u901a\u8be2\u95ee\u770b\u5267\u884c\u4e3a\u3002',
  },
  {
    pattern: /(?:\u50f5\u5c38\u4e00\u6837\u7684\u72d7|(?:\u50cf|\u8ddf).{0,4}\u50f5\u5c38.{0,4}(?:\u4e00\u6837|\u4f3c\u7684).{0,4}(?:\u72d7|\u4eba))/u,
    term: '\u50f5\u5c38\u4e00\u6837\u7684\u72d7',
    family: 'attack',
    meaning: '\u628a\u4eba\u6216\u5bf9\u8c61\u6bd4\u4f5c\u201c\u50f5\u5c38\u4e00\u6837\u7684\u72d7\u201d\u662f\u660e\u663e\u8d2c\u635f\u6bd4\u55bb\uff0c\u540c\u65f6\u5177\u6709\u975e\u4eba\u5316\u548c\u52a8\u7269\u5316\u653b\u51fb\u8272\u5f69\u3002',
  },
  {
    pattern: /(?:\u4e00\u5bb6\u5b50.{0,8}(?:\u81ed\u6d41\u6c13|\u6d41\u6c13|\u5783\u573e|\u767d\u75f4)|(?:\u7eaf|\u5168\u662f).{0,6}\u4e00\u5bb6\u5b50.{0,8}(?:\u81ed\u6d41\u6c13|\u6d41\u6c13|\u5783\u573e|\u767d\u75f4))/u,
    term: '\u4e00\u5bb6\u5b50\u81ed\u6d41\u6c13',
    family: 'attack',
    meaning: '\u628a\u6574\u4e2a\u5bb6\u5ead\u6216\u4e00\u7fa4\u4eba\u79f0\u4f5c\u201c\u4e00\u5bb6\u5b50\u81ed\u6d41\u6c13\u201d\u662f\u660e\u786e\u7684\u7fa4\u4f53\u5f0f\u4eba\u8eab\u653b\u51fb\uff0c\u5f3a\u8c03\u54c1\u884c\u8d2c\u635f\u548c\u8eab\u4efd\u6c61\u540d\u3002',
  },
  {
    pattern: /(?:\u4e71\u5199.{0,36}(?:\u7279\u4e48|\u795e\u7ecf\u5267\u672c)|(?:\u7279\u4e48|\u795e\u7ecf\u5267\u672c).{0,36}\u4e71\u5199|\u5199\u4e0d\u4e0b\u53bb.{0,20}\u4e71\u5199|\u8ddf\u7279\u4e48.{0,24}\u4f3c\u7684\u795e\u7ecf\u5267\u672c)/u,
    term: '\u4e71\u5199/\u795e\u7ecf\u5267\u672c',
    family: 'attack',
    meaning: '\u957f\u8bc4\u4e2d\u7528\u201c\u4e71\u5199\u201d\u3001\u201c\u7279\u4e48\u201d\u3001\u201c\u795e\u7ecf\u5267\u672c\u201d\u7b49\u8fde\u7eed\u8868\u8fbe\u6279\u8bc4\u5267\u60c5\u6216\u521b\u4f5c\u65f6\uff0c\u662f\u5f3a\u70c8\u5426\u5b9a\u548c\u5632\u8bbd\u6027\u653b\u51fb\uff0c\u4e0d\u662f\u4e2d\u6027\u53d9\u8ff0\u3002',
  },
  {
    pattern: /(?:^|[^\p{L}\p{N}])t\s*m\s*d?(?:$|[^\p{L}\p{N}])|^t\s*m\s*d?(?=[\u4e00-\u9fff])|[\u4e00-\u9fff][\s,，。！？!?]*t\s*m\s*d?(?=$|[^\p{L}\p{N}]|[\u4e00-\u9fff])/iu,
    term: 'tm/tmd',
    family: 'attack',
    meaning: '\u201ctm/tmd\u201d\u662f\u201c\u4ed6\u5988\u7684\u201d\u7684\u5e38\u89c1\u62fc\u97f3\u7f29\u5199\uff0c\u5728\u4e2d\u6587\u5f39\u5e55\u548c\u8bc4\u8bba\u4e2d\u901a\u5e38\u662f\u7c97\u53e3\u3001\u6124\u6012\u6216\u8d1f\u9762\u5f3a\u8c03\u4fe1\u53f7\u3002',
  },
  {
    pattern: /(?:\u5750.{0,3}\u5e74.{0,3}\u7262.{0,8}(?:\u518d\u8bf4|\u5427|\u5148)|(?:\u53bb|\u8be5|\u5e94\u8be5).{0,6}\u5750\u7262|\u5750\u7262.{0,8}(?:\u518d\u8bf4|\u5427|\u4e0d\u51a4|\u6d3b\u8be5))/u,
    term: '\u5750\u7262',
    family: 'attack',
    meaning: '\u5c06\u5bf9\u65b9\u6216\u76f8\u5173\u5bf9\u8c61\u548c\u201c\u5750\u7262\u201d\u8054\u7cfb\u8d77\u6765\uff0c\u5c24\u5176\u662f\u201c\u5750\u51e0\u5e74\u7262\u518d\u8bf4\u5427\u201d\u7c7b\u8868\u8fbe\uff0c\u662f\u5e26\u6709\u60e9\u7f5a\u671f\u5f85\u548c\u654c\u610f\u7684\u653b\u51fb\u6027\u8bc4\u4ef7\u3002',
  },
  {
    pattern: /(?:\u7b11\u54ed|\[\u7b11\u54ed\]|\u6f14\u4e0d\u4e0b\u53bb|\u6298\u817e).{0,32}\u5927\u7239|\u5927\u7239.{0,32}(?:\u7b11\u54ed|\[\u7b11\u54ed\]|\u6f14\u4e0d\u4e0b\u53bb|\u6298\u817e)/u,
    term: '\u5927\u7239',
    family: 'attack',
    meaning: '\u201c\u5927\u7239\u201d\u5728\u201c\u6298\u817e\u201d\u3001\u201c\u6f14\u4e0d\u4e0b\u53bb\u201d\u548c\u7b11\u54ed\u8868\u60c5\u914d\u5408\u4e0b\u5e38\u662f\u5bf9\u5609\u5bbe\u6216\u4eba\u7269\u7684\u8bbd\u523a\u6027\u79f0\u547c\uff0c\u6307\u5176\u96be\u4f3a\u5019\u3001\u9738\u9053\u6216\u4ee4\u4eba\u53cd\u611f\u3002',
  },
  {
    pattern: /(?:\u8bf4\u4e2a\u7b11\u8bdd|[\u54c8\u563b\u5618]{2,}|哈哈|笑话).{0,24}\u6e05\u6d41|\u6e05\u6d41.{0,16}(?:\u5927\u5927\u6ef4|\u7b11\u8bdd|哈哈)/u,
    term: '\u6e05\u6d41\u53cd\u8bdd',
    family: 'attack',
    meaning: '\u201c\u8bf4\u4e2a\u7b11\u8bdd...\u6e05\u6d41\u201d\u628a\u8868\u9762\u79f0\u8d5e\u653e\u5728\u7b11\u8bdd\u548c\u5927\u7b11\u8bed\u5883\u91cc\uff0c\u5b9e\u9645\u662f\u53cd\u8bdd\u5426\u5b9a\u5bf9\u8c61\u6e05\u767d\u3001\u6b63\u9762\u6216\u503c\u5f97\u8d5e\u8bb8\u3002',
  },
  {
    pattern: /(?:\u6211\u6068|\u597d\u6068|\u6068\u6b7b).{0,20}(?:\u90a3\u4e9b|\u4f60|\u4ed6|\u5979|\u5bfc\u81f4|\u5bb3|\u8ba9)|(?:\u90a3\u4e9b|\u4f60|\u4ed6|\u5979).{0,20}(?:\u6211\u6068|\u597d\u6068|\u6068\u6b7b)/u,
    term: '\u597d\u6068',
    family: 'attack',
    meaning: '\u201c\u6211\u6068...\u597d\u6068\u201d\u5bf9\u5177\u4f53\u4eba\u6216\u7fa4\u4f53\u8868\u8fbe\u5f3a\u70c8\u654c\u610f\u548c\u8d1f\u9762\u60c5\u7eea\uff0c\u5728\u53d1\u8a00\u5206\u6790\u4e2d\u5e94\u4f5c\u4e3a\u653b\u51fb\u6027\u8bed\u6c14\u4fdd\u7559\u3002',
  },
  {
    pattern: /(?:\u6563\u4e86\u5427|(?:\u6bcf\u5e74|\u5929\u5929|\u53c8|一直).{0,8}\u5728).{0,12}\u7092\u4f5c|\u7092\u4f5c.{0,12}(?:\u6bcf\u5e74|\u6563\u4e86\u5427|\u522b\u6f14)/u,
    term: '\u7092\u4f5c',
    family: 'attack',
    meaning: '\u201c\u6563\u4e86\u5427\u3002\u6bcf\u5e74\u90fd\u5728\u7092\u4f5c\u201d\u662f\u5bf9\u4e8b\u4ef6\u6216\u4eba\u7269\u523b\u610f\u8425\u9500\u3001\u535a\u773c\u7403\u7684\u8d1f\u9762\u6307\u63a7\uff0c\u5c5e\u4e8e\u5426\u5b9a\u6027\u653b\u51fb\u3002',
  },
  {
    pattern: /(?:\u5168\u6293|抓起来|都抓).{0,8}\u597d\u5435|\u597d\u5435.{0,8}(?:\u5168\u6293|抓起来|吵死|烦死)|\u597d\u5435[!\uff01]{2,}/u,
    term: '\u597d\u5435',
    family: 'attack',
    meaning: '\u201c\u5168\u6293\uff01\uff01\uff01\u597d\u5435\uff01\uff01\u201d\u7c7b\u77ed\u8bc4\u628a\u566a\u97f3\u4e0d\u6ee1\u548c\u60e9\u7f5a\u6027\u8bed\u6c14\u7ed3\u5408\uff0c\u662f\u5bf9\u5bf9\u8c61\u6216\u573a\u9762\u7684\u5f3a\u70c8\u8d1f\u9762\u62b1\u6028\u3002',
  },
  {
    pattern: /\u4eba\u810f\u7684\u4eba.{0,8}\u770b\u4ec0\u4e48\u90fd\u810f|\u770b\u4ec0\u4e48\u90fd\u810f.{0,8}\u4eba\u810f/u,
    term: '\u4eba\u810f\u7684\u4eba',
    family: 'attack',
    meaning: '\u201c\u4eba\u810f\u7684\u4eba\u770b\u4ec0\u4e48\u90fd\u810f\u201d\u662f\u628a\u5bf9\u65b9\u5b9a\u6027\u4e3a\u601d\u60f3\u6216\u4eba\u54c1\u810f\u7684\u9690\u6027\u8fb1\u9a82\uff0c\u5e38\u7528\u4e8e\u53cd\u51fb\u6216\u8d2c\u635f\u5bf9\u65b9\u52a8\u673a\u3002',
  },
  {
    pattern: /^[\s"'“”‘’「」『』]*\u771f\u4f1a[\s"'“”‘’「」『』!！。.?？]*$/u,
    term: '\u771f\u4f1a',
    family: 'attack',
    meaning: '\u5355\u72ec\u6216\u77ed\u53e5\u4e2d\u7684\u201c\u771f\u4f1a\u201d\u5e38\u662f\u7701\u7565\u5bbe\u8bed\u7684\u53cd\u8bdd\uff0c\u8868\u793a\u201c\u771f\u4f1a\u641e/\u771f\u4f1a\u4f5c\u201d\u5f0f\u7684\u88ab\u52a8\u653b\u51fb\u548c\u5426\u5b9a\u8bed\u6c14\u3002',
  },
  {
    pattern: /[\u4e00-\u9fffA-Za-z0-9]{1,12}\u662f?\u975e\u7528\u4e0d\u53ef\u5417|\u975e\u7528\u4e0d\u53ef\u5417/u,
    term: '\u975e\u7528\u4e0d\u53ef\u5417',
    family: 'attack',
    meaning: '\u201cX\u662f\u975e\u7528\u4e0d\u53ef\u5417\u201d\u5f0f\u53cd\u95ee\u901a\u5e38\u5728\u8bc4\u8bba\u533a\u8d28\u7591\u67d0\u4e2a\u9009\u9879\u88ab\u8fc7\u5ea6\u63a8\u5d07\u6216\u5f3a\u5236\u4f7f\u7528\uff0c\u5e26\u6709\u660e\u786e\u5426\u5b9a\u548c\u8d2c\u4e49\u8bed\u6c14\u3002',
  },
  {
    pattern: /(?:\u4f60|\u4ed6|\u5979|\u5b83|\u8fd9\u4eba|\u90a3\u4eba).{0,4}\u6b7b\u5b9a\u4e86|\u6b7b\u5b9a\u4e86.{0,6}(?:\u4f60|\u4ed6|\u5979|\u5b83)/u,
    term: '\u6b7b\u5b9a\u4e86',
    family: 'attack',
    meaning: '\u201c\u4ed6/\u5979\u6b7b\u5b9a\u4e86\u201d\u5728\u8bc4\u8bba\u8bed\u5883\u4e2d\u5e38\u662f\u5bf9\u4ed6\u4eba\u7684\u6076\u610f\u9884\u5224\u3001\u8bc5\u5492\u6216\u5a01\u80c1\u5f0f\u5938\u5f20\uff0c\u5e94\u4fdd\u7559\u5176\u654c\u610f\u8bed\u6c14\u3002',
  },
  {
    pattern: /(?:\u6211\u662f|\u8fd9\u4e2a|\u8fd9|\u771f|\u592a).{0,4}\u771f\u559c\u6b22|\u771f\u559c\u6b22[!\uff01\u3002.]*$/u,
    term: '\u771f\u559c\u6b22',
    family: 'cooperation',
    meaning: '\u201c\u771f\u559c\u6b22\u201d\u662f\u660e\u786e\u7684\u9ad8\u5f3a\u5ea6\u559c\u7231\u548c\u8d5e\u540c\u8868\u8fbe\uff0c\u5728\u8bc4\u8bba\u5206\u6790\u4e2d\u5e94\u7eb3\u5165\u6b63\u5411\u5408\u4f5c/\u652f\u6301\u8bed\u6c14\u3002',
  },
  {
    pattern: /(?:\u6cd5\u9662\u89c1.{0,12}\u6572\u8bc8|\u6572\u8bc8.{0,12}\u6cd5\u9662\u89c1|(?:\u4f60|\u4ed6|\u5979).{0,4}\u6572\u8bc8\u6211)/u,
    term: '\u4f60\u6572\u8bc8\u6211',
    family: 'attack',
    meaning: '\u201c\u4f60\u6572\u8bc8\u6211\u201d\u6216\u201c\u6cd5\u9662\u89c1\u201d\u914d\u5408\u6572\u8bc8\u6307\u63a7\u662f\u5bf9\u5bf9\u65b9\u8fdd\u6cd5\u6216\u4e0d\u5f53\u7d22\u8d54\u7684\u76f4\u63a5\u654c\u610f\u6027\u6307\u63a7\u3002',
  },
  {
    pattern: /(?:\u517b\u72d7\u7684\u4eba|\u72d7\u4e3b\u4eba|\u72d7\u4e3b).{0,12}\u81ea\u79c1|\u81ea\u79c1.{0,12}(?:\u517b\u72d7\u7684\u4eba|\u72d7\u4e3b\u4eba|\u72d7\u4e3b)/u,
    term: '\u517b\u72d7\u7684\u4eba\u81ea\u79c1',
    family: 'attack',
    meaning: '\u5c06\u201c\u517b\u72d7\u7684\u4eba\u201d\u7fa4\u4f53\u76f4\u63a5\u6807\u7b7e\u4e3a\u201c\u81ea\u79c1\u201d\u662f\u9762\u5411\u4eba\u7fa4\u7684\u8d1f\u9762\u9053\u5fb7\u8bc4\u4ef7\uff0c\u5c5e\u4e8e\u7fa4\u4f53\u8d2c\u635f\u6027\u653b\u51fb\u3002',
  },
  {
    pattern: /\u81ed\s*\u4e0d\u8981\s*\u8138|\u4e0d\u8981\s*\u8138.{0,8}(?:\u81ed|\u771f|\u592a|\u5427)|(?:\u4f60|\u4ed6|\u5979|\u8fd9|up|UP).{0,8}\u4e0d\u8981\s*\u8138/u,
    term: '\u81ed\u4e0d\u8981\u8138',
    family: 'attack',
    meaning: '\u201c\u81ed\u4e0d\u8981\u8138\u201d\u53ca\u7a7a\u683c\u5206\u9694\u53d8\u4f53\u662f\u76f4\u63a5\u7f9e\u8fb1\u5bf9\u65b9\u4e0d\u77e5\u7f9e\u803b\u3001\u539a\u8138\u76ae\u7684\u4eba\u8eab\u653b\u51fb\u3002',
  },
  {
    pattern: /(?:\u9a97\u5b66\u8d39.{0,12}(?:\u4e0d\u7ed9\u6bd5\u4e1a|\u6bd5\u4e0d\u4e86)|(?:\u4e0d\u7ed9\u6bd5\u4e1a|\u6bd5\u4e0d\u4e86).{0,12}\u9a97\u5b66\u8d39)/u,
    term: '\u9a97\u5b66\u8d39\u4e0d\u7ed9\u6bd5\u4e1a',
    family: 'attack',
    meaning: '\u201c\u9a97\u5b66\u8d39\u8fd8\u4e0d\u7ed9\u6bd5\u4e1a\u201d\u662f\u5bf9\u5b66\u6821\u6216\u673a\u6784\u6b3a\u8bc8\u548c\u635f\u5bb3\u5b66\u751f\u6743\u76ca\u7684\u76f4\u63a5\u6307\u63a7\uff0c\u5c5e\u4e8e\u660e\u786e\u8d1f\u9762\u653b\u51fb\u3002',
  },
  {
    pattern: /(?:^|[^\u4e00-\u9fff])\u6076\u72d7(?:$|[^\u4e00-\u9fff])|(?:\u4f60|\u4ed6|\u5979|\u8fd9|up|\u4e3b\u64ad|\u5bf9\u9762).{0,8}\u6076\u72d7|\u6076\u72d7.{0,8}(?:\u4e00\u6837|\u5420|\u54ac|\u6025\u4e86|\u4f60|\u4ed6|\u5979)/u,
    term: '\u6076\u72d7',
    family: 'attack',
    meaning: '\u201c\u6076\u72d7\u201d\u7528\u4f5c\u4eba\u6216\u7fa4\u4f53\u6807\u7b7e\u65f6\u662f\u52a8\u7269\u5316\u8d2c\u635f\uff0c\u901a\u5e38\u8868\u793a\u51f6\u6076\u3001\u4e71\u54ac\u6216\u4e0d\u53ef\u7406\u55bb\u7684\u653b\u51fb\u6027\u8bc4\u4ef7\u3002',
  },
  {
    pattern: /(?:^|[^\u4e00-\u9fff])\u6709\u54c1[!\uff01\u3002.]*$|\u6709\u54c1.{0,8}(?:\u597d\u770b|\u771f\u4e0d\u9519|\u592a\u4f1a|\u559c\u6b22|\u54c1\u5473)/u,
    term: '\u6709\u54c1',
    family: 'cooperation',
    meaning: '\u201c\u6709\u54c1\u201d\u5728\u8bc4\u8bba\u4e2d\u5e38\u7528\u4f5c\u79f0\u8d5e\u5bf9\u65b9\u5ba1\u7f8e\u6216\u9009\u62e9\u6709\u54c1\u5473\uff0c\u662f\u660e\u786e\u7684\u6b63\u5411\u652f\u6301\u4fe1\u53f7\u3002',
  },
  {
    pattern: /(?:\u505a\u5f97\u5f88\u597d|\u505a\u7684\u5f88\u597d|\u505a\u5f97\u771f\u597d|\u505a\u7684\u771f\u597d)/u,
    term: '\u505a\u5f97\u5f88\u597d',
    family: 'cooperation',
    meaning: '\u201c\u505a\u5f97\u5f88\u597d\u201d\u662f\u5bf9\u4f5c\u54c1\u3001\u64cd\u4f5c\u6216\u8868\u73b0\u7684\u76f4\u63a5\u80af\u5b9a\uff0c\u5728\u53d1\u8a00\u5206\u6790\u4e2d\u5e94\u4f5c\u4e3a\u6b63\u5411\u5408\u4f5c/\u652f\u6301\u8bed\u6c14\u4fdd\u7559\u3002',
  },
  {
    pattern: /(?:\u8d85\u7ea7\u559c\u6b22\u4f60|\u8d85\u7ea7\u559c\u6b22.{0,6}(?:\u4f60|\u4ed6|\u5979|\u8fd9\u4e2a|\u8fd9\u79cd))/u,
    term: '\u8d85\u7ea7\u559c\u6b22\u4f60',
    family: 'cooperation',
    meaning: '\u201c\u8d85\u7ea7\u559c\u6b22\u201d\u662f\u9ad8\u5f3a\u5ea6\u559c\u7231\u6216\u652f\u6301\u8868\u8fbe\uff0c\u5c5e\u4e8e\u660e\u786e\u6b63\u5411\u6001\u5ea6\u800c\u975e\u4e2d\u6027\u53d9\u8ff0\u3002',
  },
  {
    pattern: /(?:\u62b1\u7740|\u62c9\u7740|\u5e26\u7740|\u4e00\u8d77|\u53bb).{0,12}(?:\u81ea\u706b|\u81ea\u711a)|(?:\u81ea\u706b|\u81ea\u711a).{0,12}(?:\u4e00\u8d77|\u62b1\u7740|\u62c9\u7740|\u5e26\u7740)/u,
    term: '\u81ea\u706b/\u81ea\u711a',
    family: 'attack',
    meaning: '\u201c\u62b1\u7740...\u4e00\u8d77\u81ea\u706b/\u81ea\u711a\u201d\u7c7b\u8bf4\u6cd5\u5c06\u81ea\u4f24\u6216\u66b4\u529b\u753b\u9762\u7528\u4f5c\u5bf9\u4ed6\u4eba\u7684\u653b\u51fb\u6027\u8868\u8fbe\uff1b\u201c\u81ea\u706b\u201d\u5e38\u662f\u201c\u81ea\u711a\u201d\u7684\u9519\u5b57\u6216\u5f39\u5e55\u53d8\u4f53\uff0c\u9700\u4fdd\u7559\u5176\u6781\u7aef\u8d1f\u9762\u8bed\u6c14\u3002',
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
  {
    pattern: /(?:\u4e0d\u662f\u53c8.{0,8}(?:K\u7ebf|k\u7ebf|\u753b\u7ebf).{0,4}(?:\u5427|\u5417|[?\uff1f])|\u53c8.{0,4}\u753bK\u7ebf)/u,
    term: '\u4e0d\u662f\u53c8\u753bK\u7ebf\u5427',
    family: 'attack',
    meaning: '\u201c\u4e0d\u662f\u53c8\u753bK\u7ebf\u5427\u201d\u5728\u6295\u8d44\u3001\u6570\u636e\u6216\u8206\u8bba\u8bed\u5883\u91cc\u5e38\u662f\u53cd\u95ee\u5f0f\u8d28\u7591\uff0c\u6697\u793a\u5bf9\u65b9\u53c8\u5728\u64cd\u76d8\u3001\u9020\u52bf\u6216\u641e\u5957\u8def\u3002',
  },
  {
    pattern: /(?:\u7ee7\u7eed(?:\u505a|\u66f4|\u52aa\u529b|[\u4e00-\u9fff]{0,4})\u4e0b\u53bb\u5427|\u4eba\u65e0\u5b8c\u4eba|\u7ee7\u7eed\u52a0\u6cb9)/u,
    term: '\u7ee7\u7eed\u505a\u4e0b\u53bb\u5427',
    family: 'cooperation',
    meaning: '\u5bf9UP\u4e3b\u6216\u521b\u4f5c\u8005\u8bf4\u201c\u7ee7\u7eed\u505a\u4e0b\u53bb\u5427\u201d\u3001\u201c\u4eba\u65e0\u5b8c\u4eba\u201d\u662f\u660e\u786e\u652f\u6301\u3001\u9f13\u52b1\u548c\u7f13\u548c\u6279\u8bc4\u7684\u5408\u4f5c\u6027\u8bed\u6c14\u3002',
  },
  {
    pattern: /(?:\u6211|\u4f60|\u4ed6|\u5979|\u54b1|\u54b1\u4eec|[\u4e00-\u9fff]{1,6})\u4ed6\u5988(?:\u7684)?|(?:\u7b97\u8d26|\u627e\u4f60\u4eec\u7b97\u8d26).{0,8}(?:\u4ed6\u5988|\u6765\u627e)|\u4ed6\u5988.{0,12}\u7b97\u8d26/u,
    term: '\u4ed6\u5988/\u7b97\u8d26',
    family: 'attack',
    meaning: '\u201c\u4ed6\u5988\u201d\u662f\u4e2d\u6587\u5e38\u89c1\u7c97\u53e3\u5f3a\u8bed\u6c14\uff0c\u4e0e\u201c\u627e\u4f60\u4eec\u7b97\u8d26\u201d\u7b49\u5bf9\u8c61\u6307\u5411\u8868\u8fbe\u5408\u7528\u65f6\u5e94\u4f5c\u4e3a\u654c\u610f\u6216\u653b\u51fb\u4fe1\u53f7\u4fdd\u7559\u3002',
  },
  {
    pattern: /(?:\u6bcf\u4e2a\u4eba|\u4eba\u4eba|\u6240\u6709\u4eba|\u5927\u5bb6).{0,12}(?:\u90fd)?\u80af\u5b9a|\u80af\u5b9a.{0,8}(?:\u90fd|\u6bcf\u4e2a|\u4e00\u5b9a)/u,
    term: '\u80af\u5b9a',
    family: 'absolutes',
    meaning: '\u201c\u80af\u5b9a\u201d\u548c\u201c\u6bcf\u4e2a\u4eba\u90fd\u201d\u7b49\u8303\u56f4\u8bcd\u8fde\u7528\u65f6\u662f\u5f3a\u786e\u4fe1\u3001\u7edd\u5bf9\u5316\u5224\u65ad\uff0c\u5e94\u4f5c\u4e3a\u95ed\u5408\u5f0f\u65ad\u8a00\u4fdd\u7559\u3002',
  },
  {
    pattern: /(?:\u8fd9\u4e48\u8bf4|\u4f60\u8fd9\u4e48\u8bf4).{0,8}\u4f60\u5f88\u61c2(?:\u54e6|\u554a|\u5462|[?\uff1f])?/u,
    term: '\u4f60\u5f88\u61c2\u54e6',
    family: 'attack',
    meaning: '\u201c\u8fd9\u4e48\u8bf4\u4f60\u5f88\u61c2\u54e6\u201d\u662f\u9634\u9633\u602a\u6c14\u5f0f\u53cd\u8bbd\uff0c\u901a\u5e38\u7528\u6765\u8d28\u7591\u5bf9\u65b9\u88c5\u61c2\u6216\u81ea\u4ee5\u4e3a\u61c2\u3002',
  },
  {
    pattern: /(?:\u90fd\u662f|\u53ea\u662f|\u4e0d\u8fc7\u662f).{0,4}\u6897.{0,6}(?:\u522b|\u4e0d\u8981)\u8ba4\u771f|\u522b\u8ba4\u771f.{0,6}(?:\u6897|\u73a9\u6897)/u,
    term: '\u90fd\u662f\u6897\u522b\u8ba4\u771f',
    family: 'evasion',
    meaning: '\u201c\u90fd\u662f\u6897\uff0c\u522b\u8ba4\u771f\u201d\u628a\u4e89\u8bae\u6216\u6279\u8bc4\u964d\u683c\u4e3a\u73a9\u6897\uff0c\u5e38\u7528\u6765\u56de\u907f\u5b9e\u8d28\u8ba8\u8bba\u6216\u51cf\u5f31\u8d23\u4efb\u3002',
  },
  {
    pattern: /(?:\u804c\u4e1a)?\u53eb\u82b1(?:\u5b50|\uff1f|\?|$)|(?:\u8ba8\u996d|\u4e5e\u4e10).{0,6}(?:\u804c\u4e1a|\u4e13\u4e1a)/u,
    term: '\u804c\u4e1a\u53eb\u82b1',
    family: 'attack',
    meaning: '\u201c\u804c\u4e1a\u53eb\u82b1\u201d\u5c06\u5bf9\u8c61\u8d2c\u4e3a\u4e5e\u8ba8\u8005\u6216\u5356\u60e8\u8005\uff0c\u662f\u5bf9\u52a8\u673a\u548c\u4eba\u683c\u7684\u8d2c\u635f\u6027\u6307\u63a7\u3002',
  },
  {
    pattern: /(?:\u4f60|\u4ed6|\u5979|\u5b83|ta|TA|[\u4e00-\u9fffA-Za-z0-9]{1,8}).{0,8}\u8ba8\u538c|\u8ba8\u538c.{0,8}(?:\u4f60|\u4ed6|\u5979|\u5b83|ta|TA)/u,
    term: '\u8ba8\u538c',
    family: 'attack',
    meaning: '\u5bf9\u5177\u4f53\u4eba\u3001\u89d2\u8272\u6216\u7fa4\u4f53\u8bf4\u201c\u8ba8\u538c\u201d\u662f\u660e\u786e\u7684\u8d1f\u9762\u8bc4\u4ef7\u548c\u538c\u6076\u8868\u8fbe\uff0c\u5728\u8bdd\u8bed\u5206\u6790\u4e2d\u5e94\u6807\u4e3a\u653b\u51fb\u6027\u8bed\u6c14\u3002',
  },
  {
    pattern: /(?:\u6545\u610f.{0,4}\u778e(?:\u7ffb\u8bd1|\u7ffb)|\u778e(?:\u7ffb\u8bd1|\u7ffb).{0,6}\u6545\u610f)/u,
    term: '\u6545\u610f\u778e\u7ffb\u8bd1',
    family: 'attack',
    meaning: '\u6307\u8d23\u7ffb\u8bd1\u6216\u521b\u4f5c\u65b9\u201c\u6545\u610f\u778e\u7ffb\u8bd1\u201d\u662f\u5bf9\u80fd\u529b\u548c\u52a8\u673a\u7684\u8d1f\u9762\u5224\u65ad\uff0c\u4e0d\u662f\u4e2d\u6027\u7ffb\u8bd1\u8ba8\u8bba\u3002',
  },
  {
    pattern: /(?:^|[，,。！？!?\s])\u4f60\u4fe1\u5417(?:[？?。！!]|$)|(?:\u8fd9|\u8c01|\u8fd8).{0,8}\u4f60\u4fe1\u5417/u,
    term: '\u4f60\u4fe1\u5417',
    family: 'evidence',
    meaning: '\u201c\u4f60\u4fe1\u5417\u201d\u5728\u4e89\u8bae\u8bed\u5883\u91cc\u901a\u5e38\u662f\u5bf9\u8bf4\u6cd5\u771f\u5b9e\u6027\u7684\u53cd\u95ee\u548c\u8d28\u7591\uff0c\u6697\u542b\u9700\u8981\u8bc1\u636e\u6216\u4e0d\u76f8\u4fe1\u5bf9\u65b9\u8bf4\u6cd5\u3002',
  },
  {
    pattern: /(?:\u4e2a|\u6709\u4e2a|\u4ec0\u4e48)\u6bdb\u7ebf|\u6bdb\u7ebf(?:[，,。！？!?\s]|$)/u,
    term: '\u4e2a\u6bdb\u7ebf',
    family: 'attack',
    meaning: '\u201c\u4e2a\u6bdb\u7ebf\u201d\u662f\u7c97\u4fd7\u5426\u5b9a\u548c\u8f7b\u8511\u5f0f\u56de\u5e94\uff0c\u5e38\u7528\u6765\u76f4\u63a5\u9a73\u65a5\u6216\u8d2c\u4f4e\u524d\u4e00\u8bf4\u6cd5\u3002',
  },
  {
    pattern: /\u90fd\u8bf4.{0,4}(?:\u516b\u767e\u904d|\d+\u904d)\u4e86/u,
    term: '\u90fd\u8bf4\u516b\u767e\u904d\u4e86',
    family: 'absolutes',
    meaning: '\u201c\u90fd\u8bf4\u516b\u767e\u904d\u4e86\u201d\u7528\u6781\u7aef\u6b21\u6570\u5938\u5f20\u6765\u8868\u793a\u8bdd\u9898\u5df2\u88ab\u5b8c\u5168\u8bf4\u6e05\uff0c\u5e26\u6709\u5c01\u95ed\u8ba8\u8bba\u7684\u7edd\u5bf9\u5316\u8bed\u6c14\u3002',
  },
  {
    pattern: /\u5206\u4e0d\u6e05\u8f7b\u91cd/u,
    term: '\u5206\u4e0d\u6e05\u8f7b\u91cd',
    family: 'attack',
    meaning: '\u201c\u5206\u4e0d\u6e05\u8f7b\u91cd\u201d\u76f4\u63a5\u8d2c\u4f4e\u5bf9\u65b9\u5224\u65ad\u529b\u548c\u5904\u4e8b\u80fd\u529b\uff0c\u662f\u9488\u5bf9\u4eba\u6216\u7fa4\u4f53\u7684\u8d1f\u9762\u8bc4\u4ef7\u3002',
  },
  {
    pattern: /\u90fd\u662f\u540c\u4e00\u6279/u,
    term: '\u90fd\u662f\u540c\u4e00\u6279',
    family: 'absolutes',
    meaning: '\u201c\u90fd\u662f\u540c\u4e00\u6279\u201d\u628a\u591a\u4e2a\u5bf9\u8c61\u4e00\u6982\u5f52\u4e3a\u540c\u4e00\u7fa4\u4f53\u6216\u540c\u4e00\u5957\u8def\uff0c\u662f\u7edd\u5bf9\u5316\u7fa4\u4f53\u6982\u62ec\u3002',
  },
  {
    pattern: /\u90a3\u522b\u6765\u5c31\u884c|\u90a3\u5c31\u522b\u6765/u,
    term: '\u90a3\u522b\u6765\u5c31\u884c',
    family: 'evasion',
    meaning: '\u201c\u90a3\u522b\u6765\u5c31\u884c\u201d\u7528\u6392\u9664\u5f0f\u547d\u4ee4\u4ee3\u66ff\u8ba8\u8bba\u95ee\u9898\u672c\u8eab\uff0c\u5e38\u662f\u56de\u907f\u8d28\u7591\u6216\u628a\u5bf9\u65b9\u76f4\u63a5\u8d76\u51fa\u8ba8\u8bba\u7684\u8bed\u6c14\u3002',
  },
  {
    pattern: /\u4ec0\u4e48.{0,16}\u6210\u672c\u51e0\u5757\u94b1[\uff1f?]{1,}|\u6210\u672c\u51e0\u5757\u94b1[\uff1f?]{1,}/u,
    term: '\u6210\u672c\u51e0\u5757\u94b1',
    family: 'attack',
    meaning: '\u201c\u6210\u672c\u51e0\u5757\u94b1\uff1f\uff1f\u201d\u5728\u5b9a\u4ef7\u6216\u7528\u6599\u8ba8\u8bba\u91cc\u662f\u5bf9\u5546\u5bb6\u66b4\u5229\u3001\u7c97\u5236\u6216\u4ef7\u683c\u4e0d\u503c\u7684\u5632\u8bbd\u6027\u8d28\u95ee\u3002',
  },
  {
    pattern: /\u9ad8\u6750\u751f.{0,12}(?:\u90fd)?\u8dd1\u4e86.{0,8}\u54c8{2,}|\u54c8{2,}.{0,8}\u9ad8\u6750\u751f.{0,12}\u8dd1\u4e86/u,
    term: '\u9ad8\u6750\u751f\u90fd\u8dd1\u4e86',
    family: 'attack',
    meaning: '\u201c\u9ad8\u6750\u751f\u90fd\u8dd1\u4e86\u54c8\u54c8\u201d\u628a\u201c\u9ad8\u6750\u751f\u201d\u653e\u5728\u5927\u7b11\u548c\u9003\u79bb\u8bed\u5883\u91cc\uff0c\u901a\u5e38\u662f\u5632\u8bbd\u524d\u8005\u88ab\u5413\u8dd1\u6216\u4e0d\u582a\u4e00\u51fb\u3002',
  },
  {
    pattern: /\u7d20\u83dc\u8364\u4ef7/u,
    term: '\u7d20\u83dc\u8364\u4ef7',
    family: 'attack',
    meaning: '\u201c\u7d20\u83dc\u8364\u4ef7\u201d\u7528\u83dc\u54c1\u6bd4\u55bb\u6279\u8bc4\u67d0\u7269\u4ef7\u683c\u865a\u9ad8\u3001\u6027\u4ef7\u6bd4\u4f4e\uff0c\u662f\u5bf9\u5b9a\u4ef7\u6216\u5356\u65b9\u7684\u8d1f\u9762\u8bc4\u4ef7\u3002',
  },
  {
    pattern: /\u4f60\u8fd8.{0,8}\u6a21\u4eff.{0,12}\u54c8{2,}|\u4f60\u8fd8[\p{Script=Han}A-Za-z0-9]{1,8}[\uff01!].{0,12}\u54c8{3,}/u,
    term: '\u4f60\u8fd8\u6a21\u4eff',
    family: 'attack',
    meaning: '\u201c\u4f60\u8fd8\u6a21\u4eff\uff01\u54c8\u54c8\u54c8\u201d\u662f\u5bf9\u5bf9\u65b9\u884c\u4e3a\u7684\u620f\u5f04\u5f0f\u5632\u8bbd\uff0c\u5927\u7b11\u8bed\u6c14\u5f3a\u5316\u4e86\u8d2c\u4f4e\u548c\u4e0d\u5c51\u3002',
  },
  {
    pattern: /\u5efa\u4e2a\u7fa4\u5427|\u7ed9\u54b1\u4eec\u5efa\u4e2a\u7fa4|\u62c9\u4e2a\u7fa4/u,
    term: '\u5efa\u4e2a\u7fa4\u5427',
    family: 'cooperation',
    meaning: '\u201c\u5efa\u4e2a\u7fa4\u5427\u201d\u8868\u793a\u5efa\u7acb\u7fa4\u804a\u3001\u7ec4\u7ec7\u4ea4\u6d41\u6216\u540e\u7eed\u534f\u4f5c\u7684\u610f\u56fe\uff0c\u5e94\u4f5c\u4e3a\u5408\u4f5c/\u7ec4\u7ec7\u6027\u8bed\u6c14\u4fdd\u7559\u3002',
  },
  {
    pattern: /\u6211\u4e5f\u60f3\u5b66|\u6211\u4e5f\u662f.{0,4}\u60f3\u5b66|\u6211\u4e5f\u8981\u5b66/u,
    term: '\u6211\u4e5f\u60f3\u5b66',
    family: 'cooperation',
    meaning: '\u201c\u6211\u4e5f\u60f3\u5b66\u201d\u8868\u8fbe\u8ddf\u968f\u5b66\u4e60\u3001\u8bf7\u6559\u6216\u52a0\u5165\u4ea4\u6d41\u7684\u610f\u613f\uff0c\u5728\u5e16\u5427/BBS\u8bed\u5883\u4e2d\u5e38\u662f\u6e29\u548c\u7684\u5408\u4f5c\u4fe1\u53f7\u3002',
  },
];

function detectSupplementalSemanticHits(comment) {
  const message = cleanComment(comment);
  if (!message) return [];
  return SUPPLEMENTAL_SEMANTICS
    .filter((item) => item.pattern.test(message))
    .filter((item) => !isSuppressedSupplementalHit(item, message))
    .map((item) => summarizeHit(item));
}

function isSuppressedSupplementalHit(item, message) {
  if (item?.term === '\u5efa\u4e2a\u7fa4\u5427') {
    return /\u6211\u4e5f\u662f\u5c0f\u767d.{0,16}\u5efa\u4e2a\u7fa4\u5427/u.test(message);
  }
  return false;
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

function isLiteralTrafficContext(entry, message) {
  if (entry?.family !== 'attack') return false;
  if (String(entry?.term || '') !== '\u6d41\u91cf') return false;
  return /(?:\u5370\u5ea6|\u56fd\u5185|\u56fd\u5916|\u5e73\u53f0|\u89c6\u9891|\u76f4\u64ad|\u7f51\u7ad9|\u8d26\u53f7|\u81ea\u5a92\u4f53).{0,12}\u6d41\u91cf|\u6d41\u91cf.{0,12}(?:\u5f88\u5927|\u5927|\u5c0f|\u9ad8|\u4f4e|\u591a|\u5c11|\u5bc6\u7801|\u5165\u53e3|\u63a8\u8350|\u66dd\u5149)/u.test(message);
}

function isNeutralSpeculativeBroadener(entry, message) {
  const term = String(entry?.term || '');
  if (entry?.family === 'absolutes' && term === '\u90fd\u662f') {
    return /(?:\u5e94\u8be5|\u53ef\u80fd|\u5927\u6982|\u4f30\u8ba1).{0,12}\u90fd\u662f/u.test(message)
      || /\u90fd\u662f.{0,12}(?:\u60f3|\u6765|\u53bb|\u505a|\u770b|\u4e70|\u5356)/u.test(message)
      || /\u8fd9\u53e5[“"']?[^”"']{0,20}\u90fd\u662f[^”"']{0,20}[”"']?.{0,12}(?:\u641e\u7b11|\u597d\u7b11|\u7b11\u6b7b|\u96be\u7ef7|\u96be\u868c)/u.test(message);
  }
  if (entry?.family === 'cooperation' && term === '\u5e94\u8be5') {
    return /\u5e94\u8be5.{0,12}(?:\u90fd\u662f|\u662f|\u60f3|\u80fd|\u4f1a|\u53ef\u4ee5)/u.test(message);
  }
  return false;
}

function isSarcasticNanbengContext(entry, message) {
  if (entry?.family !== 'cooperation') return false;
  const term = String(entry?.term || '');
  if (!['\u96be\u868c', '\u96be\u7ef7'].includes(term)) return false;
  return /(?:\u96be[\u868c\u7ef7].{0,8}(?:\u6807\u9898|\u5c5e\u5b9e|\u771f|\u6709\u70b9|\u4e86|\u4f4f)|(?:\u6807\u9898|\u5c5e\u5b9e).{0,6}\u96be[\u868c\u7ef7])/u.test(message);
}

function isRhetoricalFeelingWhyContext(entry, message) {
  if (entry?.family !== 'evidence' && entry?.family !== 'correction') return false;
  if (String(entry?.term || '') !== '\u4e3a\u4ec0\u4e48') return false;
  return /\u4e3a\u4ec0\u4e48.{0,12}(?:\u6709\u79cd|\u611f\u89c9|\u770b\u8d77\u6765|\u50cf|\u8fd9\u4e48|\u90a3\u4e48)/u.test(message)
    || /\u4e3a\u4ec0\u4e48.{0,20}\u611f\u89c9/u.test(message);
}

function isNeutralOutcomeNarrationContext(entry, message) {
  const term = String(entry?.term || '');
  if (entry?.family === 'cooperation' && term === '\u53ef\u80fd') {
    return /\u771f\u7684\u6709\u53ef\u80fd.{0,12}\u4e0a\u5cb8|\u6709\u53ef\u80fd.{0,12}(?:\u4e86|[，,。])/u.test(message);
  }
  if (entry?.family === 'cooperation' && term === '\u4e0a\u5cb8') {
    return /(?:\u6709\u53ef\u80fd|\u5982\u679c|\u5f53\u521d|\u6293\u4f4f).{0,20}\u4e0a\u5cb8\u4e86?/u.test(message);
  }
  return false;
}

function isPlayfulStandaloneLaughterContext(entry, message) {
  const term = String(entry?.term || '');
  if (!/^\u54c8{2,}$/.test(term)) return false;
  if (!/\u54c8{2,}/u.test(message)) return false;
  return /(?:^|[，,。！？!?\s])(?:\u70b8\u4e86|\u7b11\u6b7b|\u7b11\u4e86|\u7edd\u4e86)?[^，,。！？!?]{0,12}\u54c8{2,}(?:\u54ce|\u554a|\u6b38)?(?:$|[，,。！？!?\s])/u.test(message)
    && !/(?:\u4f60|\u4ed6|\u5979|\u5b83|\u4ed6\u4eec|\u5979\u4eec|\u8fd9\u4eba|\u90a3\u4eba|up|UP).{0,8}(?:\u8822|\u50bb|\u72d7|\u5e9f|\u83dc|\u6eda|\u6b7b)/u.test(message);
}

function isPassiveCriticismReportContext(entry, message) {
  if (entry?.family !== 'attack') return false;
  if (String(entry?.term || '') !== '\u88ab\u9a82') return false;
  return /(?:\u867d\u7136|\u7ecf\u5e38|\u5929\u5929|\u8001\u662f|\u603b\u662f).{0,8}\u88ab\u9a82/u.test(message)
    || /\u88ab\u9a82.{0,16}(?:\u4f46|\u4f46\u662f|\u4e0d\u8fc7|\u53ef|\u5176\u5b9e|\u786e\u5b9e|\u8fd8\u53ef\u4ee5)/u.test(message);
}

function isPositiveNicknameContext(entry, message) {
  if (entry?.family !== 'attack') return false;
  if (String(entry?.term || '') !== '\u5c11\u7fbd') return false;
  return /\u5c11\u7fbd.{0,8}(?:\u8d85|\u771f|\u5f88)?(?:\u725b\u6bd4|\u725b\u903c|\u725b|\u5389\u5bb3|\u5f3a|\u5e05|\u597d)/u.test(message);
}

function isEmbeddedLatinAcronymContext(entry, message) {
  const term = String(entry?.term || '');
  if (term !== 'nb') return false;
  return !/(^|[^a-z0-9])nb(?=$|[^a-z0-9])/iu.test(message);
}

function isLiteralCrushDeathContext(entry, message) {
  if (entry?.family !== 'attack') return false;
  if (String(entry?.term || '') !== '\u6b7b\u4e86') return false;
  return /(?:\u538b|\u8e29|\u780d|\u5939|\u6454|\u7838)\u6b7b\u4e86?.{0,8}(?:\u58c1\u864e|\u866b|\u868a|\u82cd\u8747|\u87d1\u8782|\u86c7|\u9c7c|\u9f20|\u732b|\u72d7|\u52a8\u7269)/u.test(message);
}

function isNeutralAdultSiteLookalikeContext(entry, message) {
  if (entry?.family !== 'cooperation') return false;
  if (String(entry?.term || '') !== '\u65e2\u89c6\u611f') return false;
  return /(?:^|[^A-Za-z0-9])(?:FC2|fc2|AV|av|P站|p\u7ad9|成人视频|成人).{0,8}\u65e2\u89c6\u611f/u.test(message);
}

function isSuppressedLexicalHit(entry, message) {
  return isSelfReferentialNoviceHit(entry, message)
    || isLiteralYinYangContext(entry, message)
    || isFactualNoHaveContext(entry, message)
    || isLogicalNotIsContext(entry, message)
    || isLiteralTrafficContext(entry, message)
    || isNeutralSpeculativeBroadener(entry, message)
    || isRhetoricalFeelingWhyContext(entry, message)
    || isNeutralOutcomeNarrationContext(entry, message)
    || isPlayfulStandaloneLaughterContext(entry, message)
    || isPassiveCriticismReportContext(entry, message)
    || isPositiveNicknameContext(entry, message)
    || isEmbeddedLatinAcronymContext(entry, message)
    || isSarcasticNanbengContext(entry, message)
    || isLiteralCrushDeathContext(entry, message)
    || isNeutralAdultSiteLookalikeContext(entry, message);
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
  if (isScrapeDiagnosticMessage(message)) {
    return {
      covered: true,
      mode: 'neutral',
      reason: 'scrape diagnostic line, not user speech',
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
