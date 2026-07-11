const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { readIgnored, writeIgnored } = require('../data/store');

// Format a path for display: normalize slashes and check existence
function formatPath(p) {
  const normalized = path.normalize(p);
  try {
    const stat = fs.statSync(normalized);
    return {
      id: Buffer.from(normalized).toString('base64url'),
      path: normalized,
      name: path.basename(normalized) || normalized,
      exists: true,
      isDirectory: stat.isDirectory()
    };
  } catch (_) {
    return {
      id: Buffer.from(normalized).toString('base64url'),
      path: normalized,
      name: path.basename(normalized) || normalized,
      exists: false,
      isDirectory: false
    };
  }
}

// List all ignored folders
router.get('/', (req, res) => {
  const ignored = readIgnored();
  res.json(ignored.map(e => formatPath(e.path)));
});

// Add a folder to ignore list
router.post('/', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) {
    return res.status(400).json({ error: 'Path is required' });
  }

  const normalized = path.normalize(folderPath);
  const ignored = readIgnored();

  // Check duplicates
  if (ignored.some(i => path.normalize(i.path) === normalized)) {
    return res.status(409).json({ error: 'Path already ignored' });
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    path: normalized,
    addedAt: new Date().toISOString()
  };

  ignored.push(entry);
  writeIgnored(ignored);
  res.status(201).json(formatPath(normalized));
});

// Remove a folder from ignore list
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  let ignored = readIgnored();
  const target = ignored.find(i => formatPath(i.path).id === id);
  if (!target) {
    // Also try matching by stored id
    const byStoredId = ignored.find(i => i.id === id);
    if (!byStoredId) {
      return res.status(404).json({ error: 'Ignored folder not found' });
    }
    ignored = ignored.filter(i => i.id !== id);
  } else {
    ignored = ignored.filter(i => formatPath(i.path).id !== id);
  }

  writeIgnored(ignored);
  res.json({ success: true });
});

module.exports = router;
