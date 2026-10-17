/**
 * 路径白名单 —— 全服务端唯一的判定入口。
 *
 * 以前 `isPathAllowed` 在 browse.js / image.js 各有一份拷贝，`download.js` 和
 * `delete.js` 里又各写了一遍内联版本。每新增一个路由都要记得再抄一遍，抄漏了
 * 就是一个「任意文件读取」洞（`/api/actions/rotate`、`/api/actions/folder-preview`
 * 就是这么漏掉的）。所有路径判定统一走这里。
 *
 * 设计要点：
 *  - 比较前先 `path.normalize`，并去掉尾部反斜杠（`D:\Pics\` 与 `D:\Pics` 必须等价）。
 *  - Windows 下路径大小写不敏感，比较时折叠大小写（否则 `d:\pics\a.jpg` 会被
 *    错误拒绝；拒绝是 fail-closed 不至于越权，但会给用户造成莫名其妙的 403）。
 *  - 子树判定必须带分隔符边界：`D:\Pics` 不能匹配 `D:\Pics2\x.jpg`。
 */
const path = require('path');
const fsSync = require('fs');

const IS_WIN = process.platform === 'win32';

function normalizePath(targetPath) {
  if (typeof targetPath !== 'string' || targetPath === '') return '';
  return path.normalize(targetPath);
}

/** 去掉尾部路径分隔符（盘根 `D:\` 变成 `D:`，便于统一比较） */
function stripTrailingSep(p) {
  if (!p) return '';
  if (p.length <= 1) return p;
  return p.replace(/[\\/]+$/, '');
}

function fold(p) {
  return IS_WIN ? p.toLowerCase() : p;
}

/** child 是否等于 parent 或位于 parent 之内 */
function isWithin(parent, child) {
  const p = stripTrailingSep(normalizePath(parent));
  const c = stripTrailingSep(normalizePath(child));
  if (!p || !c) return false;
  const pf = fold(p);
  const cf = fold(c);
  if (pf === cf) return true;
  const prefix = pf.endsWith(path.sep) ? pf : pf + path.sep;
  return cf.startsWith(prefix);
}

/**
 * 目标路径是否落在任意一个根目录内。
 * @param {string} targetPath
 * @param {Array<{path: string}>|string[]} [rootFolders] 省略时从 data/store 读取
 */
function isPathAllowed(targetPath, rootFolders) {
  let roots = rootFolders;
  if (!roots) {
    try {
      roots = require('../data/store').readData();
    } catch (_) {
      return false;
    }
  }
  if (!Array.isArray(roots) || roots.length === 0) return false;
  return roots.some((root) => isWithin(root && root.path, targetPath));
}

/** 路径（或其父链）是否在忽略列表里 */
function isIgnored(targetPath, ignoredList) {
  if (!Array.isArray(ignoredList) || ignoredList.length === 0) return false;
  return ignoredList.some((entry) => isWithin(entry && entry.path, targetPath));
}

// —— 新增根目录的合法性校验 ——
// 允许任意路径当根目录等于白名单形同虚设：一条 POST 就能把 C:\ 加进来。
const SYSTEM_DIR_CANDIDATES = ['SystemRoot', 'windir', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData'];

function getSystemDirs() {
  const dirs = [];
  for (const key of SYSTEM_DIR_CANDIDATES) {
    const value = process.env[key];
    if (value) dirs.push(value);
  }
  if (IS_WIN) {
    dirs.push('C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData');
  }
  return [...new Set(dirs)];
}

/**
 * 校验一个「要加为根目录」的路径是否可以接受。
 * @returns {{ok: true, path: string} | {ok: false, reason: string}}
 */
function validateRootCandidate(folderPath) {
  if (typeof folderPath !== 'string' || folderPath.trim() === '') {
    return { ok: false, reason: '路径不能为空' };
  }
  if (folderPath.includes('\u0000')) {
    return { ok: false, reason: '路径非法' };
  }
  if (!path.isAbsolute(folderPath)) {
    return { ok: false, reason: '必须使用绝对路径' };
  }

  // 盘根（D:\ 或 /）不能当根目录：等于把整块盘交出去。
  // 这里必须在去掉尾部反斜杠**之前**判断，否则 "D:\" 会被认成 "D:"。
  const normalizedWithSep = path.normalize(folderPath);
  const parsed = path.parse(normalizedWithSep);
  if (stripTrailingSep(normalizedWithSep) === stripTrailingSep(parsed.root)) {
    return { ok: false, reason: '不能把磁盘根目录添加为根目录' };
  }

  // 存进配置的路径不带尾部反斜杠，避免 "D:\Pics\" 与 "D:\Pics" 两个看起来不同的根
  const normalized = stripTrailingSep(normalizedWithSep);
  for (const sysDir of getSystemDirs()) {
    if (isWithin(sysDir, normalized)) {
      return { ok: false, reason: '不能添加系统目录' };
    }
  }

  let stat;
  try {
    stat = fsSync.statSync(normalized);
  } catch (_) {
    return { ok: false, reason: '路径不存在或无法访问' };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: '不是文件夹' };
  }
  return { ok: true, path: normalized };
}

module.exports = {
  normalizePath,
  stripTrailingSep,
  isWithin,
  isPathAllowed,
  isIgnored,
  validateRootCandidate,
};
