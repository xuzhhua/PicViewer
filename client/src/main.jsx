import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './pwa';
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

// 局域网/远程访问模式下，服务端要求非本机请求带访问令牌。
// 用启动日志里带 `?token=…` 的地址打开时，服务端已经在响应里种了 HttpOnly
// Cookie（页面里的 fetch / <img> 会自动带上），这里只负责把 token 从地址栏
// 抹掉：截图、复制链接、Referer 都不该把令牌带出去。
(function stripTokenFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('token')) return;
    url.searchParams.delete('token');
    const search = url.searchParams.toString();
    window.history.replaceState({}, '', url.pathname + (search ? '?' + search : '') + url.hash);
  } catch (_) { /* 老浏览器/异常 URL 忽略 */ }
})();

// Register PWA Service Worker + 更新检测（dev 下自动跳过，见 src/pwa.js）
registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
