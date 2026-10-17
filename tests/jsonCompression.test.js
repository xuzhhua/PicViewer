const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { jsonCompression, weakEtag, etagMatches, MIN_GZIP_BYTES } = require('../server/middleware/jsonCompression');

/**
 * 最小化的 req/res 桩：中间件只用到 headers/method 和
 * setHeader/removeHeader/end/statusCode。
 */
function fakeRes() {
  const headers = {};
  const res = {
    headers,
    statusCode: 200,
    chunks: [],
    finished: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(Buffer.from(chunk));
      this.finished = true;
      if (this.onFinish) this.onFinish();
    },
  };
  return res;
}

/** 跑一次中间件 + res.json，返回结束后的 res（必要时等 gzip 异步回调） */
function run(body, { headers = {}, method = 'GET' } = {}) {
  const req = { headers, method };
  const res = fakeRes();
  jsonCompression()(req, res, () => {});
  return new Promise((resolve, reject) => {
    res.onFinish = () => resolve(res);
    try {
      res.json(body);
    } catch (err) {
      reject(err);
    }
  });
}

const bigBody = { images: Array.from({ length: 40 }, (_, i) => ({ path: `X:\\photos\\IMG_${i}.jpg`, size: 4_000_000, modified: '2026-10-17T00:00:00.000Z' })) };

test('weakEtag: 相同内容产生相同 tag，不同内容不同', () => {
  assert.strictEqual(weakEtag(Buffer.from('abc')), weakEtag(Buffer.from('abc')));
  assert.notStrictEqual(weakEtag(Buffer.from('abc')), weakEtag(Buffer.from('abd')));
  assert.match(weakEtag(Buffer.from('abc')), /^W\/"[0-9a-f]+-.+"$/);
});

test('etagMatches: 忽略空白、支持列表与通配符', () => {
  assert.strictEqual(etagMatches(undefined, 'x'), false);
  assert.strictEqual(etagMatches('x', 'x'), true);
  assert.strictEqual(etagMatches('"a", x', 'x'), true);
  assert.strictEqual(etagMatches('*', 'x'), true);
  assert.strictEqual(etagMatches('y', 'x'), false);
});

test('大响应 + 支持 gzip：回压缩内容，解压后与原 JSON 一致', async () => {
  const res = await run(bigBody, { headers: { 'accept-encoding': 'gzip, deflate, br' } });
  assert.strictEqual(res.headers['content-encoding'], 'gzip');
  assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.strictEqual(res.headers['vary'], 'Accept-Encoding');
  assert.ok(res.headers.etag);
  assert.ok(Number(res.headers['content-length']) > 0);
  const plain = zlib.gunzipSync(Buffer.concat(res.chunks));
  assert.deepStrictEqual(JSON.parse(plain.toString('utf-8')), bigBody);
  assert.ok(Number(res.headers['content-length']) < Buffer.byteLength(JSON.stringify(bigBody)) / 4);
});

test('不支持 gzip 的客户端拿明文', async () => {
  const res = await run(bigBody, { headers: {} });
  assert.strictEqual(res.headers['content-encoding'], undefined);
  assert.deepStrictEqual(JSON.parse(Buffer.concat(res.chunks).toString('utf-8')), bigBody);
});

test('小响应不压缩（省得比省下的还多）', async () => {
  const res = await run({ ok: true }, { headers: { 'accept-encoding': 'gzip' } });
  assert.strictEqual(res.headers['content-encoding'], undefined);
  assert.strictEqual(Number(res.headers['content-length']), Buffer.byteLength('{"ok":true}'));
  assert.ok(Buffer.byteLength('{"ok":true}') < MIN_GZIP_BYTES);
});

test('同一份内容再请求：命中 ETag 回 304 且没有响应体', async () => {
  const plain = Buffer.from(JSON.stringify(bigBody));
  const etag = weakEtag(plain);
  const res = await run(bigBody, { headers: { 'accept-encoding': 'gzip', 'if-none-match': etag } });
  assert.strictEqual(res.statusCode, 304);
  assert.strictEqual(res.headers['content-encoding'], undefined);
  assert.strictEqual(res.headers['content-length'], undefined);
  assert.strictEqual(res.chunks.length, 0);
});

test('内容变了（ETag 不匹配）仍然完整回包', async () => {
  const res = await run(bigBody, { headers: { 'accept-encoding': 'gzip', 'if-none-match': '"stale"' } });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.headers['content-encoding'], 'gzip');
  assert.ok(res.chunks.length > 0);
});

test('HEAD 请求只回头不回来体', async () => {
  const res = await run(bigBody, { method: 'HEAD', headers: { 'accept-encoding': 'gzip' } });
  assert.strictEqual(res.headers['content-encoding'], undefined);
  assert.strictEqual(Number(res.headers['content-length']), Buffer.byteLength(JSON.stringify(bigBody)));
  assert.strictEqual(res.chunks.length, 0);
});

test('非序列化内容回退到 express 默认实现（不抛错）', async () => {
  const req = { headers: {}, method: 'GET' };
  const res = fakeRes();
  let fallbackCalled = false;
  res.json = () => { fallbackCalled = true; return res; };
  jsonCompression()(req, res, () => {});
  res.json(undefined); // JSON.stringify(undefined) === undefined → Buffer.from 抛错
  assert.strictEqual(fallbackCalled, true);
});
