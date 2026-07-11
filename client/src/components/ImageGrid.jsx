import React, { useState, useCallback, useEffect, useRef } from 'react';
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

export default function ImageGrid({ images, onImageClick, viewMode, selectedPaths, onToggleSelect, onContextMenu, onBrowseFolder, isSearch, thumbSize }) {
  const { getThumbnailUrl } = useApi();

  // Thumbnail slider controls display size: grid column width or waterfall column count
  const gridStyle = {};
  let effViewMode = viewMode;
  if (viewMode === 'grid') {
    const colSize = Math.round(thumbSize * 0.72); // card fills ~72% of column
    gridStyle.gridTemplateColumns = `repeat(auto-fill, minmax(${colSize}px, 1fr))`;
    gridStyle.gap = `${Math.round(thumbSize * 0.05)}px`;
  } else if (viewMode === 'waterfall' || viewMode === 'all') {
    const cols = thumbSize > 380 ? 1 : thumbSize > 250 ? 2 : thumbSize > 160 ? 3 : 4;
    gridStyle.columnCount = cols;
  }

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
      <div className={getGridClass()} style={gridStyle}>
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
            onBrowseFolder={onBrowseFolder}
            isSearch={isSearch}
            thumbSize={thumbSize}
          />
        ))}
      </div>
    </div>
  );
}

export function VideoGrid({ videos, onVideoClick, viewMode, selectedPaths, onToggleSelect, onContextMenu, onBrowseFolder, isSearch, thumbSize }) {
  const { getThumbnailUrl } = useApi();

  const gridStyle = {};
  if (viewMode === 'grid') {
    const colSize = Math.round(thumbSize * 0.72);
    gridStyle.gridTemplateColumns = `repeat(auto-fill, minmax(${colSize}px, 1fr))`;
    gridStyle.gap = `${Math.round(thumbSize * 0.05)}px`;
  } else if (viewMode === 'waterfall' || viewMode === 'all') {
    const cols = thumbSize > 380 ? 1 : thumbSize > 250 ? 2 : thumbSize > 160 ? 3 : 4;
    gridStyle.columnCount = cols;
  }

  const getGridClass = () => {
    switch (viewMode) {
      case 'waterfall': case 'all': return 'media-grid media-waterfall';
      case 'list': return 'media-list';
      default: return 'media-grid media-grid-default';
    }
  };

  return (
    <div className="image-section">
      <h3 className="section-title"><img src="/icons/video-camera.svg" alt="" width="18" height="18" className="title-icon" /> {viewMode === 'all' ? '全部视频' : '视频'} ({videos.length}){viewMode === 'all' ? ' · 含子目录' : ''}</h3>
      <div className={getGridClass()} style={gridStyle}>
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
            onBrowseFolder={onBrowseFolder}
            isSearch={isSearch}
            thumbSize={thumbSize}
          />
        ))}
      </div>
    </div>
  );
}

function MediaCard({ item, index, onClick, getThumbnailUrl, viewMode, isSelected, onToggleSelect, onContextMenu, onBrowseFolder, isSearch, thumbSize: overrideSize }) {
  const isVideo = item.type === 'video';
  // Display size comes from CSS grid column. Sharp renders at 2x for HiDPI quality.
  let sharpSize, sharpFit;
  if (overrideSize) {
    const baseSize = overrideSize; // slider value = desired display size in px
    if (viewMode === 'waterfall' || viewMode === 'all') { sharpSize = baseSize * 2; sharpFit = 'inside'; }
    else if (viewMode === 'list') { sharpSize = baseSize; sharpFit = 'inside'; }
    else { sharpSize = baseSize * 2; sharpFit = 'cover'; }
  } else {
    const w = window.innerWidth;
    if (viewMode === 'list') { sharpSize = w < 768 ? 120 : 200; sharpFit = 'inside'; }
    else if (viewMode === 'waterfall' || viewMode === 'all') {
      if (w < 769) { sharpSize = 600; sharpFit = 'inside'; }
      else if (w < 1201) { sharpSize = 800; sharpFit = 'inside'; }
      else { sharpSize = 1000; sharpFit = 'inside'; }
    } else {
      if (w < 769) { sharpSize = 400; sharpFit = 'cover'; }
      else { sharpSize = 500; sharpFit = 'cover'; }
    }
  }

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
            key={`${item.path}-${sharpSize}`}
            src={getThumbnailUrl(item.path, sharpSize, sharpFit)}
            alt={item.name}
            isVideo={isVideo}
          />
        </div>
        <div className="media-list-info">
          <span className="media-list-name" title={item.name}>{item.name}</span>
          {item.folder && item.folder !== '.' && (
            <span className="media-list-folder" title={item.folder}>
              <img src="/icons/folder.svg" alt="" width="12" height="12" style={{verticalAlign:'middle',marginRight:3}} /> {item.folder}
              {isSearch && onBrowseFolder && <button className="list-folder-btn" onClick={e => { e.stopPropagation(); const sep=item.path.includes('\\')?'\\':'/'; const dir=item.path.substring(0,item.path.lastIndexOf(sep)); onBrowseFolder(dir); }} title="打开文件夹">↗</button>}
            </span>
          )}
          <span className="media-list-meta">
            {isVideo && <><img src="/icons/video-camera.svg" alt="" width="12" height="12" style={{verticalAlign:'middle',marginRight:2,opacity:0.7}} /> </>}{formatSize(item.size)} · {formatDate(item.modified)}
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
          key={`${item.path}-${sharpSize}`}
          src={getThumbnailUrl(item.path, sharpSize, sharpFit)}
          alt={item.name}
          isVideo={isVideo}
        />
      </div>
      <div className="image-card-info">
        <span className="image-card-name" title={item.name}>{item.name}</span>
        {item.folder && item.folder !== '.' && (
          <span className="image-card-folder" title={item.folder}>
            <img src="/icons/folder.svg" alt="" width="12" height="12" style={{verticalAlign:'middle',marginRight:3}} /> {item.folder}
            {isSearch && onBrowseFolder && <button className="card-folder-btn" onClick={e => { e.stopPropagation(); const sep=item.path.includes('\\')?'\\':'/'; const dir=item.path.substring(0,item.path.lastIndexOf(sep)); onBrowseFolder(dir); }} title="打开文件夹">↗</button>}
          </span>
        )}
        <span className="image-card-meta">
          {isVideo && <><img src="/icons/video-camera.svg" alt="" width="12" height="12" style={{verticalAlign:'middle',marginRight:2,opacity:0.7}} /> </>}{formatSize(item.size)} · {formatDate(item.modified)}
        </span>
      </div>
    </div>
  );
}

function LazyThumbnail({ src, alt, isVideo }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const prevSrc = useRef(src);

  useEffect(() => {
    if (prevSrc.current !== src) {
      setLoaded(false);
      setError(false);
      prevSrc.current = src;
    }
  }, [src]);

  if (error) {
    return (
      <div className="thumb-error">
        <span>{isVideo ? <img src="/icons/video-camera.svg" alt="" width="14" height="14" className="thumb-icon" /> : <img src="/icons/picture.svg" alt="" width="14" height="14" className="thumb-icon" />}</span>
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
