const express = require('express');
const router = express.Router();
const { readData, writeData, readIgnored } = require('../data/store');
const fs = require('fs').promises;
const path = require('path');

const FAV_FILE = path.join(__dirname, '..', 'data', 'favorites.json');

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
    const dirPath = Buffer.from(encodedPath, 'base64url').toString('utf-8');
    const count = Math.min(parseInt(req.query.count) || 4, 9);

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
    res.status(500).json({ error: err.message });
  }
});

// Rotate image via sharp
router.post('/rotate', async (req, res) => {
  try {
    const { path: filePath, degrees } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const rot = parseInt(degrees) || 90;
    const sharp = require('sharp');
    const rotated = await sharp(filePath).rotate(rot).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(rotated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Open file in Explorer (Windows only)
router.post('/explorer', (req, res) => {
  try {
    const { path: filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'path required' });
    const { exec } = require('child_process');
    const normalized = path.normalize(filePath);
    exec(`explorer /select,"${normalized}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
