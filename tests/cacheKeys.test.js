const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  pathHash,
  sourceFingerprint,
  thumbnailName,
  previewName,
  transcodeName,
  THUMB_RE,
  TRANSCODE_RE,
  PREVIEW_RE
} = require('../server/utils/cacheKey');

const SRC = 'D:\\Pics\\a.jpg';
const STAT = { mtimeMs: 1739790000123, size: 3842048 };

test('sourceFingerprint: mtime(取整) + 体积', () => {
  assert.strictEqual(sourceFingerprint(STAT), '1739790000123-3842048');
  assert.strictEqual(sourceFingerprint({ mtimeMs: 12.6, size: 7 }), '13-7');
  // 拿不到 stat 时退化成 0-0（调用方永远会传，这里只是不允许产生 NaN）
  assert.strictEqual(sourceFingerprint(), '0-0');
  assert.strictEqual(sourceFingerprint({}), '0-0');
  assert.strictEqual(sourceFingerprint({ mtimeMs: NaN, size: NaN }), '0-0');
});

test('缩略图文件名带指纹，且能被 sweep 的正则识别', () => {
  const name = thumbnailName(SRC, 300, 'cover', STAT);
  assert.match(name, /__300__cover__1739790000123-3842048\.jpg$/);
  assert.match(name, THUMB_RE);
  // 带 .broken 标记也要能被识别（否则会被 sweep 当成垃圾删掉）
  assert.match(name + '.broken', THUMB_RE);
});

test('回归：同名文件被替换（mtime 更旧）也换新 key', () => {
  // 这就是本次要修的 bug：缓存原先靠 `cacheStat.mtime > fileStat.mtime` 判过期，
  // 新文件 mtime 更旧时会永远命中旧缓存。
  const before = thumbnailName(SRC, 300, 'cover', { mtimeMs: 1739790000123, size: 3842048 });
  const replaced = thumbnailName(SRC, 300, 'cover', { mtimeMs: 1600000000000, size: 1234567 });
  assert.notStrictEqual(before, replaced);
  // 三个维度任一变化都必须换 key
  assert.notStrictEqual(
    thumbnailName(SRC, 300, 'cover', STAT),
    thumbnailName(SRC, 300, 'inside', STAT)
  );
  assert.notStrictEqual(
    thumbnailName(SRC, 300, 'cover', STAT),
    thumbnailName(SRC, 300, 'cover', { mtimeMs: STAT.mtimeMs, size: STAT.size + 1 })
  );
  // 同样的 stat / 尺寸 / 模式 → 同一个 key（缓存才能命中）
  assert.strictEqual(
    thumbnailName(SRC, 300, 'cover', { mtimeMs: STAT.mtimeMs, size: STAT.size }),
    thumbnailName(SRC, 300, 'cover', STAT)
  );
});

test('旧命名（无指纹）不再匹配，会被 sweep 回收', () => {
  assert.doesNotMatch('0123456789abcdef0123456789abcdef__300__cover.jpg', THUMB_RE);
  assert.doesNotMatch('0123456789abcdef0123456789abcdef__1920__jpg', PREVIEW_RE);
  assert.doesNotMatch('0123456789abcdef0123456789abcdef.jpg', THUMB_RE);
});

test('预览图文件名：格式参与命名，非法格式回落 jpg', () => {
  const jpg = previewName(SRC, 1920, 'jpg', STAT);
  const webp = previewName(SRC, 1920, 'webp', STAT);
  assert.match(jpg, /__1920__jpg__1739790000123-3842048$/);
  assert.match(webp, /__1920__webp__1739790000123-3842048$/);
  assert.notStrictEqual(jpg, webp);
  assert.match(jpg, PREVIEW_RE);
  assert.match(webp + '.broken', PREVIEW_RE);
  assert.match(previewName(SRC, 1920, 'gif', STAT), /__1920__jpg__/);
  // 不同最大边长是不同缓存
  assert.notStrictEqual(previewName(SRC, 1920, 'jpg', STAT), previewName(SRC, 2560, 'jpg', STAT));
});

test('转码缓存仍按 mtime 命名（大写 mtime 不会被取整出错）', () => {
  const name = transcodeName(SRC, STAT.mtimeMs);
  assert.match(name, /__1739790000123\.mp4$/);
  assert.match(name, TRANSCODE_RE);
  assert.strictEqual(transcodeName(SRC, undefined), pathHash(SRC) + '__0.mp4');
});

test('pathHash 对等价写法稳定（分隔符/尾分隔/..）', () => {
  const base = pathHash('D:\\Pics\\a.jpg');
  assert.strictEqual(pathHash('D:\\Pics\\a.jpg'), base);
  assert.strictEqual(pathHash('D:/Pics/a.jpg'), pathHash(path.normalize('D:/Pics/a.jpg')));
  assert.strictEqual(pathHash('D:\\Pics\\sub\\..\\a.jpg'), base);
  assert.notStrictEqual(pathHash('D:\\Pics\\b.jpg'), base);
  // 文件名里永远只有 32 位 md5 + 受控片段（不会有路径分隔符混进来）
  assert.doesNotMatch(thumbnailName(SRC, 300, 'cover', STAT), /[\\/]/);
  assert.doesNotMatch(previewName(SRC, 1920, 'jpg', STAT), /[\\/]/);
});
