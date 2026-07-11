import React, { useState, useEffect, useCallback, useRef } from 'react';
import useApi from '../hooks/useApi';
import './Lightbox.css';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.15;
const SWIPE_THRESHOLD = 60;

export default function Lightbox({ images, currentIndex, onClose, onNavigate }) {
  const { getImageUrl } = useApi();
  const [loaded, setLoaded] = useState(false);
  const [videoLoading, setVideoLoading] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const slideshowRef = useRef(null);

  // Refs to keep latest values for synchronous access in event handlers
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panRef.current.x = panX; }, [panX]);
  useEffect(() => { panRef.current.y = panY; }, [panY]);

  // Touch/pinch tracking
  const touchRef = useRef({
    startX: 0, startY: 0,
    pinchDist: 0, pinchZoom: 1,
    panStartX: 0, panStartY: 0,
    isPinching: false,
    isPanning: false,
    moved: false
  });

  // Mouse drag tracking
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, panStartX: 0, panStartY: 0 });

  const item = images[currentIndex];
  if (!item) { onClose(); return null; }
  const isVideo = item.type === 'video';

  // Set video loading state when item changes
  useEffect(() => {
    if (isVideo) setVideoLoading(true);
  }, [item?.path, isVideo]);

  const resetView = useCallback(() => {
    setZoom(1); setPanX(0); setPanY(0);
    zoomRef.current = 1; panRef.current = { x: 0, y: 0 };
  }, []);
  const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const goNext = useCallback(() => {
    setLoaded(false); setVideoLoading(true); resetView();
    onNavigate((currentIndex + 1) % images.length);
  }, [currentIndex, images.length, onNavigate, resetView]);

  const goPrev = useCallback(() => {
    setLoaded(false); setVideoLoading(true); resetView();
    onNavigate((currentIndex - 1 + images.length) % images.length);
  }, [currentIndex, images.length, onNavigate, resetView]);

  // Slideshow
  useEffect(() => {
    if (slideshow && !isVideo) {
      slideshowRef.current = setInterval(goNext, 4000);
      return () => clearInterval(slideshowRef.current);
    }
    return () => {};
  }, [slideshow, goNext, isVideo]);

  // Keyboard
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case 'Escape': onClose(); break;
        case 'ArrowLeft': goPrev(); break;
        case 'ArrowRight': goNext(); break;
        case ' ':
          if (!isVideo) { e.preventDefault(); setSlideshow(s => !s); }
          break;
        case '+': case '=':
          if (!isVideo) setZoom(z => clampZoom(z + 0.5));
          break;
        case '-':
          if (!isVideo) setZoom(z => clampZoom(z - 0.5));
          break;
        case '0':
          if (!isVideo) resetView();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev, isVideo, resetView]);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    if (isVideo) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;

    const oldZoom = zoomRef.current;
    const newZoom = clampZoom(oldZoom + delta);
    if (newZoom === oldZoom) return;
    const ratio = newZoom / oldZoom;

    const newPanX = panRef.current.x * ratio + cx * (1 - ratio);
    const newPanY = panRef.current.y * ratio + cy * (1 - ratio);

    zoomRef.current = newZoom;
    panRef.current = { x: newPanX, y: newPanY };
    setZoom(newZoom);
    setPanX(newPanX);
    setPanY(newPanY);
  }, [isVideo]);

  // Touch handlers
  const handleTouchStart = useCallback((e) => {
    if (isVideo) return;
    const touches = e.touches;
    touchRef.current.moved = false;

    if (touches.length === 2) {
      // Pinch start
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      touchRef.current.pinchDist = Math.hypot(dx, dy);
      touchRef.current.pinchZoom = zoomRef.current;
      touchRef.current.isPinching = true;
      touchRef.current.isPanning = false;
    } else if (touches.length === 1) {
      touchRef.current.startX = touches[0].clientX;
      touchRef.current.startY = touches[0].clientY;
      touchRef.current.panStartX = panRef.current.x;
      touchRef.current.panStartY = panRef.current.y;
      touchRef.current.isPinching = false;
      touchRef.current.isPanning = zoomRef.current > 1;
    }
  }, [isVideo]);

  const handleTouchMove = useCallback((e) => {
    if (isVideo) return;
    const touches = e.touches;
    touchRef.current.moved = true;

    if (touches.length === 2 && touchRef.current.isPinching) {
      e.preventDefault();
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      const newDist = Math.hypot(dx, dy);
      if (touchRef.current.pinchDist > 0) {
        const scale = newDist / touchRef.current.pinchDist;
        const newZoom = clampZoom(touchRef.current.pinchZoom * scale);
        zoomRef.current = newZoom;
        setZoom(newZoom);
      }
    } else if (touches.length === 1 && touchRef.current.isPanning && zoomRef.current > 1) {
      const dx = touches[0].clientX - touchRef.current.startX;
      const dy = touches[0].clientY - touchRef.current.startY;
      const newPanX = touchRef.current.panStartX + dx;
      const newPanY = touchRef.current.panStartY + dy;
      panRef.current = { x: newPanX, y: newPanY };
      setPanX(newPanX);
      setPanY(newPanY);
    }
  }, [isVideo]);

  const handleTouchEnd = useCallback((e) => {
    if (isVideo) return;
    if (touchRef.current.isPinching) {
      touchRef.current.isPinching = false;
      if (zoomRef.current > 1) {
        touchRef.current.panStartX = panRef.current.x;
        touchRef.current.panStartY = panRef.current.y;
      }
      return;
    }

    // Swipe to navigate (only when not zoomed and not panning)
    if (!touchRef.current.moved || zoomRef.current > 1) return;
    const dx = (e.changedTouches[0]?.clientX || 0) - touchRef.current.startX;
    const dy = (e.changedTouches[0]?.clientY || 0) - touchRef.current.startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
      if (dx > 0) goPrev(); else goNext();
    }
  }, [goNext, goPrev, isVideo]);

  // Mouse drag pan
  const handleMouseDown = useCallback((e) => {
    if (isVideo || e.button !== 0 || zoomRef.current <= 1) return;
    e.preventDefault();
    setDragging(true);
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      panStartX: panRef.current.x, panStartY: panRef.current.y
    };
  }, [isVideo]);

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e) => {
      const newPanX = dragRef.current.panStartX + e.clientX - dragRef.current.startX;
      const newPanY = dragRef.current.panStartY + e.clientY - dragRef.current.startY;
      panRef.current = { x: newPanX, y: newPanY };
      setPanX(newPanX);
      setPanY(newPanY);
    };
    const handleUp = () => setDragging(false);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      {/* Top bar */}
      <div className="lightbox-topbar" onClick={e => e.stopPropagation()}>
        <div className="lightbox-info">
          <span className="lightbox-type">{isVideo ? '🎬' : <img src="/icons/picture.svg" alt="" width="16" height="16" className="lb-icon" />}</span>
          <span className="lightbox-filename">{item.name}</span>
          <span className="lightbox-counter">{currentIndex + 1} / {images.length}</span>
          {zoom !== 1 && <span className="lightbox-zoom-label">{Math.round(zoom * 100)}%</span>}
        </div>
        <div className="lightbox-actions">
          {!isVideo && (
            <button className={`lb-btn ${slideshow ? 'active' : ''}`}
              onClick={() => setSlideshow(s => !s)} title="Slideshow">
              {slideshow ? '⏸' : '▶'}
            </button>
          )}
          {!isVideo && (
            <button className="lb-btn" onClick={resetView} title="Reset zoom">🔄</button>
          )}
          <button className={`lb-btn${showInfo ? ' active' : ''}`} onClick={() => setShowInfo(i => !i)} title="详细信息">ℹ️</button>
          <button className="lb-btn" onClick={onClose} title="Close">✕</button>
        </div>
      </div>

      {/* Content */}
      <div className="lightbox-content" onClick={e => e.stopPropagation()}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {images.length > 1 && (
          <button className="lightbox-nav lightbox-prev" onClick={goPrev}>‹</button>
        )}

        <div className="lightbox-media-wrap">
          {isVideo ? (
            <div className="lightbox-video-container">
              {videoLoading && (
                <div className="lightbox-video-loading">
                  <div className="spinner" />
                  <span className="lightbox-video-loading-text">正在处理视频...</span>
                </div>
              )}
              <video key={item.path}
                className={`lightbox-video ${!videoLoading ? 'loaded' : ''}`}
                src={getImageUrl(item.path)} controls autoPlay playsInline
                onLoadedData={() => { setLoaded(true); setVideoLoading(false); }}
                onError={() => setVideoLoading(false)} />
            </div>
          ) : (
            <div
              className="lightbox-image-container"
              onMouseDown={handleMouseDown}
              style={{
                cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
                transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
                transition: touchRef.current.isPinching ? 'none' : undefined
              }}
            >
              {!loaded && <div className="lightbox-loading"><div className="spinner" /></div>}
              <img
                src={getImageUrl(item.path)} alt={item.name}
                className={`lightbox-image ${loaded ? 'loaded' : ''}`}
                onLoad={() => setLoaded(true)}
                draggable={false}
              />
            </div>
          )}
        </div>

        {images.length > 1 && (
          <button className="lightbox-nav lightbox-next" onClick={goNext}>›</button>
        )}
      </div>

      {/* Thumbnails */}
      <div className="lightbox-thumbs" onClick={e => e.stopPropagation()}>
        {images.map((img, i) => (
          <div key={img.path}
            className={`lightbox-thumb ${i === currentIndex ? 'active' : ''}`}
            onClick={() => { setLoaded(false); setVideoLoading(true); resetView(); onNavigate(i); }}>
            {img.type === 'video'
              ? <div className="thumb-video-placeholder"><span>▶</span></div>
              : <img src={getImageUrl(img.path)} alt="" loading="lazy" />}
          </div>
        ))}
      </div>

      <div className="lightbox-hints">
        <span>← → Navigate</span>
        {!isVideo && <span>Scroll Zoom</span>}
        {!isVideo && <span>Pinch Zoom</span>}
        {!isVideo && <span>Drag Pan</span>}
        <span>Esc Close</span>
        <span>ℹ Info</span>
      </div>

      {/* Info panel */}
      {showInfo && (
        <div className="lightbox-info-panel" onClick={e => e.stopPropagation()}>
          <h4>📋 媒体信息</h4>
          <div className="info-grid">
            <span className="info-label">文件名</span>
            <span className="info-value">{item.name}</span>

            <span className="info-label">类型</span>
            <span className="info-value">{isVideo ? '视频' : '图片'}</span>

            {item.format && <>
              <span className="info-label">格式</span>
              <span className="info-value">{item.format.toUpperCase()}</span>
            </>}

            {item.width && item.height && <>
              <span className="info-label">尺寸</span>
              <span className="info-value">{item.width} × {item.height}</span>
            </>}

            <span className="info-label">文件大小</span>
            <span className="info-value">{formatFileSize(item.size)}</span>

            <span className="info-label">修改日期</span>
            <span className="info-value">{formatDate(item.modified)}</span>

            {isVideo && item.duration && <>
              <span className="info-label">时长</span>
              <span className="info-value">{formatDuration(item.duration)}</span>
            </>}

            {isVideo && item.videoCodec && <>
              <span className="info-label">编码</span>
              <span className="info-value">{item.videoCodec}</span>
            </>}

            {isVideo && item.bitrate > 0 && <>
              <span className="info-label">码率</span>
              <span className="info-value">{Math.round(item.bitrate / 1000)} kbps</span>
            </>}

            {!isVideo && item.colorSpace && <>
              <span className="info-label">色彩空间</span>
              <span className="info-value">{item.colorSpace}</span>
            </>}

            {!isVideo && item.channels != null && <>
              <span className="info-label">通道</span>
              <span className="info-value">{item.channels} {item.hasAlpha ? '(含透明)' : ''}</span>
            </>}

            {item.folder && item.folder !== '.' && <>
              <span className="info-label">所在目录</span>
              <span className="info-value">{item.folder}</span>
            </>}

            <span className="info-label">完整路径</span>
            <span className="info-value info-path">{item.path}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN');
}

function formatDuration(seconds) {
  if (!seconds) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
