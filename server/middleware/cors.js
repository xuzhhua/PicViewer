/**
 * CORS：只放行「本服务自己的页面」和本机工具。
 *
 * 以前是 `app.use(cors())`，等价于 `Access-Control-Allow-Origin: *` —— 结合
 * 「无鉴权 + 监听 0.0.0.0」，用户浏览器里随便一个恶意页面就能对
 * `http://127.0.0.1:18093/api/delete` 发带 JSON body 的 POST（JSON 触发预检，
 * 而 `*` 让预检通过）删掉磁盘上的文件。
 *
 * 现在只有以下来源能通过预检 / 读到响应：
 *  - 没有 Origin 头：Electron、curl、同源 `<img>` 等非浏览器跨源场景
 *  - Origin 与本请求的 Host 相同（页面就是本服务提供的）
 *  - Origin 主机是本机回环名（`localhost` / `127.0.0.1` / `::1`）—— 开发时
 *    Vite 跑在 5173 端口，或者本机其它工具直接调 API
 *  - 开启局域网访问时：本机的局域网 IP
 *
 * 不放行时**不设置** `Access-Control-Allow-Origin`，浏览器自己会拦下响应读取
 * 和触发预检的非简单请求；这里对 OPTIONS 直接回 403 更直白。
 */
const { hostName } = require('../security/auth');

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DEFAULT_ALLOWED_HEADERS = 'Content-Type, X-PicViewer-Token';
const DEFAULT_ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

/**
 * @param {string|undefined} origin
 * @param {{ headers?: Record<string,string> }} req
 * @param {{ lan?: boolean, lanIPs?: string[] }} opts
 */
function isAllowedOrigin(origin, req, opts = {}) {
  if (!origin || origin === 'null') return !origin; // 没有 Origin：非跨源浏览器请求
  let parsed;
  try {
    parsed = new URL(origin);
  } catch (_) {
    return false;
  }
  const originHost = parsed.hostname.toLowerCase();

  const requestHost = hostName(req);
  if (requestHost && originHost === requestHost) return true;
  if (LOOPBACK_HOSTS.has(originHost)) return true;

  if (opts.lan) {
    const lanIPs = Array.isArray(opts.lanIPs) ? opts.lanIPs.map((ip) => String(ip).toLowerCase()) : [];
    if (lanIPs.includes(originHost)) return true;
  }
  return false;
}

/**
 * @param {() => ({lan?: boolean, lanIPs?: string[]})} getOptions
 */
function createCors(getOptions) {
  return function corsMiddleware(req, res, next) {
    const origin = req.headers.origin;
    const opts = typeof getOptions === 'function' ? getOptions() || {} : getOptions || {};

    if (origin && isAllowedOrigin(origin, req, opts)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', DEFAULT_ALLOWED_METHODS);
      res.setHeader('Access-Control-Allow-Headers', DEFAULT_ALLOWED_HEADERS);
      res.setHeader('Access-Control-Max-Age', '600');
    } else if (origin) {
      // 明确拒绝：不给 ACAO，预检也直接失败
      if (req.method === 'OPTIONS') return res.status(403).end();
      // 普通请求照常执行（GET 只读页面），但浏览器读不到响应
      return next();
    }

    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  };
}

module.exports = {
  createCors,
  isAllowedOrigin,
  DEFAULT_ALLOWED_HEADERS,
  DEFAULT_ALLOWED_METHODS,
};
