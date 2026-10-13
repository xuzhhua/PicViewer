// Single source of truth for where mutable, runtime state lives.
//
// All of it is written at runtime: thumbnail/transcode cache, the root-folder
// list, favorites, ignored folders and the config file. Running from source
// (`npm start`, start.bat) everything stays under `server/` exactly as before.
//
// A packaged Electron app is different: its code lives inside app.asar, which is
// READ-ONLY. Writing the cache or folders.json in there fails — silently
// degrading thumbnails to placeholders and making "add folder" fail with a 500.
// electron-main.js therefore points PICVIEWER_DATA_DIR at a writable directory
// (app.getPath('userData')) before the server is loaded.

const fs = require('fs');
const path = require('path');

const SERVER_DIR = __dirname;
const BUNDLED_CONFIG = path.join(SERVER_DIR, 'config.json');

// Default to server/ so running from source is byte-for-byte the previous behaviour.
const STATE_ROOT = process.env.PICVIEWER_DATA_DIR
  ? path.resolve(process.env.PICVIEWER_DATA_DIR)
  : SERVER_DIR;

const CACHE_DIR = path.join(STATE_ROOT, 'cache');
const THUMBNAILS_DIR = path.join(CACHE_DIR, 'thumbnails');
const TRANSCODES_DIR = path.join(CACHE_DIR, 'transcodes');
const REGISTRY_FILE = path.join(CACHE_DIR, 'sources.jsonl');

const DATA_DIR = path.join(STATE_ROOT, 'data');
const FOLDERS_FILE = path.join(DATA_DIR, 'folders.json');
const IGNORED_FILE = path.join(DATA_DIR, 'ignored_folders.json');
const FAVORITES_FILE = path.join(DATA_DIR, 'favorites.json');

const CONFIG_FILE = path.join(STATE_ROOT, 'config.json');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read the live config, seeding it from the bundled default on first run.
 *
 * The bundled config lives inside the read-only asar in a packaged app, so the
 * user could never edit it there; copying it out once gives them a real file.
 * Returns {} when no config is available at all (callers apply their defaults).
 */
function readConfig() {
  if (CONFIG_FILE !== BUNDLED_CONFIG && !fs.existsSync(CONFIG_FILE)) {
    try {
      ensureDir(STATE_ROOT);
      fs.copyFileSync(BUNDLED_CONFIG, CONFIG_FILE);
    } catch (_) { /* no bundled default to seed from */ }
  }
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch (_) { /* malformed config — fall back to defaults */ }
  return {};
}

module.exports = {
  SERVER_DIR,
  BUNDLED_CONFIG,
  STATE_ROOT,
  CACHE_DIR,
  THUMBNAILS_DIR,
  TRANSCODES_DIR,
  REGISTRY_FILE,
  DATA_DIR,
  FOLDERS_FILE,
  IGNORED_FILE,
  FAVORITES_FILE,
  CONFIG_FILE,
  ensureDir,
  readConfig
};
