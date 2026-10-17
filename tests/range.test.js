/**
 * HTTP Range 解析（server/utils/range.js）单测。
 * 旧实现把 `bytes=-500` 解析成 start=NaN → Content-Length: NaN → 500 崩溃。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRange, MAX_CHUNK_BYTES } = require('../server/utils/range');

test('没有 Range 头 → none', () => {
  assert.deepEqual(parseRange(undefined, 1000), { type: 'none' });
  assert.deepEqual(parseRange('', 1000), { type: 'none' });
  assert.deepEqual(parseRange('   ', 1000), { type: 'none' });
});

test('size 非法 → none', () => {
  assert.deepEqual(parseRange('bytes=0-10', 0), { type: 'none' });
  assert.deepEqual(parseRange('bytes=0-10', -1), { type: 'none' });
  assert.deepEqual(parseRange('bytes=0-10', NaN), { type: 'none' });
});

test('普通闭区间', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { type: 'partial', start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=500-999', 1000), { type: 'partial', start: 500, end: 999 });
});

test('开区间按 5MB 一块，不一次回整个文件', () => {
  const size = 20 * 1024 * 1024;
  assert.deepEqual(parseRange('bytes=0-', size), {
    type: 'partial',
    start: 0,
    end: MAX_CHUNK_BYTES - 1,
  });
  assert.deepEqual(parseRange(`bytes=${size - 10}-`, size), {
    type: 'partial',
    start: size - 10,
    end: size - 1,
  });
});

test('后缀区间 bytes=-500（旧实现这里 NaN 崩 500）', () => {
  assert.deepEqual(parseRange('bytes=-500', 1000), { type: 'partial', start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-500', 100), { type: 'partial', start: 0, end: 99 });
});

test('起点越界 → unsatisfiable（调用方应回 416）', () => {
  assert.deepEqual(parseRange('bytes=1000-', 1000), { type: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=999999-', 1000), { type: 'unsatisfiable' });
});

test('结束位置越界会被夹紧而不是回负数', () => {
  assert.deepEqual(parseRange('bytes=0-9999', 1000), { type: 'partial', start: 0, end: 999 });
});

test('非法格式 → none（忽略 Range，回整份 200）', () => {
  assert.deepEqual(parseRange('bytes=abc', 1000), { type: 'none' });
  assert.deepEqual(parseRange('bytes=50-10', 1000), { type: 'none' });
  assert.deepEqual(parseRange('items=0-10', 1000), { type: 'none' });
  assert.deepEqual(parseRange('bytes=--', 1000), { type: 'none' });
  assert.deepEqual(parseRange('bytes=-0', 1000), { type: 'none' });
});

test('多段 Range 只满足第一段', () => {
  assert.deepEqual(parseRange('bytes=0-10,20-30', 1000), { type: 'partial', start: 0, end: 10 });
});

test('大小写与空白不影响解析', () => {
  assert.deepEqual(parseRange(' BYTES=0-10 ', 1000), { type: 'partial', start: 0, end: 10 });
});
