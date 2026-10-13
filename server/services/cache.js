// Cache management for generated thumbnails and transcoded videos.
//
// On-disk layout (both dirs flat, one file per cached artifact):
//   cache/thumbnails/<md5(sourcePath)>__<size>__<fit>.jpg[.broken]
//   cache/transcodes/<md5(sourcePath)>__<mtimeMs>.mp4
//
// Every cache filename starts with md5(source path), so *all* artifacts of a
// given source file can be found (and dropped) by prefix. That is what makes the
// delete hook and the orphan sweep exact instead of guesswork — md5 is one-way,
// so without a shared prefix there is no way back from a cache file to its source.
//
// cache/sources.jsonl is an append-only registry of { h: md5(path), p: path }.
// It is the only mapping back to source paths, which lets the orphan sweep drop
// entries whose source vanished (deleted / renamed / moved / root removed)
// without re-scanning every configured root folder (which would be very slow
// over SMB). It is appended to per new source and compacted on startup.

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readData } = require('../data/store');
const {
  CACHE_DIR,
  THUMBNAILS_DIR,
  TRANSCODES_DIR,
  REGISTRY_FILE,
  ensureDir,
  readConfig
} = require('../paths');

const CACHE_ROOT = CACHE_DIR;
const THUMB_DIR = THUMBNAILS_DIR;
const TRANSCODE_DIR = TRANSCODES_DIR;

// New-scheme filenames. Anything that does not match is a leftover from the
// previous scheme (<hash>.jpg / <hash>.mp4), which can never be hit again and is
// therefore reclaimed by the sweep.
const THUMB_RE = /^([0-9a-f]{32})__(\d+)__(?:cover|inside)\.jpg(?:\.broken)?$/;
const TRANSCODE_RE = /^([0-9a-f]{32})__(\d+)\.mp4$/;

const DEFAULT_THUMB_CAP_MB = 1024;
const DEFAULT_TRANSCODE_CAP_MB = 2048;
// Never evict something we just wrote — it may still be streaming to a client.
const EVICT_GRACE_MS = 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let registry = new Map(); // md5(path) -> source path
let registryDirty = false;
let flushTimer = null;
let inited = false;
let exitHookInstalled = false;

// Cache keys must be based on the *normalized* path. Requests can carry an
// equivalent-but-different spelling (doubled separators, `..`, trailing sep), and
// `fs` operations collapse those via path.normalize() — so without normalizing
// here, a delete would successfully unlink the file yet silently miss its cache.
function pathHash(p) {
  return crypto.createHash('md5').update(path.normalize(p)).digest('hex');
}

function ensureDirs() {
  for (const dir of [CACHE_ROOT, THUMB_DIR, TRANSCODE_DIR]) {
    ensureDir(dir);
  }
}

function caps() {
  const cfg = readConfig().cache || {};
  const mb = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);
  return {
    thumbnails: mb(cfg.thumbnailMaxMB, DEFAULT_THUMB_CAP_MB) * 1024 * 1024,
    transcodes: mb(cfg.transcodeMaxMB, DEFAULT_TRANSCODE_CAP_MB) * 1024 * 1024
  };
}

// --- cache paths ---

function thumbnailFile(filePath, size, fit = 'cover') {
  return path.join(THUMB_DIR, `${pathHash(filePath)}__${size}__${fit}.jpg`);
}

function transcodeFile(filePath, mtimeMs) {
  return path.join(TRANSCODE_DIR, `${pathHash(filePath)}__${Math.round(mtimeMs)}.mp4`);
}

// --- registry ---

function loadRegistry() {
  registry = new Map();
  if (!fsSync.existsSync(REGISTRY_FILE)) return;
  let raw;
  try {
    raw = fsSync.readFileSync(REGISTRY_FILE, 'utf-8');
  } catch (_) {
    return;
  }
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const { h, p } = JSON.parse(line);
      if (h && p) registry.set(h, p);
    } catch (_) { /* skip corrupt line */ }
  }
}

