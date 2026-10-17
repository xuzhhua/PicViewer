const express = require('express');
const router = express.Router();
const { readData, writeData, readIgnored } = require('../data/store');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { FAVORITES_FILE } = require('../paths');
const { isPathAllowed } = require('../security/pathGuard');
const { sendError } = require('../utils/respond');

const FAV_FILE = FAVORITES_FILE;

// 支持「旋转」的图片格式（动图/矢量图转了也没意义）
const ROTATABLE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tiff', '.tif', '.bmp']);

/** 解码 base64url 路径并校验落在某个根目录内 */
function decodeAllowedPath(encodedPath) {
  const filePath = Buffer.from(encodedPath, 'base64url').toString('utf-8');
  if (!isPathAllowed(filePath)) {
    return { error: Object.assign(new Error('路径不在允许的根目录内'), { status: 403 }) };
  }
  return { filePath };
}

function readFavorites() {
  try {
    if (!require('fs').existsSync(FAV_FILE)) {
      require('fs').writeFileSync(FAV_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(require('fs').readFileSync(FAV_FILE, 'utf-8'));
  } catch (e) { return []; }
}
function writeFavorites(data) {
  const tmp = FAV_FILE + '.tmp';
  require('fs').writeFileSync(tmp, JSON.stringify(data, null, 2));
  require('fs').renameSync(tmp, FAV_FILE);
}

router.get('/', (req, res) => res.json(readFavorites()));

router.post('/', (req, res) => {
  const { name, path: filePath, type } = req.body;
  if (!name || !filePath) return res.status(400).json({ error: 'name and path required' });
  const favs = readFavorites();
  if (favs.some(f => f.path === filePath)) return res.status(409).json({ error: 'Already favorited' });
  const entry = { id: Date.now().toString(36) + Math.random().toString(36).slice(2,6), name, path: filePath, type: type || 'image', addedAt: new Date().toISOString() };
  favs.push(entry);
  writeFavorites(favs);
  res.status(201).json(entry);
});

router.delete('/:id', (req, res) => {
  let favs = readFavorites();
  const before = favs.length;
  favs = favs.filter(f => f.id !== req.params.id);
  if (favs.length === before) return res.status(404).json({ error: 'Not found' });
  writeFavorites(favs);
  res.json({ success: true });
});

// Get preview images for a folder (first N images)
router.get('/folder-preview', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    if (!encodedPath) return res.status(400).json({ error: 'path required' });
    const decoded = decodeAllowedPath(encodedPath);
    if (decoded.error) return sendError(res, 403, '路径不在允许的根目录内');
    const dirPath = decoded.filePath;
    // count 上下都要夹：负数/0 会让循环一次都不跑，给个合理下限
    const requested = parseInt(req.query.count, 10);
    const count = Math.min(Math.max(Number.isFinite(requested) ? requested : 4, 1), 9);

    const IMG = new Set(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.avif']);
    const ignoredList = readIgnored();
    const previews = [];
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
        if (e.isDirectory()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (!IMG.has(ext)) continue;
        previews.push(path.join(dirPath, e.name));
        if (previews.length >= count) break;
      }
    } catch (_) {}
    res.json({ path: dirPath, previews });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

// Rotate image via sharp
router.post('/rotate', async (req, res) => {
  try {
    const { path: filePath, degrees } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    // 以前这里完全不校验路径：任意路径（包括 C:\Windows\... 或系统盘任意文件）
    // 都会被 sharp 读出来并以图片形式返回，等于一个任意文件读取接口。
    if (!isPathAllowed(filePath)) return sendError(res, 403, '路径不在允许的根目录内');
    const ext = path.extname(filePath).toLowerCase();
    if (!ROTATABLE_EXTS.has(ext)) return sendError(res, 415, '该文件类型不支持旋转');
    // sharp.rotate() 只接受 90 的倍数
    const requested = parseInt(degrees, 10);
    const rot = Number.isFinite(requested) ? ((Math.round(requested / 90) * 90) % 360 + 360) % 360 : 90;
    const sharp = require('sharp');
    const rotated = await sharp(filePath).rotate(rot).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(rotated);
  } catch (err) {
    sendError(res, err.code === 'ENOENT' ? 404 : 500, err.message);
  }
});

// Open file in Explorer (Windows only)
router.post('/explorer', (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    if (!isPathAllowed(filePath)) return sendError(res, 403, '路径不在允许的根目录内');

    // 以前用 exec(`explorer /select,"${normalized}"`)：路径里一个双引号加 `& calc`
    // 就是一条命令执行（body 里 path 完全可控）。改成 spawn + 参数数组，不经过 shell。
    const normalized = path.normalize(filePath);
    if (!fsSync.existsSync(normalized)) return sendError(res, 404, '文件不存在');

    const { spawn } = require('child_process');
    // 注意：explorer.exe 需要把 `/select,` 和路径放在**同一个参数**里，它会自己
    // 解析逗号后面的整段作为路径；拆成两个参数时带空格的路径会失效。
    const child = spawn('explorer.exe', ['/select,' + normalized], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    // explorer.exe 即使成功也常返回非 0，不把退出码当失败
    child.on('error', (err) => {
      console.error('[Explorer] spawn failed:', err.message);
      sendError(res, 500, '无法打开资源管理器');
    });
    child.unref();
    res.json({ success: true });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

module.exports = router;
