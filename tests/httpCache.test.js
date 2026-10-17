const test = require('node:test');
const assert = require('node:assert');
const { makeEtag, isFresh, applyFreshness } = require('../server/utils/httpCache');

function fakeRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    ended: false,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    end() { this.ended = true; },
  };
}

function statOf(mtimeMs, size) {
  return { mtimeMs, size, mtime: new Date(mtimeMs) };
}

test('makeEtag: mtime 或 size 变化都会换 tag', () => {
  const a = makeEtag(statOf(1000, 10));
  const b = makeEtag(statOf(2000, 10));
  const c = makeEtag(statOf(1000, 11));
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a, c);
  assert.strictEqual(a, makeEtag(statOf(1000, 10)));
});

test('isFresh: 没有条件请求头时永远不是 fresh', () => {
  assert.strictEqual(isFresh({ headers: {} }, statOf(1000, 10)), false);
  assert.strictEqual(isFresh({}, statOf(1000, 10)), false);
});

test('isFresh: If-None-Match 命中 / 未命中 / 逗号列表 / 通配符', () => {
  const stat = statOf(1000, 10);
  const etag = makeEtag(stat);
  assert.strictEqual(isFresh({ headers: { 'if-none-match': etag } }, stat), true);
  assert.strictEqual(isFresh({ headers: { 'if-none-match': '"nope"' } }, stat), false);
  assert.strictEqual(isFresh({ headers: { 'if-none-match': `"nope", ${etag}` } }, stat), true);
  assert.strictEqual(isFresh({ headers: { 'if-none-match': '*' } }, stat), true);
});

test('isFresh: If-None-Match 优先于 If-Modified-Since', () => {
  const stat = statOf(1000, 10);
  const headers = {
    'if-none-match': '"stale"',
    'if-modified-since': new Date(5000).toUTCString(),
  };
  // ETag 明确不匹配 → 不管 IMS 说什么都必须重传
  assert.strictEqual(isFresh({ headers }, stat), false);
});

test('isFresh: If-Modified-Since 比 mtime 旧 / 新', () => {
  const stat = statOf(10_000, 10);
  const older = new Date(9_000).toUTCString();
  const newer = new Date(20_000).toUTCString();
  assert.strictEqual(isFresh({ headers: { 'if-modified-since': older } }, stat), false);
  assert.strictEqual(isFresh({ headers: { 'if-modified-since': newer } }, stat), true);
  assert.strictEqual(isFresh({ headers: { 'if-modified-since': 'not-a-date' } }, stat), false);
});

test('applyFreshness: 无缓存头时写入 ETag/Last-Modified/Cache-Control 且不结束响应', () => {
  const res = fakeRes();
  const hit = applyFreshness({ headers: {} }, res, statOf(1000, 10), 'public, max-age=60');
  assert.strictEqual(hit, false);
  assert.strictEqual(res.ended, false);
  assert.ok(res.headers.etag);
  assert.ok(res.headers['last-modified']);
  assert.strictEqual(res.headers['cache-control'], 'public, max-age=60');
});

test('applyFreshness: 命中条件请求时回 304 并结束响应', () => {
  const stat = statOf(1000, 10);
  const etag = makeEtag(stat);
  const res = fakeRes();
  res.setHeader('Content-Length', 123);
  const hit = applyFreshness({ headers: { 'if-none-match': etag } }, res, stat, 'public, max-age=60');
  assert.strictEqual(hit, true);
  assert.strictEqual(res.statusCode, 304);
  assert.strictEqual(res.ended, true);
  assert.strictEqual(res.headers['content-length'], undefined);
});

test('applyFreshness: cacheControl 省略时不写 Cache-Control', () => {
  const res = fakeRes();
  applyFreshness({ headers: {} }, res, statOf(1000, 10));
  assert.strictEqual(res.headers['cache-control'], undefined);
});
