/**
 * Annotation UI — Phase 0.2 baseline labeling tool.
 *
 * Keyboard-driven interface for annotating Bilibili comments against the
 * 3-annotator protocol defined in server/data/baselines/annotator_protocol.json.
 *
 * Shortcuts:
 *   Y/N     — isRisky true/false
 *   1-5     — riskAxis (attack/absolutes/evasion/cooperation/correction)
 *   6       — riskAxis null
 *   7-9     — sentiment (positive/negative/neutral)
 *   M       — toggle isMemeOrQuote
 *   D       — toggle difficult
 *   Enter   — submit + next
 *   Escape  — skip
 *
 * @module src/components/AnnotationUI
 */

import React from 'react';
import {
  CheckCircle,
  ClockCounterClockwise,
  FlagBanner,
  SkipForward,
  Users,
  WarningCircle,
} from '@phosphor-icons/react';

const RISK_AXIS_MAP = {
  '1': 'attack',
  '2': 'absolutes',
  '3': 'evasion',
  '4': 'cooperation',
  '5': 'correction',
  '6': null,
};

const SENTIMENT_MAP = {
  '7': 'positive',
  '8': 'negative',
  '9': 'neutral',
};

const AXIS_LABELS = {
  attack: '攻击/嘲讽',
  absolutes: '绝对化',
  evasion: '举证回避',
  cooperation: '合作讨论',
  correction: '自我修正',
};

const ANNOTATOR_KEY = 'annotator-id';

