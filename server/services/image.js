const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const sharp = require('sharp');
const { readData } = require('../data/store');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'thumbnails');

// Ensure cache directory exists
if (!fsSync.existsSync(CACHE_DIR)) {
  fsSync.mkdirSync(CACHE_DIR, { recursive: true });
}

// Check if path is within configured root folders
function isPathAllowed(targetPath) {
  const rootFolders = readData();
  if (rootFolders.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return rootFolders.some(root => {
    const rootNorm = path.normalize(root.path);
    return normalized.startsWith(rootNorm) || normalized === rootNorm;
  });
}

// Generate a safe cache key from path + size
function getCacheKey(filePath, size) {
  const hash = require('crypto')
    .createHash('md5')
    .update(`${filePath}::${size}`)
    .digest('hex');
  return path.join(CACHE_DIR, hash + '.jpg');
}

// Serve original file with correct content-type
async function serveFile(filePath, res) {
  if (!isPathAllowed(filePath)) {
    throw Object.assign(new Error('Path not allowed'), { status: 403 });
  }

  // Check file exists
  await fs.access(filePath, fs.constants.R_OK);

  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.tiff': 'image/tiff',
    '.tif': 'image/tiff', '.ico': 'image/x-icon',
    '.avif': 'image/avif', '.heic': 'image/heic',
    '.heif': 'image/heif',
    // Video
    '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv', '.m4v': 'video/mp4',
    '.mts': 'video/mp2t', '.m2ts': 'video/mp2t'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const stat = await fs.stat(filePath);
  const isVideo = contentType.startsWith('video/');

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');

  // Handle Range requests (essential for video seeking)
  const range = res.req?.headers?.range;
  if (range && isVideo) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 5 * 1024 * 1024, stat.size - 1);
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', chunkSize);

    const stream = require('fs').createReadStream(filePath, { start, end });
    stream.pipe(res);
    return;
  }

  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const stream = require('fs').createReadStream(filePath);
  stream.pipe(res);
}

// Generate and serve thumbnail
async function serveThumbnail(filePath, size, res) {
  if (!isPathAllowed(filePath)) {
    throw Object.assign(new Error('Path not allowed'), { status: 403 });
  }

  await fs.access(filePath, fs.constants.R_OK);

  // Video thumbnail - return placeholder
  const ext = path.extname(filePath).toLowerCase();
  const videoExts = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'];
  if (videoExts.includes(ext)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="#1a1a2e"/>
      <polygon points="${size*0.35},${size*0.25} ${size*0.35},${size*0.75} ${size*0.7},${size*0.5}" fill="#4a9eff" opacity="0.8"/>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.end(svg);
  }

  const cacheKey = getCacheKey(filePath, size);

  // Check cache first
  try {
    const cacheStat = await fs.stat(cacheKey);
    const fileStat = await fs.stat(filePath);

    // If cache is newer than original file, serve from cache
    if (cacheStat.mtime > fileStat.mtime) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const stream = require('fs').createReadStream(cacheKey);
      return stream.pipe(res);
    }
  } catch (e) {
    // Cache miss or error, generate new thumbnail
  }

  try {
    // Generate thumbnail with sharp
    const buffer = await sharp(filePath)
      .resize(size, size, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toBuffer();

    // Save to cache
    await fs.writeFile(cacheKey, buffer);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buffer);
  } catch (sharpErr) {
    // If sharp fails (corrupt image, unsupported format), serve a placeholder
    console.error(`Thumbnail generation failed for ${filePath}:`, sharpErr.message);
    throw sharpErr;
  }
}

// Search images by filename
async function searchImages(query, rootFolders) {
  // For simplicity, search is done client-side after browsing
  return { query };
}

module.exports = { serveFile, serveThumbnail, searchImages };
