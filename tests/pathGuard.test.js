/**
 * 路径白名单判定（server/security/pathGuard.js）单测。
 * 这套判定是「任意文件读取」的唯一防线，边界必须钉死。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const {
  normalizePath,
  stripTrailingSep,
  isWithin,
  isPathAllowed,
  isIgnored,
  validateRootCandidate,
} = require('../server/security/pathGuard');

const BASE = path.join(os.tmpdir(), 'picviewer-guard-test');
const ROOT_A = path.join(BASE, 'rootA');
const ROOT_B = path.join(BASE, 'rootB');
const ROOTS = [{ path: ROOT_A }, { path: ROOT_B }];

test('根目录自身与子路径都算允许', () => {
  assert.equal(isPathAllowed(ROOT_A, ROOTS), true);
  assert.equal(isPathAllowed(path.join(ROOT_A, 'a.jpg'), ROOTS), true);
  assert.equal(isPathAllowed(path.join(ROOT_A, 'sub', 'deep', 'b.png'), ROOTS), true);
});

test('前缀相同的兄弟目录不算允许（D:\\Pics 不能匹配 D:\\Pics2）', () => {
  const evil = path.join(BASE, 'rootA-evil', 'x.jpg');
  assert.equal(isPathAllowed(evil, ROOTS), false);
  assert.equal(isWithin(ROOT_A, evil), false);
});

test('用 ../ 逃出根目录会被 normalize 挡下', () => {
  const escape = path.join(ROOT_A, '..', '..', 'Windows', 'System32', 'secret.txt');
  assert.equal(isPathAllowed(escape, ROOTS), false);
  const inner = path.join(ROOT_A, 'sub', '..', 'ok.jpg');
  assert.equal(isPathAllowed(inner, ROOTS), true);
});

test('尾部路径分隔符不影响判定', () => {
  assert.equal(isPathAllowed(ROOT_A + path.sep, ROOTS), true);
  assert.equal(isWithin(ROOT_A + path.sep, path.join(ROOT_A, 'a.jpg')), true);
  assert.equal(stripTrailingSep(ROOT_A + path.sep), ROOT_A);
});

test('空根目录列表 / 空目标一律拒绝（fail-closed）', () => {
  assert.equal(isPathAllowed(ROOT_A, []), false);
  assert.equal(isPathAllowed(ROOT_A, undefined && []), false);
  assert.equal(isPathAllowed('', ROOTS), false);
  assert.equal(isPathAllowed(ROOT_A, [{ path: '' }]), false);
  assert.equal(isWithin('', ''), false);
});

test('Windows 下大小写不敏感', () => {
  if (process.platform !== 'win32') return;
  assert.equal(isWithin('C:\\Pics', 'c:\\pics\\a.jpg'), true);
  assert.equal(isPathAllowed('d:\\pics\\A.JPG', [{ path: 'D:\\Pics' }]), true);
});

test('正斜杠/反斜杠混写会被 normalize 归一', () => {
  const mixed = ROOT_A.replace(/\\/g, '/') + '/a.jpg';
  assert.equal(isPathAllowed(mixed, ROOTS), true);
});

test('isIgnored 覆盖自身与子树，但不连带兄弟目录', () => {
  const ignored = [{ path: path.join(BASE, 'private') }];
  assert.equal(isIgnored(path.join(BASE, 'private'), ignored), true);
  assert.equal(isIgnored(path.join(BASE, 'private', 'deep', 'x.jpg'), ignored), true);
  assert.equal(isIgnored(path.join(BASE, 'private2', 'x.jpg'), ignored), false);
  assert.equal(isIgnored(path.join(BASE, 'private', 'x.jpg'), []), false);
  assert.equal(isIgnored(path.join(BASE, 'private', 'x.jpg'), undefined), false);
});

test('normalizePath 对非字符串返回空串', () => {
  assert.equal(normalizePath(null), '');
  assert.equal(normalizePath(undefined), '');
  assert.equal(normalizePath(''), '');
  assert.equal(normalizePath(ROOT_A), path.normalize(ROOT_A));
});

// —— 新增根目录的合法性 ——

test('任何磁盘根目录都不能当根目录', () => {
  const driveRoot = path.parse(BASE).root; // Windows: D:\  POSIX: /
  const result = validateRootCandidate(driveRoot);
  assert.equal(result.ok, false);
  assert.match(result.reason, /根目录/);
});

test('系统目录不能当根目录', () => {
  if (process.platform !== 'win32') return;
  for (const dir of ['C:\\Windows', 'C:\\Windows\\System32', 'C:\\Program Files\\foo']) {
    const result = validateRootCandidate(dir);
    assert.equal(result.ok, false, `${dir} 应被拒绝`);
  }
});

test('相对路径、空路径、含 NUL 的路径被拒绝', () => {
  assert.equal(validateRootCandidate('').ok, false);
  assert.equal(validateRootCandidate('   ').ok, false);
  assert.equal(validateRootCandidate('relative\\dir').ok, false);
  assert.equal(validateRootCandidate(ROOT_A + '\u0000evil').ok, false);
});

test('不存在的路径与「不是文件夹」的路径被拒绝', () => {
  const missing = path.join(BASE, 'definitely-missing-xyz');
  const missingResult = validateRootCandidate(missing);
  assert.equal(missingResult.ok, false);
  assert.match(missingResult.reason, /不存在/);

  fs.mkdirSync(BASE, { recursive: true });
  const filePath = path.join(BASE, 'a-file.txt');
  fs.writeFileSync(filePath, 'x');
  try {
    const fileResult = validateRootCandidate(filePath);
    assert.equal(fileResult.ok, false);
    assert.match(fileResult.reason, /不是文件夹/);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
});

test('正常文件夹通过校验并返回规范化的绝对路径', () => {
  fs.mkdirSync(ROOT_A, { recursive: true });
  try {
    const result = validateRootCandidate(ROOT_A + path.sep);
    assert.equal(result.ok, true);
    assert.equal(result.path, path.normalize(ROOT_A));
  } finally {
    fs.rmSync(ROOT_A, { recursive: true, force: true });
  }
});