function persistRegistry() {
  if (!registryDirty) return;
  registryDirty = false;
  const body = [...registry].map(([h, p]) => JSON.stringify({ h, p })).join('\n') + '\n';
  const tmp = REGISTRY_FILE + '.tmp';
  try {
    fsSync.writeFileSync(tmp, body);
    fsSync.renameSync(tmp, REGISTRY_FILE);
  } catch (_) { /* registry is an optimisation; losing it is not fatal */ }
}

function scheduleRegistryFlush() {
  registryDirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    persistRegistry();
  }, 1000);
  if (flushTimer.unref) flushTimer.unref();
}

/** Remember that a cache artifact is being created for `filePath`. */
function registerSource(filePath) {
  const canonical = path.normalize(filePath);
  const h = pathHash(canonical);
  if (registry.get(h) === canonical) return;
  registry.set(h, canonical);
  scheduleRegistryFlush();
}

// --- removal ---

/**
 * Drop every cached artifact derived from the given source paths (thumbnails +
 * transcodes). Batched: each cache dir is listed once regardless of path count.
 */
async function removeSourcesCache(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return 0;

  const hashes = new Set(filePaths.map(pathHash));
  for (const p of filePaths) registry.delete(pathHash(p));
  scheduleRegistryFlush();

  let removed = 0;
  for (const dir of [THUMB_DIR, TRANSCODE_DIR]) {
    let names;
    try {
      names = await fs.readdir(dir);
    } catch (_) {
      continue;
    }
    await Promise.all(
      names.map(async (n) => {
        if (n.endsWith('.tmp')) return;
        // Cache filenames always start with md5(source path)
        if (!hashes.has(n.slice(0, 32))) return;
        try {
          await fs.unlink(path.join(dir, n));
          removed++;
        } catch (_) { /* already gone */ }
      })
    );
  }
  return removed;
}

// --- sweeping ---

function isAllowed(p, roots) {
  const n = path.normalize(p);
  return roots.some((r) => n === r || n.startsWith(r + path.sep));
}

/**
 * Remove cache files whose source is gone, plus leftovers from the previous
 * naming scheme. Returns a small report.
 */
async function sweep() {
  ensureDirs();
  const roots = readData().map((f) => path.normalize(f.path));
  let orphans = 0;
  let unknown = 0;
  let freed = 0;

  const sizeOf = async (file) => {
    try {
      return (await fs.stat(file)).size;
    } catch (_) {
      return 0;
    }
  };

  // List each cache dir once — the sweep touches every entry anyway.
  const listings = new Map();
  for (const dir of [THUMB_DIR, TRANSCODE_DIR]) {
    try {
      listings.set(dir, await fs.readdir(dir));
    } catch (_) {
      listings.set(dir, []);
    }
  }

  // Files already reclaimed in step 1 must not be counted (or stat'd) again.
  const dropped = new Set();

  // 1. Registry-driven: sources that no longer exist or are no longer allowed.
  for (const [h, p] of [...registry]) {
    if (isAllowed(p, roots) && fsSync.existsSync(p)) continue;
    for (const [dir, names] of listings) {
      for (const n of names) {
        if (!n.startsWith(h + '__') || n.endsWith('.tmp')) continue;
        const full = path.join(dir, n);
        freed += await sizeOf(full);
        dropped.add(full);
        await fs.unlink(full).catch(() => {});
      }
    }
    registry.delete(h);
    registryDirty = true;
    orphans++;
  }

  // 2. Anything the registry does not know about is unreachable (legacy scheme,
  //    lost registration) — it can never be served again, so reclaim it now.
  for (const [dir, re] of [[THUMB_DIR, THUMB_RE], [TRANSCODE_DIR, TRANSCODE_RE]]) {
    for (const n of listings.get(dir)) {
      if (n.endsWith('.tmp')) continue;
      const full = path.join(dir, n);
      if (dropped.has(full)) continue;
      const m = re.exec(n);
      if (m && registry.has(m[1])) continue;
      freed += await sizeOf(full);
      await fs.unlink(full).catch(() => {});
      unknown++;
    }
  }

  if (registryDirty) persistRegistry();
  return { orphans, unreachable: unknown, freedBytes: freed };
}

