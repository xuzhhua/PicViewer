/**
 * HTTP 缓存（ETag / Last-Modified / 304）工具。
 *
 * 之前 `/api/image/view` 只给了 `max-age=3600`：一小时一过，浏览器就必须把
 * 整份原图重新下回来，哪怕文件一个字节都没变 —— 网络盘 + 远程访问时，这等于
 * 每小时白传几十上百 MB。给上 ETag（mtime + size，文件一变就变）之后，重复
 * 访问只需要一个几十字节的 304。
 *
 * 条件请求的判断也放在生成之前：浏览器已经有的东西，不该再跑一次 sharp。
 */

/** 由文件 stat 生成 ETag：mtime 变了 tag 就变，size 兜底防止 mtime 精度不足。 */
function makeEtag(stat) {
  return `"${Math.round(stat.mtimeMs)}-${stat.size}"`;
}

/** 客户端手里的副本是否仍然有效（If-None-Match 优先于 If-Modified-Since）。 */
function isFresh(req, stat) {
  const headers = (req && req.headers) || {};
  const inm = headers['if-none-match'];
  if (inm) {
    const etag = makeEtag(stat);
    return String(inm)
      .split(',')
      .some((token) => {
        const t = token.trim();
        return t === '*' || t === etag;
      });
  }
  const ims = headers['if-modified-since'];
  if (ims) {
    const since = Date.parse(ims);
    if (!Number.isNaN(since)) {
      return Math.floor(stat.mtimeMs / 1000) <= Math.floor(since / 1000);
    }
  }
  return false;
}

/**
 * 写入 ETag / Last-Modified / Cache-Control；条件请求命中时直接回 304。
 * @returns {boolean} true 表示已经结束响应（304），调用方必须立即 return
 */
function applyFreshness(req, res, stat, cacheControl) {
  res.setHeader('ETag', makeEtag(stat));
  if (stat.mtime) res.setHeader('Last-Modified', stat.mtime.toUTCString());
  if (cacheControl) res.setHeader('Cache-Control', cacheControl);
  if (isFresh(req, stat)) {
    res.statusCode = 304;
    res.removeHeader('Content-Length');
    res.removeHeader('Content-Type');
    res.end();
    return true;
  }
  return false;
}

module.exports = { makeEtag, isFresh, applyFreshness };
