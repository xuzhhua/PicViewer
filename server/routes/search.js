const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { readData, readIgnored } = require('../data/store');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.svg', '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif'
]);
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'
]);

const MAX_RESULTS = 500;

// Check if a path is ignored
function isIgnoredBy(targetPath, ignoredList) {
  if (!ignoredList || ignoredList.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return ignoredList.some(entry => {
    const ignoredNorm = path.normalize(entry.path);
    return normalized === ignoredNorm || normalized.startsWith(ignoredNorm + path.sep);
  });
}

// GET /api/search?q=<query>
router.get('/', async (req, res) => {
  try {
    const query = (req.query.q || '').trim().toLowerCase();
    if (!query || query.length < 1) {
      return res.json({ query: '', images: [], videos: [], total: 0 });
    }

    const rootFolders = readData();
    const ignoredList = readIgnored();
    const images = [];
    const videos = [];

    async function walk(dirPath, rootPath, depth = 0) {
      if (depth > 6) return; // Don't go too deep
      if (images.length + videos.length >= MAX_RESULTS) return;

      let entries;
      try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
      } catch (e) {
        return;
      }

      for (const entry of entries) {
        if (images.length + videos.length >= MAX_RESULTS) return;
        if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;

        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          if (isIgnoredBy(fullPath, ignoredList)) continue;
          await walk(fullPath, rootPath, depth + 1);
        } else if (entry.isFile()) {
          const nameLower = entry.name.toLowerCase();
          if (!nameLower.includes(query)) continue;

          const ext = path.extname(entry.name).toLowerCase();
          const relDir = path.relative(rootPath, dirPath) || '.';

          try {
            const stat = await fs.stat(fullPath);
            const item = {
              name: entry.name,
              path: fullPath,
              folder: relDir,
              size: stat.size,
              modified: stat.mtime.toISOString()
            };

            if (IMAGE_EXTENSIONS.has(ext)) {
              images.push({ ...item, type: 'image' });
            } else if (VIDEO_EXTENSIONS.has(ext)) {
              videos.push({ ...item, type: 'video', format: ext.slice(1) });
            }
          } catch (e) { /* skip unreadable */ }
        }
      }
    }

    for (const root of rootFolders) {
      if (images.length + videos.length >= MAX_RESULTS) break;
      try {
        const stat = await fs.stat(root.path);
        if (stat.isDirectory()) {
          await walk(root.path, root.path);
        }
      } catch (e) { /* skip inaccessible roots */ }
    }

    images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    videos.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    res.json({
      query,
      images,
      videos,
      total: images.length + videos.length,
      truncated: images.length + videos.length >= MAX_RESULTS
    });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
