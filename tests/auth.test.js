/**
 * 令牌鉴权（server/security/auth.js）单测。
 *
 * 这里没有 express：中间件只用到 req.headers / req.socket.remoteAddress /
 * req.query / req.path 和 res.setHeader/status/json/type/send，所以用最小的
 * 假对象就能覆盖全部分支。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
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
} = require('../server/security/auth');

const TOKEN = 'test-token-0123456789abcdef';

function makeReq(overrides = {}) {
  return Object.assign(
    {
      method: 'GET',
      path: '/api/browse',
      headers: {},
      query: {},
      socket: { remoteAddress: '127.0.0.1' },
    },
    overrides,
    { headers: Object.assign({}, overrides.headers) }
  );
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader(key, value) {
      res.headers[String(key).toLowerCase()] = value;
    },
    getHeader(key) {
      return res.headers[String(key).toLowerCase()];
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
    type() {
      return res;
    },
    send(payload) {
      res.body = payload;
      return res;
    },
    end() {
      res.ended = true;
    },
  };
  return res;
}

/** 跑一遍中间件，返回 { nextCalled, res } */
function run(middleware, req) {
  const res = makeRes();
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { nextCalled, res };
}

test('isLoopbackAddress 只认回环地址', () => {
  for (const addr of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(addr), true, addr);
  }
  for (const addr of ['192.168.1.5', '10.0.0.2', '127.0.0.2', '', null, undefined]) {
    assert.equal(isLoopbackAddress(addr), false, String(addr));
  }
});

test('hostName 去端口、保留 IPv6 方括号', () => {
  assert.equal(hostName(makeReq({ headers: { host: 'localhost:18093' } })), 'localhost');
  assert.equal(hostName(makeReq({ headers: { host: '192.168.1.5:18093' } })), '192.168.1.5');
  assert.equal(hostName(makeReq({ headers: { host: '[::1]:18093' } })), '[::1]');
  assert.equal(hostName(makeReq({ headers: { host: 'LOCALHOST' } })), 'localhost');
  assert.equal(hostName(makeReq({ headers: {} })), '');
  assert.equal(hostName(null), '');
});

test('isLoopbackRequest 要求「回环地址 + 本机 Host」同时成立', () => {
  assert.equal(isLoopbackRequest(makeReq({ headers: { host: 'localhost:18093' } })), true);
  assert.equal(isLoopbackRequest(makeReq({ headers: { host: '127.0.0.1:18093' } })), true);
  // 连接来自回环、但 Host 是局域网 IP：这是「同机反代」场景，不能算本机
  assert.equal(isLoopbackRequest(makeReq({ headers: { host: '192.168.1.5:18093' } })), false);
  // 连接来自局域网、Host 伪装成 localhost：也不算
  assert.equal(isLoopbackRequest(makeReq({
    headers: { host: 'localhost:18093' },
    socket: { remoteAddress: '192.168.1.5' },
  })), false);
  // 没有 socket / Host
  assert.equal(isLoopbackRequest({ headers: {} }), false);
  assert.equal(isLoopbackRequest(null), false);
});

test('parseCookies 解析多个键值并容错', () => {
  const cookies = parseCookies(`${TOKEN_COOKIE}=abc; other=1`);
  // 故意用无原型对象（防 __proto__ 注入），所以不能跟字面量做 deepEqual
  assert.equal(Object.getPrototypeOf(cookies), null);
  assert.equal(cookies[TOKEN_COOKIE], 'abc');
  assert.equal(cookies.other, '1');
  assert.deepEqual(Object.keys(parseCookies('')), []);
  assert.deepEqual(Object.keys(parseCookies(null)), []);
  assert.deepEqual(Object.keys(parseCookies('broken')), []);
  assert.equal(parseCookies(`${TOKEN_COOKIE}=a%2Fb`)[TOKEN_COOKIE], 'a/b');
});

test('safeEqual 恒长比较', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual(null, 'abc'), false);
  assert.equal(safeEqual('abc', undefined), false);
});

