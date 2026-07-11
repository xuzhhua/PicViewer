const path = require('path');
const fs = require('fs');

const DATA_FILE = path.join(__dirname, '..', 'data', 'folders.json');
const IGNORED_FILE = path.join(__dirname, '..', 'data', 'ignored_folders.json');

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
      return [];
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    console.error('Error reading folders.json:', e.message);
    return [];
  }
}

function writeData(data) {
  const tmpFile = DATA_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
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
