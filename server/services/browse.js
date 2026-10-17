const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const sharp = require('sharp');
const { spawn } = require('child_process');
const { readData, readIgnored } = require('../data/store');
const { createLimiter } = require('../utils/limiter');
const { createMetaCache } = require('../utils/metaCache');

// 元数据读取（sharp / ffprobe）在目录扫描里是「每个文件一次」的重活。串行跑
// 时，网络盘上 200 张图 = 几百次串行 SMB 往返，首屏要等几十秒。并发受限地跑
// 能快一个数量级；上限不能太高，因为 sharp 解码占的是 libuv 线程池（默认 4），
// 占满之后连缩略图/原图请求都会被拖慢。
const ENRICH_CONCURRENCY = Math.max(1, Number(process.env.PICVIEWER_ENRICH_CONCURRENCY) || 6);
const enrichLimiter = createLimiter(ENRICH_CONCURRENCY);

// 同一文件内容不变时元数据永远不变 → 按 (path, size, mtime) 缓存，见 utils/metaCache.js
const mediaMetaCache = createMetaCache();

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.svg', '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif',
  '.dcm'
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'
]);

// --- Shared media metadata helpers ---

/**
 * 把 sharp / dicom 读出来的附加字段填进 imgInfo。
 *
 * fileStat（可选）用于元数据缓存：同一路径 + 同样 size/mtime 直接复用上次结果，
 * 网络盘上就不用为了「看看目录里有什么」把每张图都重新读一遍头。
 * 读取失败时不写缓存，下次还会重试（网络盘偶发抽风不至于把图永久标成无尺寸）。
 */
async function enrichImageInfo(imgInfo, fullPath, fileStat) {
  const ext = path.extname(fullPath).toLowerCase();

  if (fileStat) {
    const cached = mediaMetaCache.get(fullPath, fileStat.size, fileStat.mtimeMs);
    if (cached) {
      Object.assign(imgInfo, cached);
      return;
    }
  }

  const extras = {};
  let ok = false;

  // DICOM: use dicom parser for metadata
  if (ext === '.dcm') {
    try {
      const dicom = require('./dicom');
      const meta = await dicom.getDicomMetadata(fullPath);
      if (meta) {
        ok = true;
        extras.width = meta.width || 0;
        extras.height = meta.height || 0;
        extras.format = 'dcm';
        extras.dicom = {
          bitsStored: meta.bitsStored,
          photometricInterpretation: meta.photometricInterpretation,
          modality: meta.modality,
          patientName: meta.patientName,
          studyDate: meta.studyDate
        };
      }
    } catch (e) { /* ignore */ }
    Object.assign(imgInfo, extras);
    if (fileStat && ok) mediaMetaCache.set(fullPath, fileStat.size, fileStat.mtimeMs, extras);
    return;
  }

  try {
    const meta = await sharp(fullPath).metadata();
    ok = true;
    extras.width = meta.width || 0;
    extras.height = meta.height || 0;
    extras.format = meta.format || ext.slice(1);
    // EXIF-like info that sharp exposes
    if (meta.orientation) extras.orientation = meta.orientation;
    if (meta.space) extras.colorSpace = meta.space;
    if (meta.hasAlpha != null) extras.hasAlpha = meta.hasAlpha;
    if (meta.channels) extras.channels = meta.channels;
  } catch (e) { /* ignore */ }

  Object.assign(imgInfo, extras);
  if (fileStat && ok) mediaMetaCache.set(fullPath, fileStat.size, fileStat.mtimeMs, extras);
}

async function enrichVideoInfo(vidInfo, fullPath, fileStat) {
  const format = path.extname(fullPath).toLowerCase().slice(1);

  if (fileStat) {
    const cached = mediaMetaCache.get(fullPath, fileStat.size, fileStat.mtimeMs);
    if (cached) {
      Object.assign(vidInfo, cached);
      return;
    }
  }

  const extras = { format };
  let ok = false;

  try {
    const info = await ffprobe(fullPath);
    if (info) {
      ok = true;
      if (info.duration != null) extras.duration = Math.round(info.duration);
      if (info.videoCodec) extras.videoCodec = info.videoCodec;
      if (info.width) extras.width = info.width;
      if (info.height) extras.height = info.height;
      if (info.bitrate) extras.bitrate = info.bitrate;
    }
  } catch (e) { /* ignore */ }

  Object.assign(vidInfo, extras);
  if (fileStat && ok) mediaMetaCache.set(fullPath, fileStat.size, fileStat.mtimeMs, extras);
}

function ffprobe(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format', '-show_streams',
      filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });

    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try {
        const data = JSON.parse(stdout);
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
        resolve({
          duration: parseFloat(data.format?.duration) || 0,
          bitrate: parseInt(data.format?.bit_rate) || 0,
          videoCodec: videoStream?.codec_name || '',
          width: videoStream?.width || 0,
          height: videoStream?.height || 0
        });
      } catch (e) { resolve(null); }
    });
  });
}

