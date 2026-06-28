import React from 'react';
import { BarChartSmallMultiples } from './BarChartSmallMultiples';
import { Gauge, WarningCircle, CheckCircle, SealQuestion } from '@phosphor-icons/react';

// Note: these must match the function exports in main.jsx
function normalizeForRisk(score) {
  return score.value;
}

function getRiskBand(index) {
  if (index >= 70) return '高频命中型（情绪过激主导）';
  if (index >= 45) return '混合模式（回避讨论与逻辑问题并存）';
  return '低频命中型（常规讨论者）';
}

// ——— Corpus-derived composite weights ———
// Provenance: per-axis item-total correlations from validateScoring.js
// on 100-user personality analysis corpus (179,628 messages).
// See src/main.jsx:getTrollIndex for full provenance.
function getTrollIndex(scores) {
  const weights = { '情绪过激': 0.28, '回避讨论': 0.25, '逻辑混乱': 0.27, '其他问题': 0.20 };
  return Math.round(scores.reduce((sum, s) => sum + normalizeForRisk(s) * weights[s.axis], 0));
}

// κ interpretation helper
function kappaIcon(kappa) {
  if (kappa === null || kappa === undefined) return <SealQuestion size={14} weight="duotone" style={{color: '#b3a68f'}} />;
  if (kappa >= 0.8) return <CheckCircle size={14} weight="fill" style={{color: '#4f6d61'}} />;
  if (kappa >= 0.6) return <CheckCircle size={14} weight="duotone" style={{color: '#8b8b6f'}} />;
  return <WarningCircle size={14} weight="duotone" style={{color: '#c48b3a'}} />;
}

export default function ResultsView({ profile, loading, error }) {
  if (loading) {
    return (
      <div className="results-loading">
        <div className="results-spinner" />
        <p>正在分析用户评论数据...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="results-error">
        <WarningCircle size={24} />
        <p>{error}</p>
      </div>
    );
  }

  if (!profile) return null;

  const index = getTrollIndex(profile.scores);
  const band = getRiskBand(index);

  return (
    <div className="results-view">
      <div className="results-header">
        <div className="results-user">
          <h2>{profile.name}</h2>
          <span>{profile.uid} · {profile.bio || `${profile.sampleSize} 条评论`}</span>
        </div>
        <div className="results-score">
          <span>杠精指数</span>
          <strong>{index}</strong>
          <small>{band}</small>
        </div>
      </div>

      <div className="results-chart">
        <BarChartSmallMultiples scores={profile.scores} />
      </div>

      <div className="results-details">
        <h3>分类得分详情</h3>
        {profile.scores.map((score) => (
          <div className="detail-row" key={score.axis}>
            <div className="detail-info">
              <strong>{score.axis}</strong>
              <span className="kappa-badge" title={`Cohen's κ = ${score.kappa !== null ? score.kappa.toFixed(3) : '待标注'}`}>
                {kappaIcon(score.kappa)}
                <small>{score.kappaLabel || '低置信度'}</small>
              </span>
              <p>{score.note}</p>
            </div>
            <div className="detail-value">
              <b>{score.value}</b>
              <span>/ {score.benchmark} (基线)</span>
            </div>
          </div>
        ))}
      </div>

      <div className="results-metrics">
        <div>
          <span>有效评论</span>
          <strong>{profile.analyzed || profile.sampleSize}</strong>
        </div>
        <div>
          <span>高风险话语</span>
          <strong>{profile.speechSummary?.negative ?? 0}</strong>
        </div>
        <div>
          <span>正向修正</span>
          <strong>{profile.speechSummary?.positive ?? 0}</strong>
        </div>
        <div>
          <span>置信依据</span>
          <strong>基于 {profile.sampleSize} 条评论</strong>
        </div>
      </div>
    </div>
  );
}