// --- size caps (LRU) ---

async function enforceCap(dir, cap) {
  if (!cap) return { removed: 0, freedBytes: 0 };
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (_) {
    return { removed: 0, freedBytes: 0 };
  }

  const now = Date.now();
  const files = [];
  let total = 0;
  for (const n of names) {
    if (n.endsWith('.tmp')) continue;
    try {
      const st = await fs.stat(path.join(dir, n));
      files.push({ name: n, size: st.size, lastUsed: Math.max(st.atimeMs || 0, st.mtimeMs || 0) });
      total += st.size;
    } catch (_) { /* raced with a delete */ }
  }
  if (total <= cap) return { removed: 0, freedBytes: 0 };

  // Least recently used first (Windows often has atime updates disabled, so this
  // degrades to oldest-written — still the right end of the cache to drop).
  files.sort((a, b) => a.lastUsed - b.lastUsed);

  let removed = 0;
  let freed = 0;
  for (const f of files) {
    if (total <= cap) break;
    if (now - f.lastUsed < EVICT_GRACE_MS) continue;
    try {
      await fs.unlink(path.join(dir, f.name));
    } catch (_) {
      continue;
    }
    total -= f.size;
    freed += f.size;
    removed++;
    // A .broken marker is only meaningful next to its jpg
    if (f.name.endsWith('.jpg')) {
      try {
        await fs.unlink(path.join(dir, f.name + '.broken'));
      } catch (_) { /* no marker */ }
    }
  }
  return { removed, freedBytes: freed };
}

async function enforceCaps() {
  const cap = caps();
  const thumbs = await enforceCap(THUMB_DIR, cap.thumbnails);
  const transcodes = await enforceCap(TRANSCODE_DIR, cap.transcodes);
  return {
    thumbnails: thumbs,
    transcodes,
    freedBytes: thumbs.freedBytes + transcodes.freedBytes
  };
}

// --- lifecycle ---

let sweepTimer = null;

function scheduleSweepSoon(delayMs = 5000) {
  if (sweepTimer) clearTimeout(sweepTimer);
  sweepTimer = setTimeout(async () => {
    sweepTimer = null;
    try {
      await sweep();
      await enforceCaps();
    } catch (e) {
      console.error('[Cache] sweep failed:', e.message);
    }
  }, delayMs);
  if (sweepTimer.unref) sweepTimer.unref();
}

/** Idempotent: ensures dirs, loads the registry, then sweeps + enforces caps. */
async function init() {
  if (inited) return { skipped: true };
  inited = true;

  ensureDirs();
  loadRegistry();

  if (!exitHookInstalled) {
    exitHookInstalled = true;
    // Best-effort: the registry is only an optimisation, losing the tail is fine.
    process.on('exit', () => { try { persistRegistry(); } catch (_) {} });
  }

  const swept = await sweep();
  const capped = await enforceCaps();

  if (swept.orphans || swept.unreachable || capped.freedBytes) {
    const mb = (n) => (n / (1024 * 1024)).toFixed(1);
    console.log(
      `[Cache] orphan sources: ${swept.orphans}, unreachable files: ${swept.unreachable}, ` +
      `evicted: ${capped.thumbnails.removed + capped.transcodes.removed} (freed ${mb(swept.freedBytes + capped.freedBytes)} MB)`
    );
  }

  const timer = setInterval(async () => {
    try {
      await sweep();
      await enforceCaps();
    } catch (e) {
      console.error('[Cache] periodic maintenance failed:', e.message);
    }
  }, SWEEP_INTERVAL_MS);
  if (timer.unref) timer.unref();

  return { swept, capped };
}

// Directories must exist before any thumbnail/transcode write, which can happen
// on the very first request — well before init() finishes.
ensureDirs();

module.exports = {
  thumbnailFile,
  transcodeFile,
  registerSource,
  removeSourcesCache,
  scheduleSweepSoon,
  init
};
