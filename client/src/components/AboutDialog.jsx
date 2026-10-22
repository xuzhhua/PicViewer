import React, { useEffect } from 'react';
import './ConfirmDialog.css'; // 复用遮罩 / 按钮样式，保证与删除确认框一致
import './AboutDialog.css';

// 构建时由 client/vite.config.js 从根 package.json 注入，避免 UI 里再维护一份版本号
/* global __APP_VERSION__, __APP_REPOSITORY__ */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
const APP_REPOSITORY = typeof __APP_REPOSITORY__ !== 'undefined' ? __APP_REPOSITORY__ : '';
const LICENSE_URL = 'https://opensource.org/license/mit';

/**
 * 关于 / 许可证对话框。
 *
 * MIT 只要求「在软件的副本或实质性部分中保留版权声明与许可声明」，并不要求在
 * 界面上展示 —— 这里的声明因此是纯便利性的（让使用者随手能看到版本、版权和
 * 许可证全文入口）。若要严格合规，源码/打包产物里的 LICENSE 文件才是必需项。
 */
export default function AboutDialog({ open = false, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onClose}>
      <div
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="关于 PicViewer 与许可证"
        onClick={e => e.stopPropagation()}
      >
        <div className="confirm-icon">
          <img src="/icons/info.svg" alt="" width="26" height="26" />
        </div>
        <h3 className="confirm-title">
          PicViewer <span className="about-version">v{APP_VERSION}</span>
        </h3>
        <p className="confirm-message">本地图片 / 视频浏览器（Electron + Express + React）</p>

        <div className="about-legal">
          <p className="about-copyright">Copyright (c) 2026 xuzhhua</p>
          <p>
            本程序以 <strong>MIT License</strong> 发布：你可以自由使用、修改、分发、商用，
            甚至闭源再发布，<strong>唯一义务是保留本版权声明与许可声明</strong>。
          </p>
          <p>
            本程序按「现状」提供，<strong>不附带任何明示或默示担保</strong>，
            包括适销性、特定用途适用性与非侵权担保。
          </p>
          <p>
            许可证全文：
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">opensource.org/license/mit</a>
            {APP_REPOSITORY && (
              <>
                {' · '}源代码：
                <a href={APP_REPOSITORY} target="_blank" rel="noopener noreferrer">GitHub</a>
              </>
            )}
          </p>
          <p className="about-deps">第三方依赖遵循其各自许可（MIT / ISC / Apache-2.0 等）。</p>
        </div>

        <div className="confirm-actions">
          <button type="button" className="confirm-btn primary" onClick={onClose} autoFocus>关闭</button>
        </div>
      </div>
    </div>
  );
}
