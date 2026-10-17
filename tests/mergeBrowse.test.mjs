import test from 'node:test';
import assert from 'node:assert';
import { mergeBrowseData, mergeMediaItems } from '../client/src/utils/mergeBrowse.js';

const img = (name, extra = {}) => ({ name, path: `X:\\photos\\${name}`, type: 'image', size: 100, modified: '2026-01-01T00:00:00.000Z', ...extra });
const dirView = (images, extra = {}) => ({ path: 'X:\\photos', name: 'photos', folders: [], images, videos: [], ...extra });

test('returns null when nothing changed (no pointless re-render)', () => {
  const a = dirView([img('a.jpg'), img('b.jpg')]);
  assert.strictEqual(mergeBrowseData(a, dirView([img('a.jpg'), img('b.jpg')])), null);
});

test('keeps the previous object identity for unchanged files', () => {
  const a = dirView([img('a.jpg'), img('b.jpg')]);
  const result = mergeBrowseData(a, dirView([img('a.jpg'), img('b.jpg'), img('c.jpg')]));
  assert.ok(result);
  assert.deepStrictEqual(result.added, ['X:\\photos\\c.jpg']);
  assert.strictEqual(result.data.images[0], a.images[0], 'unchanged item must keep its reference');
  assert.strictEqual(result.data.images[1], a.images[1]);
  assert.strictEqual(result.data.images.length, 3);
});

test('detects a new file inserted in the middle and reports it', () => {
  const a = dirView([img('a.jpg'), img('c.jpg')]);
  const result = mergeBrowseData(a, dirView([img('a.jpg'), img('b.jpg'), img('c.jpg')]));
  assert.deepStrictEqual(result.added, ['X:\\photos\\b.jpg']);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.data.images.map(i => i.name), ['a.jpg', 'b.jpg', 'c.jpg']);
});

test('drops files that disappeared and reports them', () => {
  const a = dirView([img('a.jpg'), img('b.jpg'), img('c.jpg')]);
  const result = mergeBrowseData(a, dirView([img('a.jpg'), img('c.jpg')]));
  assert.deepStrictEqual(result.removed, ['X:\\photos\\b.jpg']);
  assert.deepStrictEqual(result.data.images.map(i => i.name), ['a.jpg', 'c.jpg']);
});

test('refreshes metadata when a file changed in place', () => {
  const a = dirView([img('a.jpg')]);
  const result = mergeBrowseData(a, dirView([img('a.jpg', { size: 999 })]));
  assert.ok(result, 'a changed size is a real change');
  assert.strictEqual(result.data.images[0].size, 999);
  assert.notStrictEqual(result.data.images[0], a.images[0]);
});

test('refuses to merge across directories, searches or mode changes', () => {
  const a = dirView([img('a.jpg')]);
  assert.strictEqual(mergeBrowseData(a, dirView([img('a.jpg')], { path: 'X:\\other' })), null);
  assert.strictEqual(mergeBrowseData(a, { ...dirView([img('a.jpg')]), isSearch: true }), null);
  assert.strictEqual(mergeBrowseData({ ...a, recursive: true }, dirView([img('a.jpg')])), null);
});

test('seeds from scratch when there is no previous view', () => {
  const next = dirView([img('a.jpg')]);
  assert.deepStrictEqual(mergeBrowseData(null, next).data, next);
  assert.strictEqual(mergeBrowseData(null, null), null);
});

test('picks up new sub-folders and the total count', () => {
  const a = dirView([img('a.jpg')], { total: 10 });
  const result = mergeBrowseData(a, dirView([img('a.jpg')], { total: 11, folders: [{ name: 'sub', path: 'X:\\photos\\sub' }] }));
  assert.deepStrictEqual(result.data.folders, [{ name: 'sub', path: 'X:\\photos\\sub' }]);
  assert.strictEqual(result.data.total, 11);
});

test('merges videos independently of images', () => {
  const video = (name) => ({ name, path: `X:\\photos\\${name}`, type: 'video', size: 5, modified: '2026-01-01T00:00:00.000Z' });
  const prev = { path: 'X:\\photos', folders: [], images: [img('a.jpg')], videos: [] };
  const result = mergeBrowseData(prev, { path: 'X:\\photos', folders: [], images: [img('a.jpg')], videos: [video('v.mp4')] });
  assert.deepStrictEqual(result.added, ['X:\\photos\\v.mp4']);
  assert.strictEqual(result.data.images, prev.images, 'images array untouched');
});

test('mergeMediaItems keeps the old array when the contents are identical', () => {
  const list = [img('a.jpg'), img('b.jpg')];
  assert.strictEqual(mergeMediaItems(list, [img('a.jpg'), img('b.jpg')]), list);
  assert.strictEqual(mergeMediaItems(undefined, list), list);
  assert.deepStrictEqual(mergeMediaItems(undefined, undefined), []);
});
