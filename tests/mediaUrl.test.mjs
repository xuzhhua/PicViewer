import test from 'node:test';
import assert from 'node:assert';
import { mediaVersion } from '../client/src/utils/mediaUrl.js';

test('mediaVersion: 缺信息时返回空串（URL 不加参数）', () => {
  assert.strictEqual(mediaVersion(), '');
  assert.strictEqual(mediaVersion(null), '');
  assert.strictEqual(mediaVersion({}), '');
  assert.strictEqual(mediaVersion({ path: 'D:\\Pics\\a.jpg' }), '');
});

test('mediaVersion: 大小 + 修改时间拼成版本号', () => {
  const item = { path: 'D:\\Pics\\a.jpg', size: 3842048, modified: '2025-02-17T10:00:00.123Z' };
  const ms = new Date(item.modified).getTime();
  assert.strictEqual(mediaVersion(item), `${ms}-3842048`);
});

test('回归：同名文件被替换后版本号必须变化', () => {
  const before = { path: 'D:\\Pics\\a.jpg', size: 3842048, modified: '2025-02-17T10:00:00.000Z' };
  // 最常见的替换方式：新文件是旧时间戳（相机/压缩包/网络盘拷来的）
  const replacedOlder = { path: 'D:\\Pics\\a.jpg', size: 1234567, modified: '2020-01-01T00:00:00.000Z' };
  // 同尺寸覆盖（只有 mtime 变）
  const replacedSameSize = { path: 'D:\\Pics\\a.jpg', size: 3842048, modified: '2025-02-18T10:00:00.000Z' };
  assert.notStrictEqual(mediaVersion(before), mediaVersion(replacedOlder));
  assert.notStrictEqual(mediaVersion(before), mediaVersion(replacedSameSize));
  // 同一份文件重复调用必须稳定，否则每帧都换 URL，浏览器缓存彻底失效
  assert.strictEqual(mediaVersion(before), mediaVersion({ ...before }));
});

test('mediaVersion: 只有部分字段时也不产生空版本号', () => {
  const onlySize = mediaVersion({ path: 'a.jpg', size: 10 });
  const onlyTime = mediaVersion({ path: 'a.jpg', modified: '2025-02-17T00:00:00.000Z' });
  assert.notStrictEqual(onlySize, '');
  assert.notStrictEqual(onlyTime, '');
  assert.notStrictEqual(onlySize, onlyTime);
});

test('mediaVersion: modified 不是合法日期时退化成原始字符串（仍然稳定）', () => {
  const item = { path: 'a.jpg', size: 10, modified: 'not-a-date' };
  assert.strictEqual(mediaVersion(item), 'not-a-date-10');
});
