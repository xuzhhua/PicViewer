import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Inject PWA manifest inline to bypass auth proxy CORS
(function injectManifest() {
  const base = window.location.origin;
  const manifest = {
    name: 'PicViewer - 本地图片浏览器',
    short_name: 'PicViewer',
    description: '本地图片/视频浏览与管理工具',
    start_url: base + '/',
    scope: base + '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#0c0c0e',
    background_color: '#0c0c0e',
    lang: 'zh-CN',
    categories: ['photo', 'utilities'],
    icons: [
      { src: base + '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: base + '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: base + '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = url;
  document.head.appendChild(link);
})();

// Register PWA Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(
      (registration) => {
        console.log('[PWA] Service Worker registered:', registration.scope);
      },
      (err) => {
        console.warn('[PWA] Service Worker registration failed:', err);
      }
    );
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
