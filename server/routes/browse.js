const express = require('express');
const router = express.Router();
const browseService = require('../services/browse');

// Browse directory contents
// GET /api/browse?path=<base64 encoded path>
router.get('/', async (req, res) => {
  try {
    const encodedPath = req.query.path || '';
    const details = req.query.details === '1';
    let dirPath = '';

    if (encodedPath) {
      dirPath = Buffer.from(encodedPath, 'base64url').toString('utf-8');
    }

    const result = await browseService.listDirectory(dirPath, { details });
    res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Directory not found' });
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    console.error('Browse error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
