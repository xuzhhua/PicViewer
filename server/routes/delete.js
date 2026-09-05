const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const trash = require('trash');
const { readData } = require('../data/store');

// Max files per delete request (aligns with download MAX_FILES)
const MAX_FILES = 200;
const FAV_FILE = path.join(__dirname, '..', 'data', 'favorites.json');

// Delete files by moving them to the system recycle bin (recoverable).
// POST /api/delete  body: { paths: [absolutePath, ...] }
router.post('/', async (req, res) => {
  try {
    const { paths } = req.body || {};
    if (!Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ error: 'paths is required' });
    }
    if (paths.length > MAX_FILES) {
      return res.status(400).json({ error: `Too many files (max ${MAX_FILES})` });
    }

    const rootFolders = readData();
    if (rootFolders.length === 0) {
      return res.status(403).json({ error: 'No configured root folders' });
    }

    // Security: every path must live under (not equal to) a configured root folder
    for (const rawPath of paths) {
      const normalized = path.normalize(rawPath);
      const rootMatch = rootFolders.find(root => {
        const rootNorm = path.normalize(root.path);
        return normalized === rootNorm || normalized.startsWith(rootNorm + path.sep);
      });
      if (!rootMatch) {
        return res.status(403).json({ error: `Path not allowed: ${rawPath}` });
      }
      // Never allow deleting one of the configured root folders themselves
      if (path.normalize(rootMatch.path) === normalized) {
        return res.status(400).json({ error: `Cannot delete configured root folder: ${rawPath}` });
      }
    }

    const deleted = [];
    const failed = [];
    for (const rawPath of paths) {
      const filePath = path.normalize(rawPath);
      try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
          failed.push({ path: rawPath, message: 'Not a file' });
          continue;
        }
        await trash(filePath);
        deleted.push(rawPath);
      } catch (e) {
        const message = e.code === 'ENOENT' ? 'File not found' : (e.message || 'Failed to move to recycle bin');
        failed.push({ path: rawPath, message });
      }
    }

    // Best-effort: drop dead favorites for successfully deleted paths
    if (deleted.length > 0) {
      try { cleanupFavorites(deleted); } catch (_) { /* ignore */ }
    }

    res.json({ deleted, failed });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Remove favorite entries whose file no longer exists (atomic tmp+rename write)
function cleanupFavorites(deletedPaths) {
  if (!fsSync.existsSync(FAV_FILE)) return;
  let favs;
  try {
    favs = JSON.parse(fsSync.readFileSync(FAV_FILE, 'utf-8'));
  } catch (e) { return; }
  if (!Array.isArray(favs)) return;

  const deletedSet = new Set(deletedPaths);
  const remaining = favs.filter(f => !deletedSet.has(f.path));
  if (remaining.length === favs.length) return;

  const tmp = FAV_FILE + '.tmp';
  fsSync.writeFileSync(tmp, JSON.stringify(remaining, null, 2));
  fsSync.renameSync(tmp, FAV_FILE);
}

module.exports = router;
