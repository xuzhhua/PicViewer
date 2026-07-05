const express = require('express');
const router = express.Router();
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readData, writeData } = require('../data/store');

// Open native folder picker and return selected path
router.post('/pick', (req, res) => {
  let tmpFile = null;
  try {
    // Write PS script to temp file to avoid quoting/escaping issues
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder to add to PicViewer'
$dialog.ShowNewFolderButton = $true
$dialog.RootFolder = 'MyComputer'
if ($dialog.ShowDialog() -eq 'OK') {
    $dialog.SelectedPath
}
`.trim();
    tmpFile = path.join(os.tmpdir(), `picviewer-pick-${Date.now()}.ps1`);
    fs.writeFileSync(tmpFile, psScript, 'utf-8');

    const result = execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { encoding: 'utf-8', timeout: 300000, windowsHide: true }
    ).trim();

    if (result) {
      res.json({ path: result });
    } else {
      res.json({ path: null, cancelled: true });
    }
  } catch (e) {
    console.error('Folder picker error:', e.message);
    res.json({ path: null, cancelled: true });
  } finally {
    if (tmpFile && fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }
  }
});

// List all configured root folders
router.get('/', (req, res) => {
  const folders = readData();
  res.json(folders);
});

// Add a new root folder
router.post('/', (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) {
    return res.status(400).json({ error: 'Path is required' });
  }

  const folders = readData();
  const existing = folders.find(f => f.path === folderPath);
  if (existing) {
    return res.status(409).json({ error: 'Folder already exists' });
  }

  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    path: folderPath,
    name: folderPath.split(/[/\\]/).pop() || folderPath,
    addedAt: new Date().toISOString()
  };

  folders.push(entry);
  writeData(folders);
  res.status(201).json(entry);
});

// Remove a root folder
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  let folders = readData();
  const before = folders.length;
  folders = folders.filter(f => f.id !== id);

  if (folders.length === before) {
    return res.status(404).json({ error: 'Folder not found' });
  }

  writeData(folders);
  res.json({ success: true });
});

module.exports = router;
