import React, { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot, applyUpdate, dismissUpdate } from '../pwa';
import './UpdateToast.css';

/**
 * 新版本提示条。检测到新版本时从底部弹出，用户确认后才刷新，
 * 不会打断正在看图/看视频的状态。
 */
export default function UpdateToast() {
  const { available } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!available) return null;

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <div className="update-toast-text">
        <span className="update-toast-title">发现新版本</span>
        <span className="update-toast-desc">更新后即可使用最新功能</span>
      </div>
      <div className="update-toast-actions">
        <button type="button" className="update-toast-btn primary" onClick={applyUpdate}>
          立即更新
        </button>
        <button type="button" className="update-toast-btn" onClick={dismissUpdate}>
          稍后
        </button>
      </div>
    </div>
  );
}
