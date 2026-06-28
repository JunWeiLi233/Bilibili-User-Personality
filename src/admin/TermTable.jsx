import React from 'react';
import { Funnel, CaretUp, CaretDown } from '@phosphor-icons/react';

const FAMILIES = ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];
const FAMILY_LABELS = { attack: '攻击', absolutes: '绝对化', evidence: '证据', evasion: '回避', cooperation: '合作', correction: '修正' };
const REVIEW_FILTERS = [
  { value: '', label: '全部' },
  { value: 'unreviewed', label: '未审核' },
  { value: 'reviewed', label: '已审核' },
  { value: 'disputed', label: '已争议' },
];

export default function TermTable({ entries, total, page, totalPages, onPageChange, filters, onFilterChange, onSelectTerm }) {
  return (
    <div className="term-table-container">
      <div className="table-toolbar">
        <div className="filter-group">
          <Funnel size={16} />
          <select value={filters.family} onChange={(e) => onFilterChange({ ...filters, family: e.target.value, page: 1 })}>
            <option value="">全部家族</option>
            {FAMILIES.map((f) => <option key={f} value={f}>{FAMILY_LABELS[f]}</option>)}
          </select>
          <select value={filters.reviewed} onChange={(e) => onFilterChange({ ...filters, reviewed: e.target.value, page: 1 })}>
            {REVIEW_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <input
            type="text"
            placeholder="搜索词条..."
            value={filters.search || ''}
            onChange={(e) => onFilterChange({ ...filters, search: e.target.value, page: 1 })}
          />
        </div>
        <span className="table-count">{total} 条结果 · 第 {page}/{totalPages} 页</span>
        <div className="page-controls">
          <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
          <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button>
        </div>
      </div>

      <table className="term-table">
        <thead>
          <tr>
            <th>词条</th>
            <th>AI分类</th>
            <th>置信度</th>
            <th>证据</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.term} className={entry.adminOverride?.action === 'dispute' ? 'row-disputed' : entry.humanReviewed ? 'row-reviewed' : ''}>
              <td className="cell-term">
                <strong>{entry.term}</strong>
                <span>{entry.meaning?.slice(0, 60)}{(entry.meaning?.length > 60) ? '...' : ''}</span>
              </td>
              <td>
                <span className="family-badge">{FAMILY_LABELS[entry.family] || entry.family}</span>
                {entry.risk && <span className="risk-badge">{entry.risk}</span>}
              </td>
              <td>
                <div className="confidence-bar">
                  <div className="confidence-fill" style={{ width: `${entry.confidence * 100}%`, background: entry.confidence < 0.6 ? '#8a3f33' : entry.confidence < 0.8 ? '#a26a2d' : '#2f5d50' }} />
                </div>
                <span className="confidence-num">{Math.round(entry.confidence * 100)}%</span>
              </td>
              <td className="cell-evidence">{entry.evidenceCount || 0}</td>
              <td>
                {entry.adminOverride?.action === 'dispute' ? (
                  <span className="status-disputed">已争议</span>
                ) : entry.humanReviewed ? (
                  <span className="status-confirmed">已确认</span>
                ) : (
                  <span className="status-pending">待审核</span>
                )}
              </td>
              <td>
                <button className="review-btn" onClick={() => onSelectTerm(entry)}>审核</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {entries.length === 0 && (
        <div className="table-empty">没有匹配的词条</div>
      )}
    </div>
  );
}
