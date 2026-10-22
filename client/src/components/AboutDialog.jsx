import React, { useEffect } from 'react';
import './ConfirmDialog.css'; // 复用遮罩 / 按钮样式，保证与删除确认框一致
import './AboutDialog.css';

// 构建时由 client/vite.config.js 从根 package.json 注入，避免 UI 里再维护一份版本号
/* global __APP_VERSION__, __APP_REPOSITORY__ */
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
const APP_REPOSITORY = typeof __APP_REPOSITORY__ !== 'undefined' ? __APP_REPOSITORY__ : '';
const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.txt';

/**
 * 关于 / 许可证对话框。
 *
 * GPL-3.0 与 AGPL-3.0 都要求「交互式界面显示 Appropriate Legal Notices」：
 * 版权声明、无担保声明、以及如何查看许可证全文。AGPL 第 13 条另有网络使用
 * 时提供对应源码的义务，所以这里同时给出仓库地址（即源代码位置）。
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
          <p className="about-copyright">Copyright (C) 2026 xuzhhua</p>
          <p>
            本程序是自由软件：你可以再分发和/或修改它，但须遵守
            <strong> GNU Affero 通用公共许可证第 3 版</strong>（或你选择的任何更高版本）的条款。
          </p>
          <p>
            本程序<strong>不提供任何担保</strong>，包括适销性或特定用途适用性的默示担保。
            详见许可证第 15、16 条。
          </p>
          <p>
            若你修改本程序并通过网络向他人提供服务，必须向使用者提供对应的完整源代码
            （AGPL 第 13 条）。
          </p>
          <p>
            许可证全文：
            <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer">gnu.org/licenses/agpl-3.0.txt</a>
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
