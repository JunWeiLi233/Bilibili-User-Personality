import React from 'react';
import { Lightning, MagnifyingGlass } from '@phosphor-icons/react';
import { extractUid } from '../utils/extractUid.js';

export default function SearchBox({ onAnalyze, loading }) {
  const [query, setQuery] = React.useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const result = extractUid(query);
    if (result.confidence !== 'none' && result.uid) {
      onAnalyze(result.uid);
    }
  };

  return (
    <form className="search-box" onSubmit={handleSubmit}>
      <div className="search-input-wrap">
        <MagnifyingGlass size={18} className="search-icon" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="输入 B 站 UID 或用户空间链接，例如 453244911 或 space.bilibili.com/453244911"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !query.trim()}>
          <Lightning size={17} weight="fill" />
          {loading ? '分析中...' : '分析'}
        </button>
      </div>
    </form>
  );
}
