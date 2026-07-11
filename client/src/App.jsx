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
];

export default function App() {
  const { folders, browseData, loading, error, addFolder, removeFolder, browse, pickFolder } = useApi();

  const [currentPath, setCurrentPath] = useState('');
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState('grid');

  const handleBrowse = useCallback((folderPath) => {
    setCurrentPath(folderPath);
    setSearchQuery('');
    setSidebarOpen(false);
    browse(folderPath, true);
  }, [browse]);

  const handleBackToRoot = useCallback(() => {
    setCurrentPath('');
    setSearchQuery('');
    browse('', true);
  }, [browse]);

  const handleOpenLightbox = useCallback((index) => {
    setLightboxIndex(index);
  }, []);

  const handleCloseLightbox = useCallback(() => {
    setLightboxIndex(-1);
  }, []);

  // Filter images/videos by search query
  const filteredImages = browseData?.images?.filter(img =>
    !searchQuery || img.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];
  const filteredVideos = browseData?.videos?.filter(v =>
    !searchQuery || v.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

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
        />
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
            <div className="view-mode-switcher">
              {VIEW_MODES.map(m => (
                <button
                  key={m.key}
                  className={`vm-btn${viewMode === m.key ? ' active' : ''}`}
                  onClick={() => setViewMode(m.key)}
                  title={m.label}
                >
                  {m.icon}
                </button>
              ))}
            </div>
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

        {/* Content */}
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
                  onImageClick={(i) => handleOpenLightbox(i)}
                  viewMode={viewMode}
                />
              )}

              {filteredVideos.length > 0 && (
                <VideoGrid
                  videos={filteredVideos}
                  onVideoClick={(i) => handleOpenLightbox(filteredImages.length + i)}
                  viewMode={viewMode}
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
