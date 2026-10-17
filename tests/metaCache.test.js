const test = require('node:test');
const assert = require('node:assert');
const { createMetaCache } = require('../server/utils/metaCache');

test('首次未命中，之后同样 size/mtime 命中', () => {
  const cache = createMetaCache();
  assert.strictEqual(cache.get('/a.jpg', 100, 1000), undefined);
  const value = { width: 800, height: 600, format: 'jpeg' };
  cache.set('/a.jpg', 100, 1000, value);
  assert.deepStrictEqual(cache.get('/a.jpg', 100, 1000), value);
  assert.deepStrictEqual(cache.stats(), { size: 1, limit: 20000, hits: 1, misses: 1 });
});

test('文件大小变化后失效（文件被覆盖）', () => {
  const cache = createMetaCache();
  cache.set('/a.jpg', 100, 1000, { width: 800 });
  assert.strictEqual(cache.get('/a.jpg', 200, 1000), undefined);
});

test('mtime 变化后失效（文件被修改但大小不变）', () => {
  const cache = createMetaCache();
  cache.set('/a.jpg', 100, 1000, { width: 800 });
  assert.strictEqual(cache.get('/a.jpg', 100, 2000), undefined);
});

test('不同路径互不影响', () => {
  const cache = createMetaCache();
  cache.set('/a.jpg', 100, 1000, { width: 800 });
  assert.strictEqual(cache.get('/b.jpg', 100, 1000), undefined);
});

test('超过上限时淘汰最久未使用的一项', () => {
  const cache = createMetaCache({ maxEntries: 3 });
  cache.set('/a', 1, 1, 'a');
  cache.set('/b', 1, 1, 'b');
  cache.set('/c', 1, 1, 'c');
  // 命中 a，让它变成「最近使用」，此时最久未用的是 b
  assert.strictEqual(cache.get('/a', 1, 1), 'a');
  cache.set('/d', 1, 1, 'd');
  assert.strictEqual(cache.stats().size, 3);
  assert.strictEqual(cache.get('/b', 1, 1), undefined, 'b 应被淘汰');
  assert.strictEqual(cache.get('/a', 1, 1), 'a', '刚命中的 a 应保留');
  assert.strictEqual(cache.get('/c', 1, 1), 'c');
  assert.strictEqual(cache.get('/d', 1, 1), 'd');
});

test('同一个 key 重复 set 不会让 size 增长', () => {
  const cache = createMetaCache({ maxEntries: 10 });
  cache.set('/a', 100, 1000, { width: 1 });
  cache.set('/a', 200, 2000, { width: 2 });
  assert.strictEqual(cache.stats().size, 1);
  assert.deepStrictEqual(cache.get('/a', 200, 2000), { width: 2 });
});

test('clear 清空并重置计数', () => {
  const cache = createMetaCache();
  cache.set('/a', 1, 1, {});
  cache.get('/a', 1, 1);
  cache.clear();
  assert.deepStrictEqual(cache.stats(), { size: 0, limit: 20000, hits: 0, misses: 0 });
});

test('maxEntries 非法时回落到默认值', () => {
  assert.strictEqual(createMetaCache({ maxEntries: 0 }).stats().limit, 20000);
  assert.strictEqual(createMetaCache({ maxEntries: -5 }).stats().limit, 20000);
  assert.strictEqual(createMetaCache({ maxEntries: NaN }).stats().limit, 20000);
});
