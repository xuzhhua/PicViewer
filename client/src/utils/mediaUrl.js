/**
 * 浏览条目的「内容版本」——把文件大小 + 修改时间拼成 URL 参数。
 *
 * 服务端缓存键已经带了源文件指纹（见 server/utils/cacheKey.js），但浏览器自己
 * 还有一层 HTTP 缓存：同一个 URL（同一个路径）在 max-age 内根本不会回服务器。
 * 于是「删掉 a.jpg 再放一张同名的新 a.jpg」之后，缩略图、预览图和原图都会继续
 * 显示上一张——这正是用户报的那个 bug。把内容版本拼进 URL 后，文件一换 URL 就
 * 换，浏览器必须重新取；文件没变则 URL 不变，缓存照常命中。
 *
 * 注意：浏览接口返回的 `modified` 是 ISO 字符串，`size` 是字节数，两者一起才能
 * 覆盖「同尺寸覆盖」这种边角情况。
 *
 * @param {{path?: string, size?: number, modified?: string}} item - 浏览接口返回的条目
 * @returns {string} 形如 `1739790000123-3842048`；信息不全时返回空串（不加参数）
 */
export function mediaVersion(item) {
  if (!item || !item.path) return '';
  const size = Number.isFinite(item.size) ? String(item.size) : '';
  let stamp = '';
  if (item.modified) {
    const ms = new Date(item.modified).getTime();
    stamp = Number.isFinite(ms) ? String(ms) : String(item.modified);
  }
  if (!stamp && !size) return '';
  return `${stamp}-${size}`;
}
