/**
 * 缩略图请求参数规则（纯函数，无 I/O —— 方便直接单测）。
 *
 * `/api/image/thumbnail?size=` 以前是 `parseInt(req.query.size) || 256` 直接进
 * sharp：`size=20000` 会让 sharp 申请一张 20000×20000 的位图（约 1.6GB），
 * 一个请求就能把服务打死。`fit` 同理，任意字符串都会原样塞给 sharp。
 */

const THUMB_DEFAULT_SIZE = 256;
// 客户端最大的档位是 600（网格 5 档 150/263/375/488/600，瀑布流会 ×3 → 1800）
// 这里给到 2048：既允许客户端放大档位，又挡住 memoria-bomb 级别的请求。
const THUMB_MAX_SIZE = 2048;
const THUMB_MIN_SIZE = 16;
const THUMB_FITS = ['cover', 'inside'];

/** 把 size 规整成 [16, 2048] 的整数，非法值回落 256 */
function clampThumbSize(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return THUMB_DEFAULT_SIZE;
  return Math.min(THUMB_MAX_SIZE, Math.max(THUMB_MIN_SIZE, n));
}

/** fit 白名单：只认服务端真正实现过的两种 */
function normalizeFit(raw) {
  const fit = String(raw || '').toLowerCase();
  return THUMB_FITS.includes(fit) ? fit : 'cover';
}

module.exports = {
  THUMB_DEFAULT_SIZE,
  THUMB_MIN_SIZE,
  THUMB_MAX_SIZE,
  THUMB_FITS,
  clampThumbSize,
  normalizeFit,
};
