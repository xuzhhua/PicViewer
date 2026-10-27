/**
 * 复制文本到剪贴板。
 *
 * 手机通过局域网 HTTP（http://192.168.x.x:18093）访问时不是「安全上下文」，
 * `navigator.clipboard` 在 iOS Safari 上直接不存在，在 Chrome 上存在但 writeText
 * 会抛 NotAllowedError。所以必须有 `execCommand('copy')` 的兜底，
 * 否则「复制提示词」在手机上表现为按钮点了没反应。
 *
 * @param {string} text
 * @returns {Promise<boolean>} 是否复制成功
 */
export async function copyText(text) {
  const value = String(text == null ? '' : text);
  if (!value) return false;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (_) { /* 非安全上下文 / 权限被拒 → 走兜底 */ }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    // 放在视口外但仍然可聚焦；iOS 需要 readonly + 可选中
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.fontSize = '16px'; // 避免 iOS 聚焦时页面缩放
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch (_) {
    return false;
  }
}

export default copyText;
