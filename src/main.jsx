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
import './styles.css';

const researchFrames = [
  {
    label: '线上去抑制',
    source: 'Suler, 2004',
    claim: '匿名性、不可见性与异步反馈会降低自我约束，使挑衅更容易发生。',
  },
  {
    label: '动机性推理',
    source: 'Kunda / confirmation bias literature',
    claim: '个体会选择性寻找支持自身立场的信息，并更苛刻地处理反证。',
  },
  {
    label: '认知闭合需求',
    source: 'Webster & Kruglanski, 1994',
    claim: '高闭合需求者倾向快速定论，回避歧义和条件化解释。',
  },
  {
    label: '语用论辩',
    source: 'van Eemeren & Grootendorst',
    claim: '谬误可视为破坏批判性讨论规则的语言行动。',
  },
];

const users = [
  {
    id: 'u-4771',
    uid: 'UID 349872641',
    name: '山前反证员',
    bio: '科技区、社会议题高频评论者',
    sampleSize: 186,
    analyzed: 142,
    confidence: 0.82,
    stanceSwitchRate: 0.08,
    disagreementRate: 0.71,
    scores: [
      { axis: '对抗性动机', value: 84, benchmark: 52, note: '否定式开场和二人称指责显著高于样本基线。' },
      { axis: '认知闭合', value: 76, benchmark: 49, note: '较少使用条件限定，倾向把复杂问题压缩成单一原因。' },
      { axis: '证据敏感', value: 31, benchmark: 58, note: '被要求给证据时，多次转向反问或资格审查。' },
      { axis: '逻辑一致', value: 38, benchmark: 61, note: '常见偷换概念、稻草人和以偏概全。' },
      { axis: '合作讨论', value: 27, benchmark: 55, note: '少有澄清问题，更多是重申立场或转移焦点。' },
      { axis: '修正意愿', value: 18, benchmark: 46, note: '被指出事实错误后，承认或修正比例偏低。' },
    ],
    errors: [
      {
        id: 'e-01',
        type: '逻辑错误',
        severity: '高',
        comment: '你连这个都不懂还谈产业？国产替代就是骗补，哪个不是 PPT 项目？',
        highlight: '哪个不是 PPT 项目',
        diagnosis: '以偏概全 + 人身资格攻击。把部分失败案例扩展为全称判断，同时用“你懂不懂”替代论证。',
        evidence: '同主题 19 条评论中，15 条使用全称词，只有 2 条给出可核验案例。',
        confidence: 0.88,
      },
      {
        id: 'e-02',
        type: '事实错误',
        severity: '中',
        comment: 'B 站早就没有长视频创作者了，都是切片号。',
        highlight: '早就没有长视频创作者',
        diagnosis: '事实断言缺证。绝对化描述与平台仍存在长视频投稿的可观察事实冲突。',
        evidence: '评论未附来源；相邻回复中被要求给数据后转向“你自己搜”。',
        confidence: 0.74,
      },
      {
        id: 'e-03',
        type: '语义偷换',
        severity: '高',
        comment: '你说要看数据，其实就是给资本洗地。',
        highlight: '看数据 = 给资本洗地',
        diagnosis: '将方法论要求偷换成立场归属，破坏共同检验命题的讨论条件。',
        evidence: '近 30 天内 11 次把“证据/数据/来源”改写成阵营标签。',
        confidence: 0.91,
      },
      {
        id: 'e-04',
        type: '情绪化表达',
        severity: '中',
        comment: '笑死，这种观点也有人信，真是被营销洗傻了。',
        highlight: '洗傻了',
        diagnosis: '羞辱性标签提高冲突收益，降低被讨论对象的可反驳性。',
        evidence: '嘲讽词密度为 6.4 / 千字，高于对照评论集 P85。',
        confidence: 0.79,
      },
    ],
  },
  {
    id: 'u-9210',
    uid: 'UID 68190422',
    name: '冷启动观测站',
    bio: '数码区、游戏区混合评论者',
    sampleSize: 94,
    analyzed: 87,
    confidence: 0.69,
    stanceSwitchRate: 0.21,
    disagreementRate: 0.48,
    scores: [
      { axis: '对抗性动机', value: 53, benchmark: 52, note: '反驳频率偏高，但羞辱性语言不突出。' },
      { axis: '认知闭合', value: 45, benchmark: 49, note: '偶尔快速定论，也会接受局部条件。' },
      { axis: '证据敏感', value: 62, benchmark: 58, note: '经常要求来源，并能回应部分反证。' },
      { axis: '逻辑一致', value: 57, benchmark: 61, note: '存在类比过强问题，但主张结构大体清晰。' },
      { axis: '合作讨论', value: 64, benchmark: 55, note: '有澄清和让步，讨论推进性较好。' },
      { axis: '修正意愿', value: 49, benchmark: 46, note: '修正意愿接近样本均值。' },
    ],
    errors: [
      {
        id: 'e-11',
        type: '逻辑错误',
        severity: '低',
        comment: '这个优化像上次那款一样翻车，所以估计也撑不了多久。',
        highlight: '像上次那款一样',
        diagnosis: '弱类比。两个案例的硬件、版本和用户群差异未被控制。',
        evidence: '同类类比错误 4 次，均出现在游戏性能讨论中。',
        confidence: 0.61,
      },
      {
        id: 'e-12',
        type: '缺证断言',
        severity: '中',
        comment: '厂家肯定偷偷降规格了，不然不会这样。',
        highlight: '肯定偷偷降规格',
        diagnosis: '把单一结果直接归因到隐藏动机，缺少排除性证据。',
        evidence: '未比较批次、固件、使用环境；后续承认“只是猜测”。',
        confidence: 0.67,
      },
    ],
  },
];

