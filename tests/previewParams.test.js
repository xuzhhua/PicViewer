const test = require('node:test');
const assert = require('node:assert');
const { clampPreviewEdge } = require('../server/utils/previewParams');

test('clampPreviewEdge: 缺省 / 非法值回落到 1920', () => {
  assert.strictEqual(clampPreviewEdge(undefined), 1920);
  assert.strictEqual(clampPreviewEdge(null), 1920);
  assert.strictEqual(clampPreviewEdge(''), 1920);
  assert.strictEqual(clampPreviewEdge('abc'), 1920);
  assert.strictEqual(clampPreviewEdge('0'), 1920);
  assert.strictEqual(clampPreviewEdge('-100'), 1920);
  assert.strictEqual(clampPreviewEdge(NaN), 1920);
});

test('clampPreviewEdge: 低于下限夹到 320', () => {
  assert.strictEqual(clampPreviewEdge('100'), 320);
  assert.strictEqual(clampPreviewEdge(320), 320);
});

test('clampPreviewEdge: 正常值原样返回（字符串也认）', () => {
  assert.strictEqual(clampPreviewEdge('1920'), 1920);
  assert.strictEqual(clampPreviewEdge('2560'), 2560);
  assert.strictEqual(clampPreviewEdge(2000), 2000);
  // 小数按整数截断
  assert.strictEqual(clampPreviewEdge('2560.9'), 2560);
});

test('clampPreviewEdge: 超过上限夹到 4096', () => {
  assert.strictEqual(clampPreviewEdge('99999'), 4096);
  assert.strictEqual(clampPreviewEdge(8192), 4096);
});
