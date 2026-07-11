import React, { useState, useCallback } from 'react';
import FolderTree from './components/FolderTree';
import ImageGrid, { VideoGrid } from './components/ImageGrid';
import Lightbox from './components/Lightbox';
import SearchBar from './components/SearchBar';
import useApi from './hooks/useApi';
import './App.css';

const VIEW_MODES = [
  { key: 'grid', icon: '⊞', label: '网格' },
  { key: 'waterfall', icon: '▥', label: '瀑布' },
  { key: 'list', icon: '☰', label: '列表' },
  { key: 'all', icon: '⊡', label: '全部（含子目录）' },
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
  const { folders, browseData, loading, error, addFolder, removeFolder, reorderFolders, browse, browseRecursive, pickFolder } = useApi();

  const [currentPath, setCurrentPath] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [sortBy, setSortBy] = useState('name');
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('picviewer-theme') || 'dark');
  const isRecursive = viewMode === 'all';

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('picviewer-theme', theme);
  }, [theme]);

  const handleBrowse = useCallback((folderPath) => {
    setCurrentPath(folderPath);
    setSearchQuery('');
    setSidebarOpen(false);
    setSelectedPaths(new Set());
    browse(folderPath, true);
  }, [browse]);

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

  const selectAll = useCallback(() => {
    const all = [...(browseData?.images || []), ...(browseData?.videos || [])];
    setSelectedPaths(new Set(all.map(m => m.path)));
  }, [browseData]);

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

  const handleOpenInExplorer = useCallback((item) => {
    const sep = item.path.includes('\\') ? '\\' : '/';
    const dir = item.path.substring(0, item.path.lastIndexOf(sep));
    window.open(`file:///${dir.replace(/\\/g, '/')}`, '_blank');
    setContextMenu(null);
  }, []);

  const handleBatchDownload = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    const paths = [...selectedPaths];
    const encoded = paths.map(p => {
      const utf8Bytes = new TextEncoder().encode(p);
      return btoa(String.fromCharCode(...utf8Bytes));
    }).join(',');
    window.open(`/api/download?paths=${encoded}`, '_blank');
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
          <span className="logo">🖼️</span>
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
        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="切换主题">
            {theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="main-area">
        {/* Topbar */}
        <div className="topbar">
          <button className="hamburger" onClick={() => setSidebarOpen(o => !o)}>
            {sidebarOpen ? '✕' : '☰'}
          </button>
          <SearchBar value={searchQuery} onChange={setSearchQuery} />

          {browseData && (
            <>
              <div className="view-mode-switcher">
                {VIEW_MODES.map(m => (
                  <button
                    key={m.key}
                    className={`vm-btn${viewMode === m.key ? ' active' : ''}`}
                    onClick={() => handleViewMode(m.key)}
                    title={m.label}
                  >
                    {m.icon}
                  </button>
                ))}
              </div>

              <select className="sort-select" value={sortBy} onChange={e => setSortBy(e.target.value)} title="排序方式">
                {SORT_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </>
          )}

          <div className="breadcrumb">
            <span onClick={handleBackToRoot}>🏠 Root</span>
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={crumb.path}>
                <span className="sep">›</span>
                <span onClick={() => handleBrowse(crumb.path)}>{crumb.name}</span>
              </React.Fragment>
            ))}
          </div>
        </div>

        {selectedPaths.size > 0 && (
          <div className="action-bar">
            <span className="action-bar-count">已选 {selectedPaths.size} 项</span>
            <button className="action-btn" onClick={selectAll}>全选</button>
            <button className="action-btn" onClick={clearSelection}>取消</button>
            <button className="action-btn primary" onClick={handleBatchDownload}>⬇ 批量下载</button>
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
              {browseData.folders && browseData.folders.length > 0 && (
                <div className="folder-section">
                  <h3 className="section-title">📁 Folders</h3>
                  <div className="folder-grid">
                    {browseData.folders.map(folder => (
                      <div
                        key={folder.path}
                        className="folder-card"
                        onClick={() => handleBrowse(folder.path)}
                      >
                        <span className="folder-icon">📁</span>
                        <span className="folder-name">{folder.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filteredImages.length > 0 && (
                <ImageGrid
                  images={filteredImages}
                  onImageClick={(i) => {
                    if (selectedPaths.size > 0) {
                      toggleSelect(filteredImages[i].path, { ctrlKey: true });
                    } else {
                      handleOpenLightbox(i);
                    }
                  }}
                  viewMode={viewMode}
                  selectedPaths={selectedPaths}
                  onToggleSelect={(path, e) => { e.stopPropagation(); toggleSelect(path, e || { ctrlKey: true }); }}
                  onContextMenu={handleContextMenu}
                />
              )}

              {filteredVideos.length > 0 && (
                <VideoGrid
                  videos={filteredVideos}
                  onVideoClick={(i) => {
                    if (selectedPaths.size > 0) {
                      toggleSelect(filteredVideos[i].path, { ctrlKey: true });
                    } else {
                      handleOpenLightbox(filteredImages.length + i);
                    }
                  }}
                  viewMode={viewMode}
                  selectedPaths={selectedPaths}
                  onToggleSelect={(path, e) => { e.stopPropagation(); toggleSelect(path, e || { ctrlKey: true }); }}
                  onContextMenu={handleContextMenu}
                />
              )}

              {(!browseData.folders || browseData.folders.length === 0) && allMedia.length === 0 && (
                <div className="empty">
                  <span className="icon">📭</span>
                  <p>This folder is empty</p>
                </div>
              )}
            </>
          ) : (
            <div className="empty">
              <span className="icon">📂</span>
              <p>Select a folder from the sidebar to start browsing</p>
              <p style={{ fontSize: 12, marginTop: 4 }}>Or click + to add a new folder</p>
            </div>
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <div className="context-item" onClick={() => handleCopyPath(contextMenu.item)}>📋 复制路径</div>
          <div className="context-item" onClick={() => handleOpenInExplorer(contextMenu.item)}>📂 打开所在文件夹</div>
          <div className="context-item" onClick={() => {
            const enc = btoa(String.fromCharCode(...new TextEncoder().encode(contextMenu.item.path)))
              .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
            window.open(`/api/image/view?path=${enc}`, '_blank');
            setContextMenu(null);
          }}>🔗 新标签页打开</div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxIndex >= 0 && allMedia.length > 0 && (
        <Lightbox
          images={allMedia}
          currentIndex={lightboxIndex}
          onClose={handleCloseLightbox}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
