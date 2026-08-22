import React from 'react';

export default function StatsBar({ stats, onRefresh }) {
  if (!stats) return null;
  return (
    <div className="stats-bar">
      <div className="stat-item">
        <span className="stat-label">总词条</span>
        <strong>{stats.totalEntries.toLocaleString()}</strong>
      </div>
      <div className="stat-item">
        <span className="stat-label">已审核</span>
        <strong>{stats.reviewed.toLocaleString()}</strong>
      </div>
      <div className="stat-item">
        <span className="stat-label">争议</span>
        <strong className="text-warn">{stats.disputed.toLocaleString()}</strong>
      </div>
      <div className="stat-item">
        <span className="stat-label">确认</span>
        <strong className="text-ok">{stats.confirmed.toLocaleString()}</strong>
      </div>
      <div className="stat-item">
        <span className="stat-label">争议率</span>
        <strong>{stats.disputeRate}%</strong>
      </div>
      <div className="stat-item">
        <span className="stat-label">低置信度</span>
        <strong className="text-warn">{stats.lowConfidence}</strong>
      </div>
      <button className="refresh-btn" onClick={onRefresh} title="刷新统计">
        刷新
      </button>
    </div>
  );
}
