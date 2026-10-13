const fs = require('fs');
const { DATA_DIR, FOLDERS_FILE, IGNORED_FILE, ensureDir } = require('../paths');

// The directory must exist before the first write — in a packaged app it lives
// outside app.asar and is created on demand.
ensureDir(DATA_DIR);

function readData() {
  try {
    if (!fs.existsSync(FOLDERS_FILE)) {
      fs.writeFileSync(FOLDERS_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error reading folders.json:', e.message);
    return [];
  }
}

function writeData(data) {
  const tmpFile = FOLDERS_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, FOLDERS_FILE);
}

// --- Ignored folders ---

function readIgnored() {
  try {
    if (!fs.existsSync(IGNORED_FILE)) {
      fs.writeFileSync(IGNORED_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(IGNORED_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error reading ignored_folders.json:', e.message);
    return [];
  }
}

function writeIgnored(data) {
  const tmpFile = IGNORED_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, IGNORED_FILE);
}

module.exports = { readData, writeData, readIgnored, writeIgnored };
