/**
 * 灯箱预览图的参数规则（纯函数，无 I/O —— 方便直接单测）。
 *
 * 预览图由服务端缩放生成：客户端按「屏幕最长边 × DPR」传 w，服务端负责夹紧，
 * 避免奇怪的参数（0/-1/999999）把缓存撑爆或生成无意义的巨图。
 */

// 常见笔记本/桌面屏 1920 上下；手机和平板按 DPR 折算后往往更大
const PREVIEW_DEFAULT_EDGE = 1920;
const PREVIEW_MIN_EDGE = 320;
// 再大就只是白传字节了（超过 4K 屏幕的情况极少）
const PREVIEW_MAX_EDGE = 4096;

/** 把客户端传来的 w 规整成合法的长边像素值。 */
function clampPreviewEdge(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return PREVIEW_DEFAULT_EDGE;
  return Math.min(PREVIEW_MAX_EDGE, Math.max(PREVIEW_MIN_EDGE, n));
}

module.exports = {
  PREVIEW_DEFAULT_EDGE,
  PREVIEW_MIN_EDGE,
  PREVIEW_MAX_EDGE,
  clampPreviewEdge,
};
