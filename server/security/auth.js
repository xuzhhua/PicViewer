/**
 * 局域网/远程访问的令牌鉴权。
 *
 * 背景：服务默认只监听 127.0.0.1，本机访问不需要任何凭证（和以前一样）。
 * 一旦开启 `lanAccess`（手机、平板、远程访问），监听地址变成 0.0.0.0，
 * 此时任何能连上这个端口的人都能浏览/删除磁盘上的图片，因此非本机请求必须
 * 带上启动时生成的令牌。
 *
 * 令牌怎么传：
 *  - 浏览器地址栏：`http://<ip>:<port>/?token=<token>`（启动日志会直接打印完整
 *    地址，手机扫码/复制即可）。服务端校验通过后种一个 HttpOnly Cookie，
 *    之后页面里的 fetch 和 `<img>` 请求自动携带 —— 图片用的是普通 <img> 标签，
 *    没法加自定义请求头，这也是必须走 Cookie 的原因。
 *  - 脚本/curl：`X-PicViewer-Token: <token>` 请求头或 `?token=` 查询参数。
 *
 * 本机请求（连接来自 127.0.0.1 且 Host 是 localhost/127.0.0.1）直接放行：
 * Electron 窗口、本机浏览器、内部工具都不必折腾令牌。Host 必须同时是本机名，
 * 这样「同机反向代理转发公网流量」不会被误判成本机请求。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TOKEN_HEADER = 'x-picviewer-token';
const TOKEN_COOKIE = 'picviewer_token';
const TOKEN_FILE = 'security.json';
const TOKEN_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 天

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLoopbackAddress(address) {
  return !!address && LOOPBACK_ADDRESSES.has(String(address));
}

/** 从 Host 头里取出主机名（去掉端口，保留 IPv6 的方括号形式） */
function hostName(req) {
  const raw = String((req && req.headers && req.headers.host) || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end === -1 ? raw : raw.slice(0, end + 1);
  }
  return raw.split(':')[0];
}

/** 连接来自本机回环，且访问的就是本机地址 */
function isLoopbackRequest(req) {
  const socket = req && req.socket;
  if (!socket || !isLoopbackAddress(socket.remoteAddress)) return false;
  return LOOPBACK_HOSTS.has(hostName(req));
}

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch (_) {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * 读取（或首次生成）持久化令牌。
 * 持久化的意义：重启服务后手机上的书签还能用，不用每次重新抄地址。
 */
function getOrCreateToken(dataDir) {
  const file = path.join(dataDir, TOKEN_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (parsed && typeof parsed.token === 'string' && parsed.token.length >= 24) {
      return parsed.token;
    }
  } catch (_) { /* 首次运行或文件损坏，重新生成 */ }

  const token = crypto.randomBytes(24).toString('base64url');
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch (e) {
    console.warn('[Auth] 令牌无法写入磁盘，重启后会变化:', e.message);
  }
  return token;
}

function unauthorizedPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PicViewer · 需要访问令牌</title>
<style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
background:#0c0c0e;color:#e6e6e6;font:15px/1.7 system-ui,"Segoe UI",sans-serif}
main{max-width:34rem;padding:2rem}code{background:#1b1b20;padding:.15em .4em;border-radius:4px}
h1{font-size:1.15rem;margin:0 0 .8rem}</style></head><body><main>
<h1>需要访问令牌</h1>
<p>PicViewer 正在以「局域网访问模式」运行，非本机访问必须带上启动日志里打印的令牌地址。</p>
<p>请回到运行 PicViewer 的那台电脑，在启动日志里找到形如
<code>http://192.168.x.x:端口/?token=…</code> 的地址，用那个地址打开即可（会自动记住）。</p>
</main></body></html>`;
}

/**
 * @param {() => (string|null)} getToken 返回 null 表示当前未开启鉴权
 */
function createAuthMiddleware(getToken) {
  return function authMiddleware(req, res, next) {
    const token = typeof getToken === 'function' ? getToken() : getToken;
    if (!token) return next();
    if (isLoopbackRequest(req)) return next();

    const cookies = parseCookies(req.headers.cookie);
    const supplied =
      req.headers[TOKEN_HEADER] ||
      (req.query && typeof req.query.token === 'string' ? req.query.token : '') ||
      cookies[TOKEN_COOKIE] ||
      '';

    if (safeEqual(String(supplied), token)) {
      // 用 ?token= 打开页面时，顺手种 Cookie，后续 <img>/fetch 自动带上
      if (cookies[TOKEN_COOKIE] !== token) {
        res.setHeader(
          'Set-Cookie',
          `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_COOKIE_MAX_AGE}`
        );
      }
      return next();
    }

    res.setHeader('Cache-Control', 'no-store');
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: '需要访问令牌（unauthorized）' });
    }
    return res.status(401).type('html').send(unauthorizedPage());
  };
}

module.exports = {
  TOKEN_HEADER,
  TOKEN_COOKIE,
  TOKEN_FILE,
  isLoopbackAddress,
  isLoopbackRequest,
  hostName,
  parseCookies,
  safeEqual,
  getOrCreateToken,
  createAuthMiddleware,
};
