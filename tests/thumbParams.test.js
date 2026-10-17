/**
 * 缩略图参数夹紧（server/utils/imageParams.js）单测。
 * size 曾经是 `parseInt(req.query.size) || 256` 直接进 sharp：一个
 * `size=20000` 就是 ~1.6GB 位图。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  THUMB_DEFAULT_SIZE,
  THUMB_MIN_SIZE,
  THUMB_MAX_SIZE,
  clampThumbSize,
  normalizeFit,
} = require('../server/utils/imageParams');

test('缺省/非法值回落到默认 256', () => {
  assert.equal(clampThumbSize(undefined), THUMB_DEFAULT_SIZE);
  assert.equal(clampThumbSize(null), THUMB_DEFAULT_SIZE);
  assert.equal(clampThumbSize(''), THUMB_DEFAULT_SIZE);
  assert.equal(clampThumbSize('abc'), THUMB_DEFAULT_SIZE);
  assert.equal(clampThumbSize(0), THUMB_DEFAULT_SIZE);
  assert.equal(clampThumbSize(-100), THUMB_DEFAULT_SIZE);
  assert.equal(clampThumbSize(NaN), THUMB_DEFAULT_SIZE);
});

test('过小的值抬到下限', () => {
  assert.equal(clampThumbSize(1), THUMB_MIN_SIZE);
  assert.equal(clampThumbSize('8'), THUMB_MIN_SIZE);
});

test('过大的值压到上限（挡 memoria bomb）', () => {
  assert.equal(clampThumbSize(20000), THUMB_MAX_SIZE);
  assert.equal(clampThumbSize('999999999'), THUMB_MAX_SIZE);
  assert.equal(clampThumbSize(Infinity), THUMB_DEFAULT_SIZE); // parseInt(Infinity) → NaN
});

test('正常值原样保留（含客户端真实档位）', () => {
  for (const size of [128, 150, 263, 375, 488, 600, 1800, 2048]) {
    assert.equal(clampThumbSize(size), size);
    assert.equal(clampThumbSize(String(size)), size);
  }
});

test('小数/带单位的字符串按 parseInt 截断', () => {
  assert.equal(clampThumbSize('263.9'), 263);
  assert.equal(clampThumbSize('375px'), 375);
});

test('fit 只认 cover / inside', () => {
  assert.equal(normalizeFit('cover'), 'cover');
  assert.equal(normalizeFit('inside'), 'inside');
  assert.equal(normalizeFit('INSIDE'), 'inside');
  assert.equal(normalizeFit(' Cover '), 'cover');
  assert.equal(normalizeFit('contain'), 'cover');
  assert.equal(normalizeFit(''), 'cover');
  assert.equal(normalizeFit(undefined), 'cover');
  assert.equal(normalizeFit(123), 'cover');
});
