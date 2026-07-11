const express = require('express');
const router = express.Router();
const imageService = require('../services/image');

// Serve original image
// GET /api/image/view?path=<base64 encoded path>
router.get('/view', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    if (!encodedPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const filePath = Buffer.from(encodedPath, 'base64url').toString('utf-8');
    await imageService.serveFile(filePath, res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (err.status === 403 || err.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    console.error('Image serve error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get thumbnail
// GET /api/image/thumbnail?path=<base64 encoded path>&size=256&fit=cover
router.get('/thumbnail', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    const size = parseInt(req.query.size) || 256;
    const fit = req.query.fit || 'cover'; // 'cover' or 'inside'

    if (!encodedPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const filePath = Buffer.from(encodedPath, 'base64url').toString('utf-8');
    await imageService.serveThumbnail(filePath, size, fit, res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'File not found' });
    }
    if (err.status === 403 || err.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    console.error('Thumbnail error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
