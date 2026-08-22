import React from 'react';

export default function AdminLogin({ onLogin }) {
  const [token, setToken] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token.trim()) { setError('请输入管理员令牌'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        sessionStorage.setItem('admin_token', token.trim());
        onLogin(token.trim());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '令牌无效');
      }
    } catch {
      setError('无法连接到服务器');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login">
      <form onSubmit={handleSubmit}>
        <h1>管理员登录</h1>
        <p>请输入管理员令牌以访问词典审核面板</p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          autoFocus
        />
        {error && <span className="login-error">{error}</span>}
        <button type="submit" disabled={loading}>
          {loading ? '验证中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