// Check if path is within any allowed root folder
function isPathAllowed(targetPath, rootFolders) {
  if (rootFolders.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return rootFolders.some(root => {
    const rootNorm = path.normalize(root.path);
    return normalized === rootNorm || normalized.startsWith(rootNorm + path.sep);
  });
}

// Check if a path (or its parent chain) is in the ignored list
function isIgnored(targetPath, ignoredList) {
  if (!ignoredList || ignoredList.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return ignoredList.some(entry => {
    const ignoredNorm = path.normalize(entry.path);
    return normalized === ignoredNorm || normalized.startsWith(ignoredNorm + path.sep);
  });
}

// If no root folders configured, return root folders info
async function listDirectory(targetPath, options = {}) {
  const { details = false } = options;
  const rootFolders = readData();
  const ignoredList = readIgnored();

  // If no path specified, return the list of root folders
  if (!targetPath) {
    return {
      path: '',
      name: '根目录',
      folders: rootFolders.map(f => ({
        name: f.name,
        path: f.path,
        id: f.id
      })),
      images: [],
      isRoot: true
    };
  }

  // Verify targetPath is within allowed roots
  if (!isPathAllowed(targetPath, rootFolders)) {
    throw Object.assign(new Error('Path not allowed'), { code: 'EACCES' });
  }

  // Check if directory exists
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
    }
  } catch (e) {
    throw e;
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const folders = [];
  const images = [];
  const videos = [];

  // 每个文件一项任务，交给并发限制器执行 —— 串行时网络盘上「每张图一次 stat
  // + 一次 metadata 读取」的往返会直接叠加成首屏几十秒。
  const pending = [];

  for (const entry of entries) {
    // Skip hidden files/folders
    if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;

    const fullPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      pending.push(enrichLimiter(async () => {
        try {
          await fs.access(fullPath, fs.constants.R_OK);
          // Skip ignored folders
          if (isIgnored(fullPath, ignoredList)) return;
          folders.push({ name: entry.name, path: fullPath });
        } catch (e) { /* skip */ }
      }));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        pending.push(enrichLimiter(async () => {
          try {
            const fileStat = await fs.stat(fullPath);
            const imgInfo = {
              name: entry.name, path: fullPath, type: 'image',
              size: fileStat.size, modified: fileStat.mtime.toISOString()
            };
            if (details) {
              await enrichImageInfo(imgInfo, fullPath, fileStat);
            }
            images.push(imgInfo);
          } catch (e) { /* skip */ }
        }));
      } else if (VIDEO_EXTENSIONS.has(ext)) {
        pending.push(enrichLimiter(async () => {
          try {
            const fileStat = await fs.stat(fullPath);
            const vidInfo = {
              name: entry.name, path: fullPath, type: 'video',
              size: fileStat.size, modified: fileStat.mtime.toISOString()
            };
            if (details) {
              await enrichVideoInfo(vidInfo, fullPath, fileStat);
            }
            videos.push(vidInfo);
          } catch (e) { /* skip */ }
        }));
      }
    }
  }

  // 每个任务自己吞掉异常，所以这里不会 reject
  await Promise.all(pending);

  // Sort: folders first alphabetically, then images by name
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  videos.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const dirName = path.basename(targetPath) || targetPath;

  return {
    path: targetPath,
    name: dirName,
    folders,
    images,
    videos
  };
}

// Recursively list all images and videos from directory and subdirectories
async function listRecursive(targetPath, options = {}) {
  const { details = false, maxDepth = 5, fast = false } = options;
  const rootFolders = readData();
  const ignoredList = readIgnored();

  if (!isPathAllowed(targetPath, rootFolders)) {
    throw Object.assign(new Error('Path not allowed'), { code: 'EACCES' });
  }

  const images = [];
  const videos = [];

  async function walk(dirPath, depth) {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (e) {
      return; // Skip inaccessible directories
    }

    // Sort for consistent ordering
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relDir = path.relative(targetPath, dirPath) || '.';

      if (entry.isDirectory()) {
        // Skip ignored folders
        if (isIgnored(fullPath, ignoredList)) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();

        if (IMAGE_EXTENSIONS.has(ext)) {
          try {
            const fileStat = await fs.stat(fullPath);
            const imgInfo = {
              name: entry.name, path: fullPath, type: 'image',
              size: fileStat.size, modified: fileStat.mtime.toISOString(),
              folder: relDir
            };
            if (details && !fast) {
              await enrichImageInfo(imgInfo, fullPath, fileStat);
            }
            images.push(imgInfo);
          } catch (e) { /* skip */ }
        } else if (VIDEO_EXTENSIONS.has(ext)) {
          try {
            const fileStat = await fs.stat(fullPath);
            const vidInfo = {
              name: entry.name, path: fullPath, type: 'video',
              size: fileStat.size, modified: fileStat.mtime.toISOString(),
              folder: relDir
            };
            if (details && !fast) {
              await enrichVideoInfo(vidInfo, fullPath, fileStat);
            }
            videos.push(vidInfo);
          } catch (e) { /* skip */ }
        }
      }
    }
  }

  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      throw Object.assign(new Error('Not a directory'), { code: 'ENOTDIR' });
    }
  } catch (e) {
    throw e;
  }

  await walk(targetPath, 0);

  // Sort
  images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  videos.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const dirName = path.basename(targetPath) || targetPath;

  return {
    path: targetPath,
    name: dirName,
    folders: [],
    images,
    videos,
    recursive: true
  };
}

module.exports = { listDirectory, listRecursive, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS };
