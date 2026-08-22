import React from 'react';
import StatsBar from './StatsBar.jsx';
import TermTable from './TermTable.jsx';
import TermReview from './TermReview.jsx';
import { SignOut } from '@phosphor-icons/react';

export default function AdminDashboard({ token, onLogout }) {
  const [stats, setStats] = React.useState(null);
  const [entries, setEntries] = React.useState([]);
  const [page, setPage] = React.useState(1);
  const [totalPages, setTotalPages] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [filters, setFilters] = React.useState({ family: '', reviewed: '', search: '' });
  const [selectedTerm, setSelectedTerm] = React.useState(null);
  const [termDetail, setTermDetail] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  const fetchStats = React.useCallback(async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok) setStats(data.stats);
      }
    } catch (e) { /* silent */ }
  }, [token]);

  const fetchEntries = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, perPage: '50' });
      if (filters.family) params.set('family', filters.family);
      if (filters.reviewed) params.set('reviewed', filters.reviewed);
      if (filters.search) params.set('search', filters.search);
      const res = await fetch(`/api/admin/dictionary?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setEntries(data.entries);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        if (data.stats) setStats(data.stats);
      } else {
        setError(data.error || '加载失败');
      }
    } catch {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
    }
  }, [token, page, filters]);

  React.useEffect(() => { fetchStats(); }, [fetchStats]);
  React.useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleSelectTerm = async (entry) => {
    setSelectedTerm(entry);
    setTermDetail(null);
    try {
      const res = await fetch(`/api/admin/term/${encodeURIComponent(entry.term)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.ok) {
        setTermDetail(data.term);
      } else {
        setTermDetail(entry);
      }
    } catch {
      setTermDetail(entry);
    }
  };

  const handleReviewSubmit = () => {
    setTermDetail(null);
    setSelectedTerm(null);
    fetchEntries();
    fetchStats();
  };

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <div className="admin-brand">
          <h1>词典审核面板</h1>
          <span>BiliArgument Admin</span>
        </div>
        <button className="logout-btn" onClick={onLogout}>
          <SignOut size={18} /> 登出
        </button>
      </header>

      <StatsBar stats={stats} onRefresh={() => { fetchStats(); fetchEntries(); }} />

      {error && <div className="admin-error">{error}</div>}

      <TermTable
        entries={entries}
        total={total}
        page={page}
        totalPages={totalPages}
        onPageChange={setPage}
        filters={filters}
        onFilterChange={setFilters}
        onSelectTerm={handleSelectTerm}
      />

      {loading && <div className="admin-loading">加载中...</div>}

      {termDetail && (
        <TermReview
          term={termDetail}
          onClose={() => { setTermDetail(null); setSelectedTerm(null); }}
          onReviewSubmit={handleReviewSubmit}
          token={token}
        />
      )}
    </div>
  );
}
