const express = require('express');
const router = express.Router();
const path = require('path');
const archiver = require('archiver');
const { readData } = require('../data/store');

// Batch download selected files as ZIP
// GET /api/download?paths=<base64,csv>
router.get('/', async (req, res) => {
  try {
    const encoded = req.query.paths;
    if (!encoded) {
      return res.status(400).json({ error: 'Paths are required' });
    }

    const paths = encoded.split(',').map(p => {
      try {
        return Buffer.from(p, 'base64').toString('utf-8');
      } catch (e) { return p; }
    });

    // Security: verify all paths are within allowed folders
    const rootFolders = readData();
    for (const filePath of paths) {
      const normalized = path.normalize(filePath);
      const allowed = rootFolders.some(root => {
        const rootNorm = path.normalize(root.path);
        return normalized.startsWith(rootNorm);
      });
      if (!allowed) {
        return res.status(403).json({ error: `Path not allowed: ${filePath}` });
      }
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="picviewer-download.zip"');

    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.pipe(res);

    for (const filePath of paths) {
      const name = path.basename(filePath);
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
});

module.exports = router;
