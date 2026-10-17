/**
 * HTTP Range 头解析（纯函数，无 I/O —— 方便直接单测）。
 *
 * 之前是手写的 `range.replace(/bytes=/,'').split('-')` + `parseInt`：
 *  - `bytes=-500`（取最后 500 字节）解析出 `start=NaN`，回 `Content-Range: bytes NaN-…`
 *    和 `Content-Length: NaN`，Node 直接抛错变 500；
 *  - `bytes=99999999-` 越界时也回 206 + 负数长度；
 *  - 多段 Range 完全没处理。
 *
 * 现在的语义（按 RFC 7233，非法就忽略、越界回 416）：
 *  - 无法解析 → `{type:'none'}`，调用方按普通 200 整份响应
 *  - 起点越界 → `{type:'unsatisfiable'}`，调用方回 416 + `Content-Range: bytes *\/size`
 *  - 正常 → `{type:'partial', start, end}`，两端都已夹到 `[0, size-1]`
 */

// 客户端只发 `bytes=0-` 时，一次只回 5MB：让浏览器自己续请求，
// 避免一个请求把整个 4GB 视频挂在内存/连接上。
const MAX_CHUNK_BYTES = 5 * 1024 * 1024;

function parseRange(header, size) {
  if (typeof header !== 'string' || header.trim() === '') return { type: 'none' };
  if (!Number.isFinite(size) || size <= 0) return { type: 'none' };

  const match = /^bytes=(.+)$/i.exec(header.trim());
  if (!match) return { type: 'none' }; // 单位不认识：忽略 Range

  // 多段 Range 只满足第一段（浏览器看视频只会发单段）
  const spec = match[1].split(',')[0].trim();
  const dash = spec.indexOf('-');
  if (dash === -1) return { type: 'none' };

  const rawStart = spec.slice(0, dash).trim();
  const rawEnd = spec.slice(dash + 1).trim();

  let start;
  let end;

  if (rawStart === '') {
    // 后缀：bytes=-500 → 最后 500 字节
    const suffix = parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { type: 'none' };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    if (!Number.isFinite(start) || start < 0) return { type: 'none' };
    if (start >= size) return { type: 'unsatisfiable' };
    if (rawEnd === '') {
      end = Math.min(start + MAX_CHUNK_BYTES - 1, size - 1);
    } else {
      end = parseInt(rawEnd, 10);
      if (!Number.isFinite(end) || end < start) return { type: 'none' };
      end = Math.min(end, size - 1);
    }
  }

  return { type: 'partial', start, end };
}

module.exports = { parseRange, MAX_CHUNK_BYTES };
