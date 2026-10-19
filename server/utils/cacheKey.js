// Pure cache-key helpers — no filesystem access, so they are cheap to unit test
// and cannot fail in ways that hide a bug.
//
// 缓存文件名里带「源文件指纹」(mtime + 体积)，而不是只靠「缓存文件比源文件新」
// 来判断是否过期。原因：原来的判断是 `cacheStat.mtime > fileStat.mtime`。
// 删掉 a.jpg 再放一张同名的新 a.jpg 时，如果新文件的 mtime 更旧（从相机、压缩包、
// 网络盘拷进来的照片几乎都保留原始时间戳），旧缓存会永远「看起来更新」——
// 缩略图/预览图就永久停在上一张图上。把指纹写进文件名后，命中条件是「文件名
// 完全一致」，与写入先后无关；源文件一变，名字就变，旧文件由 sweep/LRU 回收。

const path = require('path');
const crypto = require('crypto');

const THUMB_FITS = ['cover', 'inside'];
const PREVIEW_FORMATS = ['jpg', 'webp'];
const FINGERPRINT = '\\d+-\\d+';

// Cache keys must be based on the *normalized* path. Requests can carry an
// equivalent-but-different spelling (doubled separators, `..`, trailing sep), and
// `fs` operations collapse those via path.normalize() — so without normalizing
// here, a delete would successfully unlink the file yet silently miss its cache.
function pathHash(p) {
  return crypto.createHash('md5').update(path.normalize(String(p))).digest('hex');
}

/**
 * 源文件内容指纹：mtime(ms) + 字节数。
 *
 * @param {{mtimeMs?: number, size?: number}} stat - `fs.stat()` 的结果
 * @returns {string} 形如 `1739790000123-3842048`
 */
function sourceFingerprint(stat) {
  const mtime = stat && Number.isFinite(stat.mtimeMs) ? Math.round(stat.mtimeMs) : 0;
  const size = stat && Number.isFinite(stat.size) ? stat.size : 0;
  return `${mtime}-${size}`;
}

function positiveInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** `<md5(path)>__<size>__<fit>__<mtime>-<bytes>.jpg`（存放于 cache/thumbnails/） */
function thumbnailName(filePath, size, fit, stat) {
  const safeFit = THUMB_FITS.includes(fit) ? fit : 'cover';
  return `${pathHash(filePath)}__${positiveInt(size)}__${safeFit}__${sourceFingerprint(stat)}.jpg`;
}

/** `<md5(path)>__<maxEdge>__<jpg|webp>__<mtime>-<bytes>`（存放于 cache/previews/） */
function previewName(filePath, maxEdge, format, stat) {
  const safeFormat = PREVIEW_FORMATS.includes(format) ? format : 'jpg';
  return `${pathHash(filePath)}__${positiveInt(maxEdge)}__${safeFormat}__${sourceFingerprint(stat)}`;
}

/** `<md5(path)>__<mtimeMs>.mp4`（存放于 cache/transcodes/） */
function transcodeName(filePath, mtimeMs) {
  return `${pathHash(filePath)}__${Math.round(Number(mtimeMs) || 0)}.mp4`;
}

// Anything that does not match these is a leftover from an older naming scheme
// (no fingerprint): it can never be hit again and is reclaimed by the sweep.
const THUMB_RE = new RegExp(`^([0-9a-f]{32})__(\\d+)__(?:cover|inside)__${FINGERPRINT}\\.jpg(?:\\.broken)?$`);
const TRANSCODE_RE = /^([0-9a-f]{32})__(\d+)\.mp4$/;
const PREVIEW_RE = new RegExp(`^([0-9a-f]{32})__(\\d+)__(?:jpg|webp)__${FINGERPRINT}(?:\\.broken)?$`);

module.exports = {
  THUMB_FITS,
  PREVIEW_FORMATS,
  pathHash,
  sourceFingerprint,
  thumbnailName,
  previewName,
  transcodeName,
  THUMB_RE,
  TRANSCODE_RE,
  PREVIEW_RE
};
