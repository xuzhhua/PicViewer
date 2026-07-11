const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const sharp = require('sharp');
const { readData } = require('../data/store');

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.svg', '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif'
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'
]);

const FOLDER_EXTENSIONS = new Set(['.zip', '.rar', '.7z']);

// Check if path is within any allowed root folder
function isPathAllowed(targetPath, rootFolders) {
  if (rootFolders.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return rootFolders.some(root => {
    const rootNorm = path.normalize(root.path);
    return normalized.startsWith(rootNorm) || normalized === rootNorm;
  });
}

// If no root folders configured, return root folders info
// If targetPath is empty, list configured root folders as top-level items
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
            try {
              const meta = await sharp(fullPath).metadata();
              imgInfo.width = meta.width || 0;
              imgInfo.height = meta.height || 0;
              imgInfo.format = meta.format || ext.slice(1);
            } catch (e) { /* ignore metadata errors */ }
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
            vidInfo.format = ext.slice(1);
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

module.exports = { listDirectory, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS };
