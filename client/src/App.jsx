import React, { useState, useCallback } from 'react';
import FolderTree from './components/FolderTree';
import ImageGrid, { VideoGrid } from './components/ImageGrid';
import Lightbox from './components/Lightbox';
import SearchBar from './components/SearchBar';
import IgnoredFolders from './components/IgnoredFolders';
import useApi from './hooks/useApi';
import './App.css';

const VIEW_MODES = [
  { key: 'grid', icon: '/icons/grid.svg', label: '网格' },
  { key: 'waterfall', icon: '/icons/waterfall.svg', label: '瀑布' },
  { key: 'list', icon: '/icons/list.svg', label: '列表' },
  { key: 'all', icon: '/icons/all.svg', label: '全部（含子目录）' },
];

const SORT_OPTIONS = [
  { key: 'name', label: '名称' },
  { key: 'date', label: '日期' },
  { key: 'size', label: '大小' },
  { key: 'type', label: '类型' },
];

function sortMedia(items, sortBy) {
  const sorted = [...items];
  switch (sortBy) {
    case 'date':
      sorted.sort((a, b) => new Date(b.modified) - new Date(a.modified));
      break;
    case 'size':
      sorted.sort((a, b) => b.size - a.size);
      break;
    case 'type':
      sorted.sort((a, b) => {
        const extA = (a.format || a.name.split('.').pop() || '').toLowerCase();
        const extB = (b.format || b.name.split('.').pop() || '').toLowerCase();
        return extA.localeCompare(extB);
      });
      break;
    case 'name':
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
      break;
  }
  return sorted;
}

