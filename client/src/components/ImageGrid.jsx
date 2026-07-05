import React, { useState, useCallback } from 'react';
import useApi from '../hooks/useApi';
import './ImageGrid.css';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

export default function ImageGrid({ images, onImageClick }) {
  const { getThumbnailUrl } = useApi();

  return (
    <div className="image-section">
      <h3 className="section-title">🖼️ 图片 ({images.length})</h3>
      <div className="image-grid">
        {images.map((img, index) => (
          <div
            key={img.path}
            className="image-card"
            onClick={() => onImageClick(index)}
          >
            <div className="image-card-thumb">
              <LazyThumbnail
                src={getThumbnailUrl(img.path, 300)}
                alt={img.name}
              />
            </div>
            <div className="image-card-info">
              <span className="image-card-name" title={img.name}>{img.name}</span>
              <span className="image-card-meta">
                {formatSize(img.size)} · {formatDate(img.modified)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LazyThumbnail({ src, alt }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="thumb-error">
        <span>🖼️</span>
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
