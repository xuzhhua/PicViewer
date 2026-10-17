/**
 * 媒体元数据的进程内缓存（按 path + size + mtime 失效）。
 *
 * 打开一个目录时 browse.js 会对目录里**每一个**文件各跑一次
 * `sharp().metadata()` / `ffprobe()`，而且是串行的。本地盘每张只要几毫秒，
 * 网络盘（SMB）上每张却是一次 open + read + close —— 200 张图就是几百次
 * 串行往返，首屏要等几十秒；而只要文件内容没变，这些结果就永远不会变。
 *
 * 缓存之后：
 *   - 同一目录的第二次打开、F5、5 秒自动刷新 → 全部命中，基本零耗时
 *   - 文件被覆盖/修改，size 或 mtime 变化 → 自动失效重算
 *
 * 用 Map 的插入顺序做 LRU（命中时 delete + set 挪到队尾），超过上限淘汰最久
 * 未使用的那一项。缓存只存「enrich「出来的附加字段」，不存 name/path/size，
 * 因此浏览时新拿到的文件信息永远以本次 stat 的结果为准。
 */

const DEFAULT_MAX_ENTRIES = 20000;

function createMetaCache({ maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  // 非法值（0 / 负数 / NaN）回落到默认值：缓存容量写成 1 等于完全关掉缓存，
  // 那不是一个「差不多能用」的降级，而是会让网络盘重新变慢的静默故障。
  const requested = Number(maxEntries);
  const limit = Number.isFinite(requested) && requested >= 1
    ? Math.floor(requested)
    : DEFAULT_MAX_ENTRIES;
  const entries = new Map(); // filePath -> { size, mtimeMs, value }
  let hits = 0;
  let misses = 0;

  /**
   * @returns {object|undefined} 命中时返回之前缓存的附加字段对象
   */
  function get(filePath, size, mtimeMs) {
    const entry = entries.get(filePath);
    if (!entry || entry.size !== size || entry.mtimeMs !== mtimeMs) {
      misses += 1;
      return undefined;
    }
    hits += 1;
    // 挪到队尾，维持「越靠前越久未用」的顺序
    entries.delete(filePath);
    entries.set(filePath, entry);
    return entry.value;
  }

  function set(filePath, size, mtimeMs, value) {
    entries.delete(filePath);
    entries.set(filePath, { size, mtimeMs, value });
    while (entries.size > limit) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }

  function clear() {
    entries.clear();
    hits = 0;
    misses = 0;
  }

  function stats() {
    return { size: entries.size, limit, hits, misses };
  }

  return { get, set, clear, stats };
}

module.exports = { createMetaCache, DEFAULT_MAX_ENTRIES };
