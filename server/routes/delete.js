const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const trash = require('trash');
const { readData } = require('../data/store');
const cache = require('../services/cache');
const { FAVORITES_FILE } = require('../paths');

// Max files per delete request (aligns with download MAX_FILES)
const MAX_FILES = 200;
const FAV_FILE = FAVORITES_FILE;

// Delete files by moving them to the system recycle bin (recoverable).
// POST /api/delete  body: { paths: [absolutePath, ...], permanent?: boolean }
//
// Network/mapped locations have no Recycle Bin on Windows, so trash() cannot
// handle them. Those paths come back in `needsPermanent` instead of failing, and
// the client asks for an explicit confirmation before re-requesting them with
// `permanent: true` (irreversible fs.unlink).
router.post('/', async (req, res) => {
  try {
    const { paths, permanent = false } = req.body || {};
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
    // Files that exist but cannot be recycled; the client must confirm a
    // permanent delete before we touch them again.
    const needsPermanent = [];
    for (const rawPath of paths) {
      const filePath = path.normalize(rawPath);

      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch (e) {
        const message = e.code === 'ENOENT' ? 'File not found' : (e.message || 'Failed to access file');
        failed.push({ path: rawPath, message });
        continue;
      }
      if (!stat.isFile()) {
        failed.push({ path: rawPath, message: 'Not a file' });
        continue;
      }

      // Permanent delete — only reached after the user explicitly confirmed that
      // the file cannot be recovered from the Recycle Bin.
      if (permanent) {
        try {
          await fs.unlink(filePath);
          deleted.push(rawPath);
        } catch (e) {
          failed.push({ path: rawPath, message: e.message || 'Failed to delete file' });
        }
        continue;
      }

      try {
        await trash(filePath);
        deleted.push(rawPath);
      } catch (e) {
        // trash() only throws here because the location is not recyclable.
        needsPermanent.push(rawPath);
      }
    }

    // Best-effort: drop dead favorites and cached artifacts for deleted paths
    if (deleted.length > 0) {
      try { cleanupFavorites(deleted); } catch (_) { /* ignore */ }
      try { await cache.removeSourcesCache(deleted); } catch (_) { /* ignore */ }
    }

    res.json({ deleted, failed, needsPermanent });
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