const axisDescriptions = {
  对抗性动机: '从否定式开场、挑衅动词、二人称攻击和冲突升级词估计。',
  认知闭合: '从绝对化副词、单因归因、拒绝歧义与快速定论模式估计。',
  证据敏感: '从来源引用、反证回应、数据修正和“你自己搜”回避率估计，数值越低风险越高。',
  逻辑一致: '从谬误标签、概念稳定性、前后矛盾和论证链完整度估计，数值越低风险越高。',
  合作讨论: '从澄清问题、让步、复述对方观点和主题保持率估计，数值越低风险越高。',
  修正意愿: '从被纠错后的承认、补充、沉默、转移话题和反击比例估计，数值越低风险越高。',
};

function normalizeForRisk(score) {
  const inverse = new Set(['证据敏感', '逻辑一致', '合作讨论', '修正意愿']);
  return inverse.has(score.axis) ? 100 - score.value : score.value;
}

function getTrollIndex(user) {
  const weights = {
    对抗性动机: 0.2,
    认知闭合: 0.16,
    证据敏感: 0.18,
    逻辑一致: 0.18,
    合作讨论: 0.16,
    修正意愿: 0.12,
  };
  return Math.round(
    user.scores.reduce((sum, score) => sum + normalizeForRisk(score) * weights[score.axis], 0),
  );
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
  const baseline = scores.map((score, index) => point(index, normalizeForRisk({ ...score, value: score.benchmark })).join(',')).join(' ');

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
  const parts = item.comment.split(item.highlight);
  return (
    <article className="error-item">
      <div className="error-head">
        <span className={`severity severity-${item.severity}`}>{item.severity}风险</span>
        <span>{item.type}</span>
      </div>
      <p className="comment-text">
        {parts[0]}
        <mark>{item.highlight}</mark>
        {parts.slice(1).join(item.highlight)}
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
  const [selectedId, setSelectedId] = React.useState(users[0].id);
  const [activeError, setActiveError] = React.useState('全部');
  const [query, setQuery] = React.useState('山前反证员');
  const [analysisState, setAnalysisState] = React.useState('ready');
  const selectedUser = users.find((user) => user.id === selectedId);
  const trollIndex = getTrollIndex(selectedUser);
  const errorTypes = ['全部', ...new Set(selectedUser.errors.map((error) => error.type))];
  const visibleErrors =
    activeError === '全部'
      ? selectedUser.errors
      : selectedUser.errors.filter((error) => error.type === activeError);

  const runAnalysis = () => {
    setAnalysisState('loading');
    window.setTimeout(() => setAnalysisState('ready'), 700);
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
            <span>模型版本 PDI-0.4</span>
            <span>中文社区语境</span>
          </div>
        </nav>

        <div className="hero-grid">
          <section className="intro-panel">
            <div className="eyebrow"><MagnifyingGlass size={16} /> research first</div>
            <h1>用论证行为数据识别 B 站评论里的“杠精倾向”。</h1>
            <p>
              这个原型不把“不同意”直接等同于“杠”。它把评论拆成动机、证据、逻辑、合作性和修正行为，
              再用可追溯的错误片段解释每一项评分。
            </p>
            <div className="search-row">
              <label htmlFor="user-query">目标用户</label>
              <div>
                <input
                  id="user-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入 UID、昵称或粘贴评论样本"
                />
                <button type="button" onClick={runAnalysis}>
                  <Lightning size={17} weight="fill" />
                  {analysisState === 'loading' ? '分析中' : '生成画像'}
                </button>
              </div>
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
            <span>用户样本</span>
          </div>
          {users.map((user) => (
            <button
              className={`user-card ${user.id === selectedId ? 'active' : ''}`}
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedId(user.id);
                setActiveError('全部');
                setQuery(user.name);
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
              <small>{trollIndex >= 70 ? '高风险对抗型' : trollIndex >= 45 ? '混合争辩型' : '低风险讨论型'}</small>
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
                  </div>
                  <b>{normalizeForRisk(score)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="metric-strip">
            <div>
              <span>有效评论</span>
              <strong>{selectedUser.analyzed}</strong>
            </div>
            <div>
              <span>反对立场率</span>
              <strong>{Math.round(selectedUser.disagreementRate * 100)}%</strong>
            </div>
            <div>
              <span>立场修正率</span>
              <strong>{Math.round(selectedUser.stanceSwitchRate * 100)}%</strong>
            </div>
            <div>
              <span>模型置信度</span>
              <strong>{Math.round(selectedUser.confidence * 100)}%</strong>
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
            <p>去除重复、表情噪声和纯转发，只保留带有主张或评价的评论。</p>
          </article>
          <article>
            <WarningCircle size={24} />
            <strong>2. 谬误标注</strong>
            <p>识别稻草人、偷换概念、诉诸人身、缺证断言、虚假两难和过度概括。</p>
          </article>
          <article>
            <ChartPolar size={24} />
            <strong>3. 心理指标映射</strong>
            <p>把语言特征映射到闭合需求、动机性推理、合作性和修正意愿。</p>
          </article>
          <article>
            <CheckCircle size={24} />
            <strong>4. 证据回放</strong>
            <p>每个评分必须能回到原评论片段，避免只给抽象标签。</p>
          </article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
