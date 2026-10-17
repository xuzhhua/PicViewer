/**
 * CORS 白名单（server/middleware/cors.js）单测。
 *
 * 之前等价于 `Access-Control-Allow-Origin: *`，配合「无鉴权 + 0.0.0.0」，
 * 任意网页都能驱动 /api/delete。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { createCors, isAllowedOrigin, DEFAULT_ALLOWED_HEADERS } = require('../server/middleware/cors');

function makeReq(overrides = {}) {
  return Object.assign(
    { method: 'GET', headers: {}, path: '/api/browse' },
    overrides,
    { headers: Object.assign({}, overrides.headers) }
  );
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { res.headers[String(key).toLowerCase()] = value; },
    status(code) { res.statusCode = code; return res; },
    end() { res.ended = true; return res; },
  };
  return res;
}

function run(middleware, req) {
  const res = makeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { nextCalled, res };
}

const LAN_OPTS = { lan: true, lanIPs: ['192.168.1.5'] };

test('没有 Origin（Electron/curl/同源 img）→ 放行且不设 ACAO', () => {
  const result = run(createCors(() => ({})), makeReq());
  assert.equal(result.nextCalled, true);
  assert.equal(result.res.headers['access-control-allow-origin'], undefined);
});

test('Origin 与本请求 Host 相同 → 放行并回显 Origin', () => {
  const result = run(createCors(() => ({})), makeReq({
    headers: { host: '192.168.1.5:18093', origin: 'http://192.168.1.5:18093' },
  }));
  assert.equal(result.nextCalled, true);
  assert.equal(result.res.headers['access-control-allow-origin'], 'http://192.168.1.5:18093');
  assert.equal(result.res.headers.vary, 'Origin');
  assert.equal(result.res.headers['access-control-allow-headers'], DEFAULT_ALLOWED_HEADERS);
});

test('本机回环来源（Vite 5173 / 本机工具）→ 放行', () => {
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']) {
    const result = run(createCors(() => ({})), makeReq({ headers: { host: 'localhost:18093', origin } }));
    assert.equal(result.nextCalled, true, origin);
    assert.equal(result.res.headers['access-control-allow-origin'], origin, origin);
  }
});

test('任意外部站点 → 不设 ACAO；预检直接 403', () => {
  const middleware = createCors(() => ({}));
  const getResult = run(middleware, makeReq({ headers: { host: 'localhost:18093', origin: 'https://evil.example' } }));
  assert.equal(getResult.nextCalled, true); // 只读页面照常执行，但浏览器读不到响应
  assert.equal(getResult.res.headers['access-control-allow-origin'], undefined);

  const preflight = run(middleware, makeReq({
    method: 'OPTIONS',
    headers: { host: 'localhost:18093', origin: 'https://evil.example' },
  }));
  assert.equal(preflight.nextCalled, false);
  assert.equal(preflight.res.statusCode, 403);
});

test('非法 Origin / 空字符串按拒绝处理', () => {
  assert.equal(isAllowedOrigin('not a url', makeReq(), {}), false);
  assert.equal(isAllowedOrigin('null', makeReq(), {}), false);
  assert.equal(isAllowedOrigin(undefined, makeReq(), {}), true);
});

test('默认（未开启局域网访问）不认局域网 IP 来源', () => {
  const result = run(createCors(() => ({})), makeReq({
    headers: { host: '127.0.0.1:18093', origin: 'http://192.168.1.5:18093' },
  }));
  assert.equal(result.res.headers['access-control-allow-origin'], undefined);
});

test('开启局域网访问后，本机局域网 IP 来源放行', () => {
  const result = run(createCors(() => LAN_OPTS), makeReq({
    headers: { host: '192.168.1.5:18093', origin: 'http://192.168.1.5:18093' },
  }));
  assert.equal(result.res.headers['access-control-allow-origin'], 'http://192.168.1.5:18093');

  const otherIP = run(createCors(() => LAN_OPTS), makeReq({
    headers: { host: '192.168.1.5:18093', origin: 'http://192.168.1.99:18093' },
  }));
  assert.equal(otherIP.res.headers['access-control-allow-origin'], undefined);
});

test('同源预检（没有 Origin）→ 204', () => {
  const result = run(createCors(() => ({})), makeReq({ method: 'OPTIONS' }));
  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 204);
});

test('反向代理后：Origin 与 X-Forwarded-Host 相同 → 放行', () => {
  // 代理常把 Host 改写成 127.0.0.1:port，浏览器看到的页面来源却是 https://pics.example.com
  const result = run(createCors(() => ({})), makeReq({
    headers: {
      host: '127.0.0.1:18093',
      'x-forwarded-host': 'pics.example.com',
      origin: 'https://pics.example.com',
    },
  }));
  assert.equal(result.res.headers['access-control-allow-origin'], 'https://pics.example.com');
});

test('X-Forwarded-Host 带端口/多值时取第一段并去端口', () => {
  const result = run(createCors(() => ({})), makeReq({
    headers: {
      host: '127.0.0.1:18093',
      'x-forwarded-host': 'pics.example.com:8443, proxy.internal',
      origin: 'https://pics.example.com:8443',
    },
  }));
  assert.equal(result.res.headers['access-control-allow-origin'], 'https://pics.example.com:8443');
});
