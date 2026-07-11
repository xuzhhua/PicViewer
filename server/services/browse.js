const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const sharp = require('sharp');
const { spawn } = require('child_process');
const { readData, readIgnored } = require('../data/store');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.svg', '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif'
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'
]);

const FOLDER_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);

// --- Shared media metadata helpers ---

async function enrichImageInfo(imgInfo, fullPath) {
  try {
    const meta = await sharp(fullPath).metadata();
    imgInfo.width = meta.width || 0;
    imgInfo.height = meta.height || 0;
    imgInfo.format = meta.format || path.extname(fullPath).toLowerCase().slice(1);
    // EXIF-like info that sharp exposes
    if (meta.orientation) imgInfo.orientation = meta.orientation;
    if (meta.space) imgInfo.colorSpace = meta.space;
    if (meta.hasAlpha != null) imgInfo.hasAlpha = meta.hasAlpha;
    if (meta.channels) imgInfo.channels = meta.channels;
  } catch (e) { /* ignore */ }
}

async function enrichVideoInfo(vidInfo, fullPath) {
  vidInfo.format = path.extname(fullPath).toLowerCase().slice(1);
  try {
    const info = await ffprobe(fullPath);
    if (info) {
      if (info.duration != null) vidInfo.duration = Math.round(info.duration);
      if (info.videoCodec) vidInfo.videoCodec = info.videoCodec;
      if (info.width) vidInfo.width = info.width;
      if (info.height) vidInfo.height = info.height;
      if (info.bitrate) vidInfo.bitrate = info.bitrate;
    }
  } catch (e) { /* ignore */ }
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
    return normalized.startsWith(rootNorm) || normalized === rootNorm;
  });
}

// Check if a path (or its parent chain) is in the ignored list
function isIgnored(targetPath) {
  const ignored = readIgnored();
  if (ignored.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return ignored.some(entry => {
    const ignoredNorm = path.normalize(entry.path);
    return normalized.startsWith(ignoredNorm) || normalized === ignoredNorm;
  });
}

// If no root folders configured, return root folders info
async function listDirectory(targetPath, options = {}) {
  const { details = false } = options;
  const rootFolders = readData();

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

  for (const entry of entries) {
    // Skip hidden files/folders
    if (entry.name.startsWith('.') || entry.name.startsWith('$')) continue;

    const fullPath = path.join(targetPath, entry.name);

    if (entry.isDirectory()) {
      try {
        await fs.access(fullPath, fs.constants.R_OK);
        // Skip ignored folders
        if (isIgnored(fullPath)) continue;
        folders.push({ name: entry.name, path: fullPath });
      } catch (e) { /* skip */ }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        try {
          const fileStat = await fs.stat(fullPath);
          const imgInfo = {
            name: entry.name, path: fullPath, type: 'image',
            size: fileStat.size, modified: fileStat.mtime.toISOString()
          };
          if (details) {
            await enrichImageInfo(imgInfo, fullPath);
          }
          images.push(imgInfo);
        } catch (e) { /* skip */ }
      } else if (VIDEO_EXTENSIONS.has(ext)) {
        try {
          const fileStat = await fs.stat(fullPath);
          const vidInfo = {
            name: entry.name, path: fullPath, type: 'video',
            size: fileStat.size, modified: fileStat.mtime.toISOString()
          };
          if (details) {
            await enrichVideoInfo(vidInfo, fullPath);
          }
          videos.push(vidInfo);
        } catch (e) { /* skip */ }
      }
    }
  }

  // Sort: folders first alphabetically, then images by name
  folders.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  images.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

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
  const { details = false, maxDepth = 5 } = options;
  const rootFolders = readData();

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
        if (isIgnored(fullPath)) continue;
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
            if (details) {
              await enrichImageInfo(imgInfo, fullPath);
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
            if (details) {
              await enrichVideoInfo(vidInfo, fullPath);
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
