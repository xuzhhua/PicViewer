import React, { useEffect } from 'react';
import './ConfirmDialog.css';

export default function ConfirmDialog({
  open = false,
  title = '确认操作',
  message = '',
  names = [],
  confirmText = '确认',
  cancelText = '取消',
  onConfirm,
  onCancel,
  danger = true
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={e => e.stopPropagation()}
      >
        <div className={`confirm-icon${danger ? ' danger' : ''}`}>
          <img src="/icons/trash.svg" alt="" width="26" height="26" />
        </div>
        <h3 className="confirm-title">{title}</h3>
        {message && <p className="confirm-message">{message}</p>}
        {names && names.length > 0 && (
          <ul className="confirm-names">
            {names.slice(0, 5).map(name => <li key={name} title={name}>{name}</li>)}
            {names.length > 5 && <li className="confirm-more">… 等 {names.length} 项</li>}
          </ul>
        )}
        <div className="confirm-actions">
          <button type="button" className="confirm-btn" onClick={onCancel}>{cancelText}</button>
          <button
            type="button"
            className={`confirm-btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
