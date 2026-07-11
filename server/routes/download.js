const express = require('express');
const router = express.Router();
const path = require('path');
const archiver = require('archiver');
const { readData } = require('../data/store');

// Batch download selected files as ZIP
// GET or POST /api/download?paths=<base64,csv> or POST body { paths: [...] }
const MAX_FILES = 200;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB

router.get('/', handleDownload);
router.post('/', handleDownload);

async function handleDownload(req, res) {
  try {
    // Support both GET query and POST body
    let encoded;
    if (req.method === 'POST' && req.body && req.body.paths) {
      encoded = Array.isArray(req.body.paths) ? req.body.paths.join(',') : req.body.paths;
    } else {
      encoded = req.query.paths;
    }

    if (!encoded) {
      return res.status(400).json({ error: 'Paths are required' });
    }

    const paths = encoded.split(',').map(p => {
      try {
        return Buffer.from(p, 'base64').toString('utf-8');
      } catch (e) { return p; }
    });

    // Limit check
    if (paths.length > MAX_FILES) {
      return res.status(400).json({ error: `Too many files (max ${MAX_FILES})` });
    }

    // Security: verify all paths are within allowed folders
    const rootFolders = readData();
    for (const filePath of paths) {
      const normalized = path.normalize(filePath);
      const allowed = rootFolders.some(root => {
        const rootNorm = path.normalize(root.path);
        return normalized === rootNorm || normalized.startsWith(rootNorm + path.sep);
      });
      if (!allowed) {
        return res.status(403).json({ error: `Path not allowed: ${filePath}` });
      }
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="picviewer-download.zip"');

    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.pipe(res);

    // Deduplicate filenames by adding parent folder prefix
    const usedNames = new Map();
    for (const filePath of paths) {
      let name = path.basename(filePath);
      const count = usedNames.get(name) || 0;
      usedNames.set(name, count + 1);
      if (count > 0) {
        const parent = path.basename(path.dirname(filePath));
        name = `${parent}_${name}`;
        const parentCount = usedNames.get(name) || 0;
        usedNames.set(name, parentCount + 1);
        if (parentCount > 0) {
          name = `${parent}_${parentCount}_${path.basename(filePath)}`;
        }
      }
      try {
        archive.file(filePath, { name });
      } catch (e) {
        // Skip files that can't be read
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = router;