export default function App() {
  const { folders, browseData, ignoredFolders, loading, error, addFolder, removeFolder, reorderFolders, browse, browseRecursive, pickFolder, addIgnored, removeIgnored, pickIgnoredFolder, search } = useApi();

  const [currentPath, setCurrentPath] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('name');
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('picviewer-theme') || 'dark');
  const [thumbSize, setThumbSize] = useState(() => parseInt(localStorage.getItem('picviewer-thumb-size')) || 300);
  const [favorites, setFavorites] = useState([]);
  const isRecursive = viewMode === 'all';

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('picviewer-theme', theme);
  }, [theme]);

  // Favorites
  const fetchFavorites = useCallback(async () => {
    try { const r = await fetch('/api/actions'); setFavorites(await r.json()); } catch (_) {}
  }, []);
  const addFavorite = useCallback(async (item) => {
    try {
      await fetch('/api/actions', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name:item.name, path:item.path, type:item.type||'image' }) });
      fetchFavorites();
    } catch (_) {}
  }, [fetchFavorites]);
  const removeFavorite = useCallback(async (id) => {
    try { await fetch(`/api/actions/${id}`, { method:'DELETE' }); fetchFavorites(); } catch (_) {}
  }, [fetchFavorites]);
  React.useEffect(() => { fetchFavorites(); }, []); // eslint-disable-line

  // Multi-select (must be before keyboard effect that references selectAll)
  const selectAll = useCallback(() => {
    const all = [...(browseData?.images || []), ...(browseData?.videos || [])];
    setSelectedPaths(new Set(all.map(m => m.path)));
  }, [browseData]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || lightboxIndex >= 0) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); document.querySelector('.search-bar input')?.focus(); }
      if (e.key === 'F5') { e.preventDefault(); if (currentPath) browse(currentPath, true); else browse('', true); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); selectAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentPath, browse, lightboxIndex, selectAll]);

  // Debounced search across all folders
  React.useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        search(searchQuery.trim());
      } else if (browseData?.isSearch) {
        // Clear search results when query is cleared
        browse('', true);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrowse = useCallback((folderPath) => {
    setCurrentPath(folderPath);
    setSearchQuery('');
    setSidebarOpen(false);
    setSelectedPaths(new Set());
    if (viewMode === 'all') setViewMode('grid');
    browse(folderPath, true);
  }, [browse, viewMode]);

  const handleBackToRoot = useCallback(() => {
    setCurrentPath('');
    setSearchQuery('');
    setSelectedPaths(new Set());
    browse('', true);
  }, [browse]);

  // When switching to "all" mode, re-browse recursively
  const handleViewMode = useCallback((mode) => {
    setViewMode(mode);
    setSelectedPaths(new Set());
    if (mode === 'all' && currentPath) {
      browseRecursive(currentPath);
    } else if (mode !== 'all' && isRecursive && currentPath) {
      browse(currentPath, true);
    }
  }, [currentPath, isRecursive, browse, browseRecursive]);

  const handleOpenLightbox = useCallback((index) => {
    setLightboxIndex(index);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxIndex(-1);
  }, []);

  // Multi-select
  const toggleSelect = useCallback((path, e) => {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (e?.ctrlKey || e?.metaKey) {
        if (next.has(path)) next.delete(path); else next.add(path);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
  }, []);

  // Context menu
  const handleContextMenu = useCallback((e, item) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  React.useEffect(() => {
    if (contextMenu) {
      const close = () => setContextMenu(null);
      window.addEventListener('click', close);
      return () => window.removeEventListener('click', close);
    }
  }, [contextMenu]);

  const handleCopyPath = useCallback((item) => {
    navigator.clipboard.writeText(item.path).catch(() => {});
    setContextMenu(null);
  }, []);

  const handleOpenInExplorer = useCallback(async (item) => {
    try { await fetch('/api/actions/explorer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ path: item.path }) }); } catch (_) {}
    setContextMenu(null);
  }, []);

  const handleBatchDownload = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    const paths = [...selectedPaths];
    const encodedPaths = paths.map(p => {
      const utf8Bytes = new TextEncoder().encode(p);
      return btoa(String.fromCharCode(...utf8Bytes));
    });

    // Use POST to avoid URL length limits
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: encodedPaths })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'picviewer-download.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
    setSelectedPaths(new Set());
  }, [selectedPaths]);

  // Filter and sort
  const rawImages = browseData?.images?.filter(img =>
    !searchQuery || img.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];
  const rawVideos = browseData?.videos?.filter(v =>
    !searchQuery || v.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const filteredImages = sortMedia(rawImages, sortBy);
  const filteredVideos = sortMedia(rawVideos, sortBy);

  // Combine for lightbox: images first, then videos
  const allMedia = [...filteredImages, ...filteredVideos];

  // Build breadcrumb paths
  const buildBreadcrumbs = () => {
    if (!currentPath) return [];
    const sep = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(sep).filter(Boolean);

    // For UNC paths, prepend the server
    if (currentPath.startsWith('\\\\')) {
      const crumbs = [{ name: parts[0] ? `\\\\${parts[0]}` : '网络', path: `\\\\${parts[0]}` }];
      let accumulated = `\\\\${parts[0]}`;
      if (parts[1]) {
        accumulated += `\\${parts[1]}`;
        crumbs.push({ name: parts[1], path: accumulated });
      }
      for (let i = 2; i < parts.length; i++) {
        accumulated += `\\${parts[i]}`;
        crumbs.push({ name: parts[i], path: accumulated });
      }
      return crumbs;
    }

    // Regular path
    const crumbs = [];
    let accumulated = '';
    for (const part of parts) {
      accumulated += (accumulated ? sep : '') + part;
      // For Windows drive letters, ensure colon
      if (accumulated.length === 1 && /^[a-zA-Z]$/.test(accumulated)) {
        accumulated += ':';
      }
      crumbs.push({ name: part, path: accumulated });
    }
    return crumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  return (
    <div className="app">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <span className="logo"><img src="/icons/picture.svg" alt="PicViewer" width="24" height="24" /></span>
          PicViewer
        </div>
        <FolderTree
          folders={folders}
          currentPath={currentPath}
          browseData={browseData}
          onBrowse={handleBrowse}
          onBackToRoot={handleBackToRoot}
          onAddFolder={addFolder}
          onRemoveFolder={removeFolder}
          onPickFolder={pickFolder}
          onReorderFolders={reorderFolders}
        />
        <IgnoredFolders
          ignoredFolders={ignoredFolders}
          onAddIgnored={addIgnored}
          onRemoveIgnored={removeIgnored}
          onPickIgnored={pickIgnoredFolder}
        />
        {favorites.length > 0 && (
          <div className="ft-section fav-section">
            <div className="ft-section-header">
              <span><img src="/icons/star.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:4}} /> Favorites ({favorites.length})</span>
            </div>
            <div className="ft-list">
              {favorites.map(fav => (
                <div key={fav.id} className="ft-item fav-item" onClick={() => {
                  const sep = fav.path.includes('\\') ? '\\' : '/';
                  const dir = fav.path.substring(0, fav.path.lastIndexOf(sep));
                  handleBrowse(dir);
                }} title={fav.path}>
                  <div className="ft-item-name"><img src="/icons/camera.svg" alt="" width="13" height="13" style={{verticalAlign:'middle',marginRight:4,opacity:0.7}} /> {fav.name}</div>
                  <button className="ft-remove-btn" onClick={e => { e.stopPropagation(); removeFavorite(fav.id); }} title="移除收藏">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="切换主题">
            <img src={theme === 'dark' ? '/icons/moon.svg' : '/icons/sun.svg'} alt="" width="18" height="18" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main-area">
        {/* Topbar */}
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>
            <img src={sidebarOpen ? '/icons/close.svg' : '/icons/menu.svg'} alt="" width="20" height="20" />
          </button>
          <SearchBar value={searchQuery} onChange={setSearchQuery} />

          {browseData && !browseData.isSearch && (
            <>
              <div className="view-mode-switcher">
                {VIEW_MODES.map(m => (
                  <button
                    key={m.key}
                    className={`vm-btn${viewMode === m.key ? ' active' : ''}`}
                    onClick={() => handleViewMode(m.key)}
                    title={m.label}
                    aria-label={m.label}
                    aria-pressed={viewMode === m.key}
                  >
                    <img src={m.icon} alt="" width="18" height="18" />
                  </button>
                ))}
              </div>

              <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)} title="排序方式">
                {SORT_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>

              <div className={`thumb-size-slider${viewMode === 'list' ? ' disabled' : ''}`} title={viewMode === 'list' ? '列表模式不支持缩放' : `缩略图大小: ${thumbSize}px`}>
                <input type="range" min="120" max="500" value={thumbSize} disabled={viewMode === 'list'}
                  onChange={e => { const v = parseInt(e.target.value); setThumbSize(v); localStorage.setItem('picviewer-thumb-size', v); }} />
                <span className="thumb-size-label">{thumbSize}</span>
              </div>

              <button className="refresh-btn" onClick={() => currentPath ? browse(currentPath, true) : browse('', true)} title="刷新 (F5)"><img src="/icons/refresh.svg" alt="" width="16" height="16" /></button>
            </>
          )}

          <div className="breadcrumb" role="navigation" aria-label="文件路径导航">
            <button className="crumb-link" onClick={handleBackToRoot} aria-label="返回根目录">
              <img src="/icons/house.svg" alt="" width="16" height="16" className="crumb-icon" /> Root
            </button>
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={crumb.path}>
                <span className="sep" aria-hidden="true">›</span>
                <button className="crumb-link" onClick={() => handleBrowse(crumb.path)}>
                  {crumb.name}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {selectedPaths.size > 0 && (
          <div className="action-bar">
            <span className="action-bar-count">已选 {selectedPaths.size} 项</span>
            <button className="action-btn" onClick={selectAll}>全选</button>
            <button className="action-btn" onClick={clearSelection}>取消</button>
            <button className="action-btn primary" onClick={handleBatchDownload}><img src="/icons/download.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:4}} /> 批量下载</button>
          </div>
        )}

        <div className="content">
          {error && <div className="error-msg">{error}</div>}

          {loading ? (
            <div className="loading">
              <div className="spinner" />
              Loading...
            </div>
          ) : browseData ? (
            <>
              {browseData.isSearch && (
                <div className="search-result-header">
                  <span><img src="/icons/search.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:4}} /> 搜索 "<strong>{searchQuery}</strong>" — 找到 {browseData.total || (filteredImages.length + filteredVideos.length)} 个结果</span>
                  {browseData.truncated && <span className="search-truncated">（结果已截断，请细化搜索词）</span>}
                  <button className="search-clear-btn" onClick={() => setSearchQuery('')}>✕ 清除</button>
                </div>
              )}

              {browseData.folders && browseData.folders.length > 0 && (
                <div className="folder-section">
                  <h3 className="section-title"><img src="/icons/folder-list.svg" alt="" width="16" height="16" className="title-icon" /> Folders</h3>
                  <div className="folder-grid">
                    {browseData.folders.map(folder => (
                      <div
                        key={folder.path}
                        className="folder-card"
                        onClick={() => handleBrowse(folder.path)}
                      >
                        <span className="folder-icon"><img src="/icons/folder-open.svg" alt="" width="28" height="28" /></span>
                        <span className="folder-name">{folder.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredImages.length > 0 && (
                <ImageGrid
                  key={`img-${thumbSize}`}
                  images={filteredImages}
                  onImageClick={(i) => {
                    if (selectedPaths.size > 0) {
                      toggleSelect(filteredImages[i].path, { ctrlKey: true });
                    } else {
                      handleOpenLightbox(i);
                    }
                  }}
                  viewMode={browseData.isSearch ? 'grid' : viewMode}
                  selectedPaths={selectedPaths}
                  onToggleSelect={(path, e) => { e.stopPropagation(); toggleSelect(path, e || { ctrlKey: true }); }}
                  onContextMenu={handleContextMenu}
                  onBrowseFolder={handleBrowse}
                  isSearch={browseData.isSearch}
                  thumbSize={thumbSize}
                />
              )}

              {filteredVideos.length > 0 && (
                <VideoGrid
                  key={`vid-${thumbSize}`}
                  videos={filteredVideos}
                  onVideoClick={(i) => {
                    if (selectedPaths.size > 0) {
                      toggleSelect(filteredVideos[i].path, { ctrlKey: true });
                    } else {
                      handleOpenLightbox(filteredImages.length + i);
                    }
                  }}
                  viewMode={browseData.isSearch ? 'grid' : viewMode}
                  selectedPaths={selectedPaths}
                  onToggleSelect={(path, e) => { e.stopPropagation(); toggleSelect(path, e || { ctrlKey: true }); }}
                  onContextMenu={handleContextMenu}
                  onBrowseFolder={handleBrowse}
                  isSearch={browseData.isSearch}
                  thumbSize={thumbSize}
                />
              )}

              {(!browseData.folders || browseData.folders.length === 0) && allMedia.length === 0 && (
                <div className="empty">
                  <span className="icon"><img src="/icons/folder-open.svg" alt="" width="48" height="48" style={{opacity:0.4}} /></span>
                  <p>This folder is empty</p>
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              <span className="icon"><img src="/icons/picture-folder.svg" alt="" width="48" height="48" style={{opacity:0.4}} /></span>
              <p>Select a folder from the sidebar to start browsing</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Or click + to add a new folder</p>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="context-item" onClick={() => handleCopyPath(contextMenu.item)}><img src="/icons/note.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:6}} /> 复制路径</div>
          <div className="context-item" onClick={() => handleOpenInExplorer(contextMenu.item)}><img src="/icons/folder-open.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:6}} /> 在文件管理器中打开</div>
          <div className="context-item" onClick={() => {
            const enc = btoa(String.fromCharCode(...new TextEncoder().encode(contextMenu.item.path)))
              .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            window.open(`/api/image/view?path=${enc}`, '_blank');
            setContextMenu(null);
          }}><img src="/icons/chain.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:6}} /> 新标签页打开</div>
          <div className="context-item" onClick={() => { addFavorite(contextMenu.item); setContextMenu(null); }}><img src="/icons/star.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:6}} /> 添加到收藏</div>
          {contextMenu.item.type === 'image' && (
            <div className="context-item" onClick={async () => {
              try {
                const enc = btoa(String.fromCharCode(...new TextEncoder().encode(contextMenu.item.path))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
                const img = await fetch(`/api/image/view?path=${enc}`).then(r => r.blob());
                await navigator.clipboard.write([new ClipboardItem({ [img.type]: img })]);
              } catch (_) {}
              setContextMenu(null);
            }}><img src="/icons/picture.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:6}} /> 复制图片</div>
          )}
          {contextMenu.item.folder && contextMenu.item.folder !== '.' && (
            <div className="context-item" onClick={() => {
              const sep = contextMenu.item.path.includes('\\') ? '\\' : '/';
              const dir = contextMenu.item.path.substring(0, contextMenu.item.path.lastIndexOf(sep));
              handleBrowse(dir);
              setContextMenu(null);
            }}><img src="/icons/folder.svg" alt="" width="14" height="14" style={{verticalAlign:'middle',marginRight:6}} /> 跳转到所在文件夹</div>
          )}
          <div className="context-separator" />
          <div className="context-item context-shortcut">
            <span>快捷键提示: Ctrl+F 搜索 · F5 刷新 · Ctrl+A 全选</span>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex >= 0 && allMedia.length > 0 && (
        <Lightbox
          images={allMedia}
          currentIndex={lightboxIndex}
          onClose={handleCloseLightbox}
          onNavigate={setLightboxIndex}
          favorites={favorites}
          onAddFavorite={addFavorite}
          onRemoveFavorite={removeFavorite}
        />
      )}
    </div>
  );
}
