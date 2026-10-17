/**
 * JSON 响应的 gzip + ETag 中间件。
 *
 * 为什么值得单独做：
 *  - 目录列表（`/api/browse?details=1`）在 200 张图时是几十~几百 KB；而列表
 *    现在每 5 秒自动刷新一次。远程访问时这部分流量不能忽视（gzip 通常压到
 *    1/8 ~ 1/10）。
 *  - 内容没变时（绝大多数轮询）回 304，客户端一个字节都不用收。
 *
 * 只接管 `res.json()`，图片/下载等流式响应完全不受影响。
 */
const zlib = require('zlib');
const crypto = require('crypto');

// 太小的响应压了不划算（gzip 头 + 压缩开销比省下的还多）
const MIN_GZIP_BYTES = 1024;

function weakEtag(buf) {
  const hash = crypto.createHash('sha1').update(buf).digest('base64');
  return `W/"${buf.length.toString(16)}-${hash}"`;
}

function etagMatches(header, etag) {
  if (!header) return false;
  return String(header)
    .split(',')
    .some((token) => {
      const t = token.trim();
      return t === '*' || t === etag;
    });
}

function jsonCompression() {
  return (req, res, next) => {
    const gzipSupported = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    // express 一定有 res.json；这里保留兜底是为了能在没有 express 的环境下直接跑单测
    const originalJson = typeof res.json === 'function' ? res.json.bind(res) : null;

    res.json = (body) => {
      let buf;
      try {
        buf = Buffer.from(JSON.stringify(body));
      } catch (err) {
        if (originalJson) return originalJson(body);
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        return res.end('{}');
      }

      const etag = weakEtag(buf);
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept-Encoding');

      if (etagMatches(req.headers['if-none-match'], etag)) {
        res.statusCode = 304;
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Type');
        return res.end();
      }

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (req.method === 'HEAD') {
        res.setHeader('Content-Length', buf.length);
        return res.end();
      }
      if (!gzipSupported || buf.length < MIN_GZIP_BYTES) {
        res.setHeader('Content-Length', buf.length);
        return res.end(buf);
      }

      zlib.gzip(buf, (err, gz) => {
        if (err) {
          res.setHeader('Content-Length', buf.length);
          return res.end(buf);
        }
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', gz.length);
        res.end(gz);
      });
      return res;
    };

    next();
  };
}

module.exports = { jsonCompression, weakEtag, etagMatches, MIN_GZIP_BYTES };
