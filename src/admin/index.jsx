import React from 'react';
import { createRoot } from 'react-dom/client';
import AdminLogin from './AdminLogin.jsx';
import AdminDashboard from './AdminDashboard.jsx';
import './admin.css';

function AdminApp() {
  const [token, setToken] = React.useState(() => sessionStorage.getItem('admin_token') || '');

  const handleLogin = (t) => setToken(t);
  const handleLogout = () => { sessionStorage.removeItem('admin_token'); setToken(''); };

  if (!token) return <AdminLogin onLogin={handleLogin} />;
  return <AdminDashboard token={token} onLogout={handleLogout} />;
}

createRoot(document.getElementById('root')).render(<AdminApp />);