test('未配置令牌时全部放行（默认的本机模式）', () => {
  const middleware = createAuthMiddleware(() => null);
  const lanReq = makeReq({ socket: { remoteAddress: '192.168.1.5' }, headers: { host: '192.168.1.5:18093' } });
  assert.equal(run(middleware, lanReq).nextCalled, true);
});

test('本机请求不需要令牌', () => {
  const middleware = createAuthMiddleware(() => TOKEN);
  const { nextCalled, res } = run(middleware, makeReq({ headers: { host: 'localhost:18093' } }));
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
});

test('局域网请求无令牌 → 401（/api 回 JSON，页面回 HTML）', () => {
  const middleware = createAuthMiddleware(() => TOKEN);
  const lan = () => makeReq({ socket: { remoteAddress: '192.168.1.5' }, headers: { host: '192.168.1.5:18093' } });

  const apiResult = run(middleware, lan());
  assert.equal(apiResult.nextCalled, false);
  assert.equal(apiResult.res.statusCode, 401);
  assert.match(apiResult.res.body.error, /令牌/);
  assert.equal(apiResult.res.headers['cache-control'], 'no-store');

  const pageReq = Object.assign(lan(), { path: '/' });
  const pageResult = run(middleware, pageReq);
  assert.equal(pageResult.res.statusCode, 401);
  assert.match(String(pageResult.res.body), /<!doctype html>/i);
});

test('令牌可以走请求头 / 查询参数 / Cookie，校验通过后种 Cookie', () => {
  const middleware = createAuthMiddleware(() => TOKEN);
  const lan = (extra = {}) => makeReq(Object.assign({
    socket: { remoteAddress: '192.168.1.5' },
    headers: { host: '192.168.1.5:18093' },
  }, extra));

  const viaHeader = run(middleware, lan({ headers: { host: '192.168.1.5:18093', [TOKEN_HEADER]: TOKEN } }));
  assert.equal(viaHeader.nextCalled, true);
  assert.match(viaHeader.res.headers['set-cookie'], /picviewer_token=/);

  const viaQuery = run(middleware, lan({ query: { token: TOKEN } }));
  assert.equal(viaQuery.nextCalled, true);
  assert.match(viaQuery.res.headers['set-cookie'], /HttpOnly/);

  const viaCookie = run(middleware, lan({ headers: { host: '192.168.1.5:18093', cookie: `${TOKEN_COOKIE}=${TOKEN}` } }));
  assert.equal(viaCookie.nextCalled, true);
  // 已经带着这个 Cookie，就不用重复种
  assert.equal(viaCookie.res.headers['set-cookie'], undefined);
});

test('错误令牌被拒绝（含长度不同、空值）', () => {
  const middleware = createAuthMiddleware(() => TOKEN);
  const lan = (extra = {}) => makeReq(Object.assign({
    socket: { remoteAddress: '192.168.1.5' },
    headers: { host: '192.168.1.5:18093' },
  }, extra));

  for (const supplied of ['wrong-token-wrong-token-wrong', '', 'test-token']) {
    const result = run(middleware, lan({ query: { token: supplied } }));
    assert.equal(result.nextCalled, false, supplied);
    assert.equal(result.res.statusCode, 401, supplied);
  }
});

test('getOrCreateToken 持久化：同目录多次读取拿到同一个令牌', () => {
  const dir = path.join(os.tmpdir(), `picviewer-token-test-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  try {
    const first = getOrCreateToken(dir);
    const second = getOrCreateToken(dir);
    assert.equal(typeof first, 'string');
    assert.ok(first.length >= 24);
    assert.equal(first, second);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, TOKEN_FILE), 'utf-8'));
    assert.equal(saved.token, first);
    assert.ok(saved.createdAt);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('令牌文件损坏时会重新生成', () => {
  const dir = path.join(os.tmpdir(), `picviewer-token-broken-${process.pid}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, TOKEN_FILE), '{not json');
  try {
    const token = getOrCreateToken(dir);
    assert.equal(typeof token, 'string');
    assert.ok(token.length >= 24);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
