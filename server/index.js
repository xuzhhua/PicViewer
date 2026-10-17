const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');

const foldersRouter = require('./routes/folders');
const browseRouter = require('./routes/browse');
const imageRouter = require('./routes/image');
const downloadRouter = require('./routes/download');
const ignoredRouter = require('./routes/ignored');
const searchRouter = require('./routes/search');
const actionsRouter = require('./routes/actions');
const deleteRouter = require('./routes/delete');
const cache = require('./services/cache');
const { DATA_DIR, readConfig } = require('./paths');
const { jsonCompression } = require('./middleware/jsonCompression');
const { createCors } = require('./middleware/cors');
const { createAuthMiddleware, getOrCreateToken, isLoopbackRequest } = require('./security/auth');

const app = express();
app.disable('x-powered-by');

// 运行时状态：监听地址、是否开了局域网访问、令牌。请求中间件每帧读这里，
// 因为 startServer() 可能在模块加载之后才被调用（Electron 就是这么用的）。
const runtime = {
  host: '127.0.0.1',
  lan: false,
  lanIPs: [],
  token: null,
  port: null,
};

function isLoopbackHost(host) {
  const h = String(host || '').toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

// Read port from config file (env var > config > default)
function getPort() {
  if (process.env.PORT) return parseInt(process.env.PORT, 10);
  const config = readConfig();
  if (config.port) return config.port;
  return 3456;
}

/**
 * 决定监听地址与是否开启令牌鉴权。
 *
 * 默认只监听 127.0.0.1：照片库是个人的，把端口开到 0.0.0.0 又不鉴权等于把
 * 整个磁盘的读删权限交给同网段的任何设备（以及用户浏览器里的任意恶意页面）。
 *
 * 需要手机/远程访问时，在 config.json 里设 `"lanAccess": true`（或环境变量
 * PICVIEWER_LAN=1），此时监听 0.0.0.0 并自动生成/复用访问令牌。
 * 只要监听地址不是回环地址，就一定开鉴权 —— 不允许「暴露监听 + 无鉴权」的组合。
 */
function getServerOptions() {
  const config = readConfig();
  const envLan = process.env.PICVIEWER_LAN;
  const lanByEnv = envLan === undefined ? null : /^(1|true|yes|on)$/i.test(String(envLan).trim());
  const lanRequested = lanByEnv === null ? !!config.lanAccess : lanByEnv;
  const host = process.env.PICVIEWER_HOST || config.host || (lanRequested ? '0.0.0.0' : '127.0.0.1');
  return { host, lan: lanRequested || !isLoopbackHost(host) };
}

function getLocalIPs() {
  const { networkInterfaces } = os;
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

// —— 中间件 ——
// CORS 收窄：只放行本服务自己的页面与本机工具（见 middleware/cors.js）
app.use(createCors(() => ({ lan: runtime.lan, lanIPs: runtime.lanIPs })));
// 局域网模式下非本机请求必须带令牌（见 security/auth.js）
app.use(createAuthMiddleware(() => runtime.token));
app.use(express.json({ limit: '1mb' }));
// JSON 响应 gzip + ETag/304（远程访问时目录列表的流量大头）
app.use(jsonCompression());

// API routes
app.use('/api/folders', foldersRouter);
app.use('/api/browse', browseRouter);
app.use('/api/image', imageRouter);
app.use('/api/download', downloadRouter);
app.use('/api/ignored', ignoredRouter);
app.use('/api/search', searchRouter);
app.use('/api/actions', actionsRouter);
app.use('/api/delete', deleteRouter);

// Reclaim orphaned/stale cache in the background — never block startup on it.
cache.init().catch((e) => console.error('[Cache] init failed:', e.message));

// Serve React build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        // Service Worker 脚本必须每次都回源校验，否则新版本的发现会被延迟
        if (path.basename(filePath) === 'sw.js') {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  if (res.headersSent) {
    try { res.destroy(); } catch (_) {}
    return;
  }
  res.status(500).json({ error: err.message || 'Internal server error' });
});

/**
 * Start the HTTP server. Returns the http.Server instance.
 * @param {number} [port] - Port to listen on (default: from config or 3456)
 * @param {{host?: string, lan?: boolean}} [overrides] - 测试用
 * @returns {Promise<{ server: import('http').Server, port: number, host: string, lan: boolean, token: string|null }>}
 */
function startServer(port, overrides = {}) {
  const targetPort = port || getPort();
  const options = getServerOptions();
  const host = overrides.host || options.host;
  const lan = overrides.lan === undefined ? options.lan : !!overrides.lan;
  const MAX_RETRIES = 100;

  runtime.host = host;
  runtime.lan = lan;
  runtime.lanIPs = lan ? getLocalIPs() : [];
  runtime.token = lan ? getOrCreateToken(DATA_DIR) : null;

  const displayHost = isLoopbackHost(host) ? '127.0.0.1' : host;

  return new Promise((resolve, reject) => {
    function tryPort(p, attempts) {
      if (attempts >= MAX_RETRIES) {
        return reject(new Error(`Failed to find an available port after ${MAX_RETRIES} attempts`));
      }

      const server = app.listen(p, host, () => {
        runtime.port = p;
        console.log(`PicViewer running at http://${displayHost}:${p}`);
        if (lan) {
          const ips = runtime.lanIPs.length > 0 ? runtime.lanIPs : ['<本机局域网IP>'];
          for (const ip of ips) {
            console.log(`LAN access:  http://${ip}:${p}/?token=${runtime.token}`);
          }
          console.log('局域网访问已开启：非本机请求需要上面地址里的 token（已保存，重启不变）。');
        } else {
          console.log('局域网访问：已关闭（仅本机可访问）。需要手机/远程访问时，在 server/config.json 里设 "lanAccess": true 后重启。');
        }
        resolve({ server, port: p, host, lan, token: runtime.token });
      });

      // 远程/移动网络下，一张图一个 TCP 握手太贵。Node 默认 5 秒就断开空闲
      // 长连接，浏览时人一停顿连接就没了；这里放宽到 65 秒（要大于常见反向
      // 代理的 60 秒空闲超时，避免代理先断开导致的竞态）。
      server.keepAliveTimeout = 65 * 1000;
      server.headersTimeout = 66 * 1000;

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${p} is in use, trying ${p + 1}...`);
          tryPort(p + 1, attempts + 1);
        } else {
          reject(err);
        }
      });
    }

    tryPort(targetPort, 0);
  });
}

// —— 进程级兜底 ——
// 服务与 Electron 主进程共用同一个进程，所以这里的策略是「单次异常只记录，
// 不退出」：一个文件读一半被删、网络盘掉线，不该让整个应用闪退。但短时间
// 连续出现未捕获异常通常意味着状态已经坏了，这时退出让上层重启更安全。
let uncaughtCount = 0;
let uncaughtWindowStart = 0;
process.on('uncaughtException', (err) => {
  console.error('[Fatal] uncaughtException:', err && err.stack ? err.stack : err);
  const now = Date.now();
  if (now - uncaughtWindowStart > 10000) {
    uncaughtWindowStart = now;
    uncaughtCount = 0;
  }
  uncaughtCount += 1;
  if (uncaughtCount >= 5) {
    console.error('[Fatal] 10 秒内连续出现 5 次未捕获异常，退出进程');
    process.exit(1);
  }
});
process.on('unhandledRejection', (reason) => {
  console.error('[Fatal] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});

// Run standalone if called directly (not imported by Electron)
if (require.main === module) {
  startServer().catch((err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });
}

module.exports = { app, startServer, getPort, getServerOptions, isLoopbackRequest, runtime };
