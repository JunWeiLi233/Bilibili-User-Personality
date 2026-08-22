import React from 'react';
import { X, Check, Warning } from '@phosphor-icons/react';

const FAMILIES = ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];
const FAMILY_LABELS = { attack: '攻击', absolutes: '绝对化', evidence: '证据', evasion: '回避', cooperation: '合作', correction: '修正' };
const RISK_LEVELS = ['low', 'medium', 'high'];
const RISK_LABELS = { low: '低', medium: '中', high: '高' };

export default function TermReview({ term, onClose, onReviewSubmit, token }) {
  const [adminFamily, setAdminFamily] = React.useState(term.family);
  const [adminRisk, setAdminRisk] = React.useState(term.risk || 'medium');
  const [adminNote, setAdminNote] = React.useState('');
  const [action, setAction] = React.useState(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async (actionType) => {
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/admin/review', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: term.term,
          aiFamily: term.family,
          aiRisk: term.risk,
          aiConfidence: term.confidence,
          adminFamily: actionType === 'dispute' ? adminFamily : term.family,
          adminRisk: actionType === 'dispute' ? adminRisk : term.risk,
          adminNote,
          action: actionType,
        }),
      });
      if (res.ok) {
        onReviewSubmit();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '提交失败');
      }
    } catch {
      setError('无法连接到服务器');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="term-review-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="term-review-panel">
        <div className="review-header">
          <h2>词条详情: {term.term}</h2>
          <button className="close-btn" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="review-body">
          <div className="review-section ai-classification">
            <h3>AI 分类</h3>
            <div className="classification-detail">
              <div>
                <span className="label">家族:</span>
                <span className="family-badge">{FAMILY_LABELS[term.family] || term.family}</span>
              </div>
              <div>
                <span className="label">风险:</span>
                <span className="risk-badge">{RISK_LABELS[term.risk] || term.risk}</span>
              </div>
              <div>
                <span className="label">置信度:</span>
                <strong>{Math.round(term.confidence * 100)}%</strong>
              </div>
              <div>
                <span className="label">含义:</span>
                <p>{term.meaning || '无'}</p>
              </div>
            </div>
          </div>

          <div className="review-section evidence-samples">
            <h3>证据样本 ({term.evidenceCount || 0} 条)</h3>
            {term.evidence && term.evidence.length > 0 ? (
              <ul className="evidence-list">
                {term.evidence.map((ev, i) => (
                  <li key={i}>{typeof ev === 'string' ? ev : ev.text || ev.comment || JSON.stringify(ev)}</li>
                ))}
              </ul>
            ) : (
              <p className="no-evidence">暂无证据样本</p>
            )}
          </div>

          {term.adminOverride && (
            <div className="review-section admin-override">
              <h3>已有审核记录</h3>
              <div className="override-detail">
                <span>操作: {term.adminOverride.action === 'dispute' ? '争议' : '确认'}</span>
                {term.adminOverride.family && <span>分类: {FAMILY_LABELS[term.adminOverride.family]}</span>}
                {term.adminOverride.note && <p>{term.adminOverride.note}</p>}
              </div>
            </div>
          )}

          <div className="review-section admin-judgment">
            <h3>你的判断</h3>
            <div className="judgment-controls">
              <div className="control-row">
                <label>分类:</label>
                <select value={adminFamily} onChange={(e) => setAdminFamily(e.target.value)}>
                  {FAMILIES.map((f) => <option key={f} value={f}>{FAMILY_LABELS[f]}</option>)}
                </select>
              </div>
              <div className="control-row">
                <label>风险:</label>
                <select value={adminRisk} onChange={(e) => setAdminRisk(e.target.value)}>
                  {RISK_LEVELS.map((r) => <option key={r} value={r}>{RISK_LABELS[r]}</option>)}
                </select>
              </div>
              <div className="control-row">
                <label>备注:</label>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="可选：说明你的判断理由..."
                  rows={3}
                />
              </div>
            </div>
          </div>

          {error && <div className="review-error">{error}</div>}

          <div className="review-actions">
            <button className="btn-confirm" onClick={() => handleSubmit('confirm')} disabled={submitting}>
              <Check size={18} /> 确认AI正确
            </button>
            <button className="btn-dispute" onClick={() => handleSubmit('dispute')} disabled={submitting}>
              <Warning size={18} /> 争议AI分类
            </button>
            <button className="btn-skip" onClick={() => handleSubmit('flag')} disabled={submitting}>
              跳过
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
