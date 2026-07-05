import React, { useState, useEffect, useCallback, useRef } from 'react';
import useApi from '../hooks/useApi';
import './Lightbox.css';

export default function Lightbox({ images, currentIndex, onClose, onNavigate }) {
  const { getImageUrl, getThumbnailUrl } = useApi();
  const [loaded, setLoaded] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [zoom, setZoom] = useState(1);
  const slideshowRef = useRef(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const item = images[currentIndex];
  if (!item) {
    onClose();
    return null;
  }

  const isVideo = item.type === 'video';

  const goNext = useCallback(() => {
    setLoaded(false);
    setZoom(1);
    onNavigate((currentIndex + 1) % images.length);
  }, [currentIndex, images.length, onNavigate]);

  const goPrev = useCallback(() => {
    setLoaded(false);
    setZoom(1);
    onNavigate((currentIndex - 1 + images.length) % images.length);
  }, [currentIndex, images.length, onNavigate]);

  // Slideshow (skip videos)
  useEffect(() => {
    if (slideshow && !isVideo) {
      slideshowRef.current = setInterval(goNext, 4000);
      return () => clearInterval(slideshowRef.current);
    }
    return () => {};
  }, [slideshow, goNext, isVideo]);

  // Keyboard shortcuts
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
          if (!isVideo) setZoom(z => Math.min(z + 0.25, 5));
          break;
        case '-':
          if (!isVideo) setZoom(z => Math.max(z - 0.25, 0.25));
          break;
        case '0':
          if (!isVideo) setZoom(1);
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, goNext, goPrev, isVideo]);

  // Touch swipe
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 60) {
      if (dx > 0) goPrev();
      else goNext();
    }
  };

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      {/* Top bar */}
      <div className="lightbox-topbar" onClick={e => e.stopPropagation()}>
        <div className="lightbox-info">
          <span className="lightbox-type">{isVideo ? '🎬' : '🖼️'}</span>
          <span className="lightbox-filename">{item.name}</span>
          <span className="lightbox-counter">{currentIndex + 1} / {images.length}</span>
        </div>
        <div className="lightbox-actions">
          {!isVideo && (
            <button
              className={`lb-btn ${slideshow ? 'active' : ''}`}
              onClick={() => setSlideshow(s => !s)}
              title="Slideshow"
            >
              {slideshow ? '⏸' : '▶'}
            </button>
          )}
          {!isVideo && (
            <button className="lb-btn" onClick={() => setZoom(1)} title="Reset zoom">
              🔄
            </button>
          )}
          <button className="lb-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        className="lightbox-content"
        onClick={e => e.stopPropagation()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {images.length > 1 && (
          <button className="lightbox-nav lightbox-prev" onClick={goPrev}>‹</button>
        )}

        <div className="lightbox-media-wrap">
          {isVideo ? (
            <video
              key={item.path}
              className="lightbox-video"
              src={getImageUrl(item.path)}
              controls
              autoPlay
              playsInline
              onLoadedData={() => setLoaded(true)}
            />
          ) : (
            <>
              {!loaded && (
                <div className="lightbox-loading"><div className="spinner" /></div>
              )}
              <img
                src={getImageUrl(item.path)}
                alt={item.name}
                className={`lightbox-image ${loaded ? 'loaded' : ''}`}
                style={{ transform: `scale(${zoom})` }}
                onLoad={() => setLoaded(true)}
                onDoubleClick={() => setZoom(z => z === 1 ? 2 : 1)}
                draggable={false}
              />
            </>
          )}
        </div>

        {images.length > 1 && (
          <button className="lightbox-nav lightbox-next" onClick={goNext}>›</button>
        )}
      </div>

      {/* Thumbnails strip */}
      <div className="lightbox-thumbs" onClick={e => e.stopPropagation()}>
        {images.map((img, i) => (
          <div
            key={img.path}
            className={`lightbox-thumb ${i === currentIndex ? 'active' : ''}`}
            onClick={() => { setLoaded(false); setZoom(1); onNavigate(i); }}
          >
            {img.type === 'video' ? (
              <div className="thumb-video-placeholder">
                <span>▶</span>
              </div>
            ) : (
              <img src={getImageUrl(img.path)} alt="" loading="lazy" />
            )}
          </div>
        ))}
      </div>

      {/* Hints */}
      <div className="lightbox-hints">
        <span>← → Navigate</span>
        {!isVideo && <span>Space Slideshow</span>}
        {!isVideo && <span>+/- Zoom</span>}
        <span>Esc Close</span>
      </div>
    </div>
  );
}