export default function AnnotationUI({ onExit }) {
  const [annotator, setAnnotator] = React.useState(() =>
    localStorage.getItem(ANNOTATOR_KEY) || 'A1'
  );
  const [task, setTask] = React.useState(null);
  const [labels, setLabels] = React.useState({});
  const [progress, setProgress] = React.useState({ done: 0, total: 1000 });
  const [stats, setStats] = React.useState(null);
  const [status, setStatus] = React.useState('idle'); // idle | loading | submitting | done
  const [error, setError] = React.useState(null);

  // Ref to track current annotator for race-condition guard (updated synchronously,
  // unlike useState which is async). Prevents stale fetchNext responses from
  // overwriting state when the user switches annotators rapidly.
  const annotatorRef = React.useRef(annotator);
  annotatorRef.current = annotator; // keep ref in sync with state on every render

  // Load next task — accepts optional annotator override to avoid stale closure
  const fetchNext = React.useCallback(async (annOverride) => {
    const effectiveAnnotator = annOverride || annotator;
    setStatus('loading');
    setError(null);
    try {
      const resp = await fetch(`/api/annotate/next?annotator=${effectiveAnnotator}`);
      const data = await resp.json();
      // Guard: discard response if annotator changed while request was in flight.
      // Without this, a slow A2 response can overwrite A1's progress after the user
      // switches back to A1, resetting the progress bar to 0.
      if (effectiveAnnotator !== annotatorRef.current) return;
      if (!data.ok) {
        setError(data.error || 'Failed to fetch task');
        setStatus('idle');
        return;
      }
      if (data.done) {
        setTask(null);
        setProgress(data.progress);
        setStatus('done');
      } else {
        setTask(data.task);
        setProgress(data.progress);
        setStatus('idle');
      }
    } catch (err) {
      // Also guard: don't show stale errors
      if (effectiveAnnotator !== annotatorRef.current) return;
      setError(err.message);
      setStatus('idle');
    }
  }, [annotator]);

  // Load stats
  const fetchStats = React.useCallback(async () => {
    try {
      const resp = await fetch('/api/annotate/stats');
      const data = await resp.json();
      if (data.ok) setStats(data);
    } catch {}
  }, []);

  // Reset labels when task changes
  React.useEffect(() => {
    setLabels({
      isRisky: null,
      riskAxis: null,
      sentiment: null,
      isMemeOrQuote: false,
      difficult: false,
    });
  }, [task?.id]);

  // Fetch first task on mount
  React.useEffect(() => {
    fetchNext();
    fetchStats();
  }, [fetchNext, fetchStats]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKey = (e) => {
      if (status === 'submitting') return;

      // Ignore when typing in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const key = e.key.toLowerCase();

      // isRisky
      if (key === 'y') {
        setLabels((prev) => ({ ...prev, isRisky: true }));
      } else if (key === 'n') {
        setLabels((prev) => ({ ...prev, isRisky: false }));
      }
      // riskAxis
      else if (RISK_AXIS_MAP[key] !== undefined) {
        setLabels((prev) => ({ ...prev, riskAxis: RISK_AXIS_MAP[key] }));
      }
      // sentiment
      else if (SENTIMENT_MAP[key]) {
        setLabels((prev) => ({ ...prev, sentiment: SENTIMENT_MAP[key] }));
      }
      // isMemeOrQuote toggle
      else if (key === 'm') {
        setLabels((prev) => ({ ...prev, isMemeOrQuote: !prev.isMemeOrQuote }));
      }
      // difficult toggle
      else if (key === 'd') {
        setLabels((prev) => ({ ...prev, difficult: !prev.difficult }));
      }
      // Submit
      else if (key === 'enter' && labels.isRisky !== null) {
        e.preventDefault();
        submitAnnotation();
      }
      // Skip
      else if (key === 'escape') {
        fetchNext();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [labels, status]);

  const submitAnnotation = async () => {
    if (!task || labels.isRisky === null) return;
    setStatus('submitting');
    setError(null);
    try {
      const resp = await fetch('/api/annotate/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, annotator, labels }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || 'Submit failed');
        setStatus('idle');
        return;
      }
      fetchNext();
      fetchStats();
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  };

  // Annotator selector — show new annotator's progress immediately from cached stats
  const handleAnnotatorChange = (next) => {
    if (next === annotator) return;
    localStorage.setItem(ANNOTATOR_KEY, next);
    annotatorRef.current = next; // sync ref IMMEDIATELY (synchronous) — must precede
                                 // any async fetchNext so the race-condition guard works
    setAnnotator(next);
    setTask(null);
    setStatus('loading');
    setError(null);
    // Update progress bar instantly from cached stats (no flash of old progress)
    if (stats?.perAnnotator?.[next]) {
      setProgress({ done: stats.perAnnotator[next].done, total: stats.perAnnotator[next].total, annotator: next });
    }
    fetchNext(next);
    fetchStats();
  };

  if (status === 'done') {
    return (
      <div className="annotate-container">
        <div className="annotate-done">
          <CheckCircle size={48} weight="duotone" />
          <h2>全部标注完成</h2>
          <p>所有 {progress.total} 条评论已完成标注（标注者：{annotator}）。</p>
          {stats && (
            <div className="annotate-stats-summary">
              <span>Cohen's κ: {stats.kappa !== null ? stats.kappa.toFixed(3) : '待计算'}</span>
              <span className={`kappa-status kappa-${stats.kappaStatus}`}>
                {stats.kappaStatus === 'acceptable' ? '✓ 可用' :
                 stats.kappaStatus === 'marginal' ? '△ 边界' :
                 stats.kappaStatus === 'halt' ? '✗ 需重训' : '… 收集中'}
              </span>
            </div>
          )}
          <button className="annotate-btn" onClick={() => { setStatus('idle'); fetchNext(); }}>
            重新检查
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="annotate-container">
      {/* Header bar */}
      <div className="annotate-header">
        <div className="annotate-brand">
          <FlagBanner size={18} weight="duotone" />
          <strong>基线标注工具</strong>
          <span className="annotate-phase">Phase 0.2</span>
        </div>

        <div className="annotate-annotator-select">
          <Users size={16} />
          {['A1', 'A2', 'A3'].map((a) => (
            <button
              key={a}
              className={`annotator-chip ${annotator === a ? 'active' : ''}`}
              onClick={() => handleAnnotatorChange(a)}
            >
              {a === 'A1' ? 'A1 平衡型' : a === 'A2' ? 'A2 严格型' : 'A3 裁决者'}
            </button>
          ))}
        </div>

        <div className="annotate-progress">
          <span>{annotator} · {progress.done} / {progress.total}</span>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(1, (progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>

        <button className="annotate-icon-btn" onClick={fetchStats} title="刷新统计">
          <ClockCounterClockwise size={16} />
        </button>
      </div>

      {/* Main content */}
      <div className="annotate-main">
        {/* Comment card */}
        <div className="annotate-card">
          {task ? (
            <>
              <div className="comment-meta">
                <span className="comment-id">{task.id}</span>
                {task.isShared && <span className="shared-badge">共享标注</span>}
                <span className="comment-source">{task.context?.source || '未知来源'}</span>
              </div>

              {task.context?.sourceTitle && (
                <div className="comment-context">
                  <strong>视频标题：</strong>{task.context.sourceTitle}
                </div>
              )}

              <div className="comment-text-display">
                {task.commentText}
              </div>

              {task.context?.uid && (
                <div className="comment-uid">UID: {task.context.uid}</div>
              )}
            </>
          ) : (
            <div className="annotate-loading">
              {status === 'loading' ? '加载中...' : error || '无任务'}
            </div>
          )}
        </div>

        {/* Labeling panel */}
        {task && (
          <div className="annotate-panel">
            {/* isRisky */}
            <div className="label-group">
              <div className="label-group-title">风险判断 (Y/N)</div>
              <div className="label-buttons">
                <button
                  className={`label-btn risky-btn ${labels.isRisky === true ? 'active' : ''}`}
                  onClick={() => setLabels((p) => ({ ...p, isRisky: true }))}
                >
                  <WarningCircle size={16} /> Y — 有风险
                </button>
                <button
                  className={`label-btn safe-btn ${labels.isRisky === false ? 'active' : ''}`}
                  onClick={() => setLabels((p) => ({ ...p, isRisky: false }))}
                >
                  <CheckCircle size={16} /> N — 无风险
                </button>
              </div>
            </div>

            {/* riskAxis (only if isRisky) */}
            {labels.isRisky && (
              <div className="label-group">
                <div className="label-group-title">风险类别 (1-5, 6=无)</div>
                <div className="label-buttons axis-buttons">
                  {Object.entries(RISK_AXIS_MAP).slice(0, 5).map(([key, axis]) => (
                    <button
                      key={key}
                      className={`label-btn axis-btn ${labels.riskAxis === axis ? 'active' : ''}`}
                      onClick={() => setLabels((p) => ({ ...p, riskAxis: axis }))}
                    >
                      <kbd>{key}</kbd> {AXIS_LABELS[axis]}
                    </button>
                  ))}
                  <button
                    className={`label-btn axis-btn ${labels.riskAxis === null ? 'active' : ''}`}
                    onClick={() => setLabels((p) => ({ ...p, riskAxis: null }))}
                  >
                    <kbd>6</kbd> 无
                  </button>
                </div>
              </div>
            )}

            {/* sentiment */}
            <div className="label-group">
              <div className="label-group-title">情感倾向 (7-9)</div>
              <div className="label-buttons sentiment-buttons">
                {Object.entries(SENTIMENT_MAP).map(([key, val]) => (
                  <button
                    key={key}
                    className={`label-btn sentiment-btn sentiment-${val} ${labels.sentiment === val ? 'active' : ''}`}
                    onClick={() => setLabels((p) => ({ ...p, sentiment: val }))}
                  >
                    <kbd>{key}</kbd> {val === 'positive' ? '😊 正面' : val === 'negative' ? '😠 负面' : '😐 中性'}
                  </button>
                ))}
              </div>
            </div>

            {/* isMemeOrQuote + difficult toggles */}
            <div className="label-group">
              <div className="label-group-title">其他标记</div>
              <div className="label-buttons">
                <button
                  className={`label-btn toggle-btn ${labels.isMemeOrQuote ? 'active' : ''}`}
                  onClick={() => setLabels((p) => ({ ...p, isMemeOrQuote: !p.isMemeOrQuote }))}
                >
                  <kbd>M</kbd> {labels.isMemeOrQuote ? '✓ 梗/引用' : '梗/引用'}
                </button>
                <button
                  className={`label-btn toggle-btn ${labels.difficult ? 'active' : ''}`}
                  onClick={() => setLabels((p) => ({ ...p, difficult: !p.difficult }))}
                >
                  <kbd>D</kbd> {labels.difficult ? '✓ 困难案例' : '困难案例'}
                </button>
              </div>
            </div>

            {/* Actions */}
            <div className="label-actions">
              <button
                className="annotate-btn skip-btn"
                onClick={fetchNext}
                disabled={status === 'submitting'}
              >
                <SkipForward size={16} /> 跳过 (Esc)
              </button>
              <button
                className="annotate-btn submit-btn"
                onClick={submitAnnotation}
                disabled={labels.isRisky === null || status === 'submitting'}
              >
                {status === 'submitting' ? '提交中...' : '提交并下一个 (Enter)'}
              </button>
            </div>

            {error && <div className="annotate-error">{error}</div>}
          </div>
        )}
      </div>

      {/* Stats footer */}
      {stats && (
        <div className="annotate-footer">
          <span>A1: {stats.perAnnotator?.A1?.done || 0}</span>
          <span>A2: {stats.perAnnotator?.A2?.done || 0}</span>
          <span>A3: {stats.perAnnotator?.A3?.done || 0}</span>
          <span>共享完成: {stats.sharedDone || 0}</span>
          <span>Cohen's κ: {stats.kappa !== null ? stats.kappa.toFixed(3) : '—'}</span>
        </div>
      )}

      {/* Per-category breakdown for current annotator */}
      {stats?.categoryBreakdown?.[annotator] && (
        <div className="annotate-categories">
          {(['attack', 'absolutes', 'evasion', 'cooperation', 'correction']).map((axis) => {
            const count = stats.categoryBreakdown[annotator][axis] || 0;
            const total = stats.categoryBreakdown[annotator].total || 1;
            return (
              <span key={axis} className={`cat-chip cat-${axis}`} title={`${AXIS_LABELS[axis]}: ${count}`}>
                {AXIS_LABELS[axis]} <strong>{count}</strong>
              </span>
            );
          })}
          <span className="cat-chip cat-safe">
            安全 <strong>{stats.categoryBreakdown[annotator].safe || 0}</strong>
          </span>
        </div>
      )}

      {/* Keyboard shortcut reference */}
      <div className="annotate-shortcuts">
        <kbd>Y</kbd>=有风险 <kbd>N</kbd>=无风险 <kbd>1-5</kbd>=类别 <kbd>6</kbd>=无类别
        <kbd>7-9</kbd>=情感 <kbd>M</kbd>=梗/引用 <kbd>D</kbd>=困难 <kbd>Enter</kbd>=提交 <kbd>Esc</kbd>=跳过
      </div>
    </div>
  );
}
