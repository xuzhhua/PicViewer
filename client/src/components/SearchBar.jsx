import React from 'react';
import './SearchBar.css';

export default function SearchBar({ value, onChange }) {
  return (
    <div className="search-bar">
      <span className="search-icon"><img src="/icons/search.svg" alt="" width="16" height="16" /></span>
      <input
        type="text"
        placeholder="搜索图片名称..."
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {value && (
        <button className="search-clear" onClick={() => onChange('')}>
          ✕
        </button>
      )}
    </div>
  );
}
