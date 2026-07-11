import React, { useState, useCallback, useEffect } from 'react';
import useApi from '../hooks/useApi';
import './ImageGrid.css';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

// Responsive thumbnail sizing: choose size based on viewport to match column width
function useThumbSize(viewMode) {
  const [width, setWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    let timer;
    const handleResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setWidth(window.innerWidth), 150);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  if (viewMode === 'list') return { size: width < 768 ? 120 : 200, fit: 'inside' };
  if (viewMode === 'waterfall' || viewMode === 'all') {
    // Waterfall columns: 4 (1201+), 3 (769-1200), 2 (<769)
    // Thumb should be ~1.5x column width for sharp HiDPI display
    if (width < 769) return { size: 400, fit: 'inside' };
    if (width < 1201) return { size: 500, fit: 'inside' };
    return { size: 600, fit: 'inside' };
  }
  // Grid: minmax(180px, 1fr), 300 is plenty
  if (width < 769) return { size: 250, fit: 'cover' };
  return { size: 300, fit: 'cover' };
}

export default function ImageGrid({ images, onImageClick, viewMode, selectedPaths, onToggleSelect, onContextMenu }) {
  const { getThumbnailUrl } = useApi();

  const getGridClass = () => {
    switch (viewMode) {
      case 'waterfall': case 'all': return 'media-grid media-waterfall';
      case 'list': return 'media-list';
      default: return 'media-grid media-grid-default';
    }
  };

  return (
    <div className="image-section">
      <h3 className="section-title"><img src="/icons/picture.svg" alt="" width="18" height="18" className="title-icon" /> {viewMode === 'all' ? '全部图片' : '图片'} ({images.length}){viewMode === 'all' ? ' · 含子目录' : ''}</h3>
      <div className={getGridClass()}>
        {images.map((img, index) => (
          <MediaCard
            key={img.path}
            item={img}
            index={index}
            onClick={onImageClick}
            getThumbnailUrl={getThumbnailUrl}
            viewMode={viewMode}
            isSelected={selectedPaths?.has(img.path)}
            onToggleSelect={onToggleSelect}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </div>
  );
}

export function VideoGrid({ videos, onVideoClick, viewMode, selectedPaths, onToggleSelect, onContextMenu }) {
  const { getThumbnailUrl } = useApi();

  const getGridClass = () => {
    switch (viewMode) {
      case 'waterfall': case 'all': return 'media-grid media-waterfall';
      case 'list': return 'media-list';
      default: return 'media-grid media-grid-default';
    }
  };

  return (
    <div className="image-section">
      <h3 className="section-title">🎬 {viewMode === 'all' ? '全部视频' : '视频'} ({videos.length}){viewMode === 'all' ? ' · 含子目录' : ''}</h3>
      <div className={getGridClass()}>
        {videos.map((vid, i) => (
          <MediaCard
            key={vid.path}
            item={vid}
            index={i}
            onClick={onVideoClick}
            getThumbnailUrl={getThumbnailUrl}
            viewMode={viewMode}
            isSelected={selectedPaths?.has(vid.path)}
            onToggleSelect={onToggleSelect}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </div>
  );
}

function MediaCard({ item, index, onClick, getThumbnailUrl, viewMode, isSelected, onToggleSelect, onContextMenu }) {
  const isVideo = item.type === 'video';
  const { size: thumbSize, fit: thumbFit } = useThumbSize(viewMode);

  if (viewMode === 'list') {
    const dims = item.width && item.height ? `${item.width}×${item.height}` : '';
    const fmt = item.format ? item.format.toUpperCase() : '';
    return (
      <div
        className={`media-list-item${isSelected ? ' selected' : ''}`}
        onClick={() => onClick(index)}
        onContextMenu={(e) => onContextMenu?.(e, item)}
      >
        <div className="media-check" onClick={(e) => onToggleSelect?.(item.path, e)}>
          <input type="checkbox" checked={!!isSelected} readOnly />
        </div>
        <div className="media-list-thumb">
          <LazyThumbnail
            src={getThumbnailUrl(item.path, thumbSize, thumbFit)}
            alt={item.name}
            isVideo={isVideo}
          />
        </div>
        <div className="media-list-info">
          <span className="media-list-name" title={item.name}>{item.name}</span>
          {item.folder && item.folder !== '.' && (
            <span className="media-list-folder" title={item.folder}>📁 {item.folder}</span>
          )}
          <span className="media-list-meta">
            {isVideo ? '🎬 ' : ''}{formatSize(item.size)} · {formatDate(item.modified)}
          </span>
        </div>
        <div className="media-list-detail">
          {dims && <span className="media-list-tag">{dims}</span>}
          {fmt && <span className="media-list-tag">{fmt}</span>}
          {!isVideo && <span className="media-list-tag">图片</span>}
          {isVideo && <span className="media-list-tag">视频</span>}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`image-card${isSelected ? ' selected' : ''}`}
      onClick={() => onClick(index)}
      onContextMenu={(e) => onContextMenu?.(e, item)}
    >
      <div className="image-card-thumb">
        <div className="image-check" onClick={(e) => onToggleSelect?.(item.path, e)}>
          <input type="checkbox" checked={!!isSelected} readOnly />
        </div>
        <LazyThumbnail
          src={getThumbnailUrl(item.path, thumbSize, thumbFit)}
          alt={item.name}
          isVideo={isVideo}
        />
      </div>
      <div className="image-card-info">
        <span className="image-card-name" title={item.name}>{item.name}</span>
        {item.folder && item.folder !== '.' && (
          <span className="image-card-folder" title={item.folder}>📁 {item.folder}</span>
        )}
        <span className="image-card-meta">
          {isVideo ? '🎬 ' : ''}{formatSize(item.size)} · {formatDate(item.modified)}
        </span>
      </div>
    </div>
  );
}

function LazyThumbnail({ src, alt, isVideo }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="thumb-error">
        <span>{isVideo ? '🎬' : <img src="/icons/picture.svg" alt="" width="14" height="14" className="thumb-icon" />}</span>
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="thumb-placeholder">
          <div className="spinner" />
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        style={{ opacity: loaded ? 1 : 0 }}
      />
    </>
  );
}
