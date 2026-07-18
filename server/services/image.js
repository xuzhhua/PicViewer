const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { readData } = require('../data/store');
const dicom = require('./dicom');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'thumbnails');
const TRANSCODE_CACHE_DIR = path.join(__dirname, '..', 'cache', 'transcodes');

// Ensure cache directories exist
if (!fsSync.existsSync(CACHE_DIR)) {
  fsSync.mkdirSync(CACHE_DIR, { recursive: true });
}
if (!fsSync.existsSync(TRANSCODE_CACHE_DIR)) {
  fsSync.mkdirSync(TRANSCODE_CACHE_DIR, { recursive: true });
}

// Video formats that browsers can play natively (no transcoding needed)
const BROWSER_NATIVE_VIDEO = new Set(['.mp4', '.webm', '.m4v']);

// All supported video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'];

// DICOM extension
const DICOM_EXTENSION = '.dcm';

// Check if path is within configured root folders
function isPathAllowed(targetPath) {
  const rootFolders = readData();
  if (rootFolders.length === 0) return false;
  const normalized = path.normalize(targetPath);
  return rootFolders.some(root => {
    const rootNorm = path.normalize(root.path);
    return normalized === rootNorm || normalized.startsWith(rootNorm + path.sep);
  });
}

// Generate a safe cache key from path + size + fit
function getCacheKey(filePath, size, fit = 'cover') {
  const hash = crypto.createHash('md5')
    .update(`${filePath}::${size}::${fit}`)
    .digest('hex');
  return path.join(CACHE_DIR, hash + '.jpg');
}

// Transcode browser-incompatible video to MP4 (H.264 + AAC) on-the-fly
// Results are cached so subsequent requests are served instantly
async function transcodeVideo(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();

  // If browser can play it natively, serve directly
  if (BROWSER_NATIVE_VIDEO.has(ext)) {
    return serveFileDirect(filePath, res);
  }

  // Generate cache key from file path + mtime (re-transcode if file changed)
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (e) {
    throw Object.assign(new Error('File not found'), { status: 404 });
  }

  const cacheHash = crypto.createHash('md5')
    .update(`${filePath}::${stat.mtimeMs}`)
    .digest('hex');
  const cachePath = path.join(TRANSCODE_CACHE_DIR, cacheHash + '.mp4');

  // If cached version exists, serve it
  try {
    await fs.access(cachePath, fs.constants.R_OK);
    return serveFileDirect(cachePath, res);
  } catch (e) {
    // Cache miss — transcode now
  }

  console.log(`[Transcode] ${path.basename(filePath)} → MP4`);

  // Check if ffmpeg is available
  const ffmpegReady = await checkFfmpeg();
  if (!ffmpegReady) {
    // Fallback: serve original file, browser may still play it if it can
    console.warn('[Transcode] ffmpeg not found, serving original file');
    return serveFileDirect(filePath, res);
  }

  // Stream transcode: ffmpeg reads input, outputs MP4 to both cache file and response
  const tempPath = cachePath + '.tmp';

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', filePath,
      '-c:v', 'libx264',       // H.264 video
      '-preset', 'fast',        // Balance speed vs compression
      '-crf', '23',             // Good quality
      '-c:a', 'aac',            // AAC audio
      '-b:a', '128k',           // Audio bitrate
      '-movflags', '+faststart', // Enable streaming (moov atom at front)
      '-pix_fmt', 'yuv420p',    // Compatible pixel format
      '-y',                     // Overwrite output
      '-f', 'mp4',              // Force MP4 format
      tempPath
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    ffmpeg.on('error', (err) => {
      console.error('[Transcode] ffmpeg spawn error:', err.message);
      // Clean up and fallback
      fsSync.unlink(tempPath, () => {});
      reject(err);
    });

    // Collect stderr for debugging (ffmpeg outputs progress to stderr)
    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', async (code) => {
      if (code !== 0) {
        console.error(`[Transcode] ffmpeg exited with code ${code}`);
        console.error(stderr.slice(-500));
        try { await fs.unlink(tempPath); } catch (e) {}
        // Fallback: serve original
        try {
          await serveFileDirect(filePath, res);
          resolve();
        } catch (e2) { reject(e2); }
        return;
      }

      // Rename temp to final cache file
      try {
        await fs.rename(tempPath, cachePath);
        console.log(`[Transcode] Cached: ${cachePath}`);
        // Now serve from cache
        await serveFileDirect(cachePath, res);
        resolve();
      } catch (e) {
        // If rename fails, try serving temp file
        try {
          await serveFileDirect(tempPath, res);
        } catch (e2) {
          // Last fallback: original file
          try {
            await serveFileDirect(filePath, res);
          } catch (e3) { reject(e3); }
        }
        resolve();
      }
    });

    // Handle client disconnect — kill ffmpeg and clean up
    res.on('close', () => {
      ffmpeg.kill('SIGTERM');
      setTimeout(() => {
        try { fsSync.unlink(tempPath, () => {}); } catch (e) {}
      }, 500);
    });
  });
}

// Check if ffmpeg is available on the system
function checkFfmpeg() {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
    // Timeout after 3 seconds
    setTimeout(() => {
      try { proc.kill(); } catch (e) {}
      resolve(false);
    }, 3000);
  });
}

// Serve DICOM file converted to JPEG for browser display
async function serveDicomPreview(filePath, res) {
  try {
    const jpegBuffer = await dicom.generateDicomPreview(filePath);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', jpegBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(jpegBuffer);
  } catch (err) {
    console.error(`[DICOM] Preview generation failed: ${err.message}`);
    // Serve placeholder on error
    const size = 512;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="#1a1a2e"/>
      <text x="${size*0.5}" y="${size*0.45}" text-anchor="middle" fill="#999" font-size="18" font-family="Arial, sans-serif">DICOM</text>
      <text x="${size*0.5}" y="${size*0.58}" text-anchor="middle" fill="#777" font-size="12" font-family="Arial, sans-serif">Unsupported format</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(svg);
  }
}

// Core file serving (used directly for native formats and cached transcodes)
async function serveFileDirect(filePath, res) {
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
    '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv', '.m4v': 'video/mp4',
    '.mts': 'video/mp2t', '.m2ts': 'video/mp2t'
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  const stat = await fs.stat(filePath);

  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');

  // Handle Range requests (essential for video seeking)
  const range = res.req?.headers?.range;
  if (range) {
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

// Serve file — routes videos through transcoder if needed, DICOM through converter
async function serveFile(filePath, res) {
  if (!isPathAllowed(filePath)) {
    throw Object.assign(new Error('Path not allowed'), { status: 403 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const isVideo = VIDEO_EXTENSIONS.includes(ext);

  if (isVideo && !BROWSER_NATIVE_VIDEO.has(ext)) {
    return transcodeVideo(filePath, res);
  }

  // DICOM: convert to JPEG for browser display
  if (ext === DICOM_EXTENSION) {
    return serveDicomPreview(filePath, res);
  }

  return serveFileDirect(filePath, res);
}

// Extract a video frame as thumbnail using ffmpeg, with caching
async function serveVideoThumbnail(filePath, size, cacheKey, res) {
  // Check cache first
  try {
    const cacheStat = await fs.stat(cacheKey);
    const fileStat = await fs.stat(filePath);
    if (cacheStat.mtime > fileStat.mtime) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const stream = require('fs').createReadStream(cacheKey);
      return stream.pipe(res);
    }
  } catch (e) { /* cache miss */ }

  // Try ffmpeg frame extraction
  const ffmpegReady = await checkFfmpeg();
  if (!ffmpegReady) {
    // Fallback to SVG placeholder
    return serveVideoThumbnailPlaceholder(size, res);
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-ss', '1',               // Seek to 1 second
      '-i', filePath,
      '-vframes', '1',          // Extract 1 frame
      '-vf', `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`,
      '-f', 'mjpeg',            // Output as JPEG
      '-q:v', '3',              // Good quality (2-5, lower=better)
      '-v', 'quiet',
      'pipe:1'                  // Output to stdout
    ];

    const ffmpeg = spawn('ffmpeg', args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const chunks = [];
    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => { stderr += data.toString(); });

    ffmpeg.on('error', () => {
      serveVideoThumbnailPlaceholder(size, res);
      resolve();
    });

    ffmpeg.on('close', async (code) => {
      const buffer = Buffer.concat(chunks);
      if (code === 0 && buffer.length > 0) {
        // Cache the result
        try {
          await fs.writeFile(cacheKey, buffer);
        } catch (e) { /* ignore cache write error */ }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Length', buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.end(buffer);
      } else {
        // Extraction failed, use placeholder
        console.warn(`[Thumbnail] ffmpeg failed for ${path.basename(filePath)}, using placeholder`);
        serveVideoThumbnailPlaceholder(size, res);
      }
      resolve();
    });
  });
}

// SVG placeholder fallback when ffmpeg is unavailable or fails
function serveVideoThumbnailPlaceholder(size, res) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#1a1a2e"/>
    <polygon points="${size*0.35},${size*0.25} ${size*0.35},${size*0.75} ${size*0.7},${size*0.5}" fill="#4a9eff" opacity="0.8"/>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(svg);
}

// SVG placeholder for broken/corrupted images
function serveBrokenImagePlaceholder(size, res) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="#2d2d2d"/>
    <rect x="${size*0.2}" y="${size*0.2}" width="${size*0.6}" height="${size*0.6}" rx="8" fill="none" stroke="#666" stroke-width="2" stroke-dasharray="${size*0.08},${size*0.06}"/>
    <text x="${size*0.5}" y="${size*0.48}" text-anchor="middle" fill="#999" font-size="${Math.max(size*0.12, 12)}" font-family="Arial, sans-serif">Broken</text>
    <text x="${size*0.5}" y="${size*0.62}" text-anchor="middle" fill="#888" font-size="${Math.max(size*0.08, 9)}" font-family="Arial, sans-serif">Image</text>
  </svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.end(svg);
}

// Generate and serve thumbnail
async function serveThumbnail(filePath, size, fit, res) {
  if (!isPathAllowed(filePath)) {
    throw Object.assign(new Error('Path not allowed'), { status: 403 });
  }

  await fs.access(filePath, fs.constants.R_OK);

  // Video thumbnail — extract frame via ffmpeg
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) {
    const cacheKey = getCacheKey(filePath, size, fit);
    return serveVideoThumbnail(filePath, size, cacheKey, res);
  }

  // DICOM thumbnail — convert via dicom service
  if (ext === DICOM_EXTENSION) {
    return serveDicomThumbnail(filePath, size, fit, res);
  }

  const cacheKey = getCacheKey(filePath, size, fit);

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

  // Check if this file was previously marked as broken (corrupt image)
  try {
    await fs.access(cacheKey + '.broken', fs.constants.F_OK);
    // Known broken file — serve placeholder immediately without retrying sharp
    return serveBrokenImagePlaceholder(size, res);
  } catch (_) {
    // No broken marker, proceed with thumbnail generation
  }

  try {
    // Generate thumbnail with sharp
    const resizeOpts = fit === 'inside'
      ? { fit: 'inside', withoutEnlargement: true }
      : { fit: 'cover', position: 'centre' };
    const buffer = await sharp(filePath)
      .resize(size, size, resizeOpts)
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
    // Write a .broken marker so we don't retry this file (skip cache check next time)
    try {
      await fs.writeFile(cacheKey + '.broken', '');
    } catch (_) { /* non-critical */ }
    serveBrokenImagePlaceholder(size, res);
  }
}

// Generate DICOM thumbnail with caching
async function serveDicomThumbnail(filePath, size, fit, res) {
  const cacheKey = getCacheKey(filePath, size, fit);

  // Check cache
  try {
    const cacheStat = await fs.stat(cacheKey);
    const fileStat = await fs.stat(filePath);
    if (cacheStat.mtime > fileStat.mtime) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const stream = require('fs').createReadStream(cacheKey);
      return stream.pipe(res);
    }
  } catch (e) { /* cache miss */ }

  try {
    const buffer = await dicom.generateDicomThumbnail(filePath, size, fit);
    await fs.writeFile(cacheKey, buffer);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buffer);
  } catch (err) {
    console.error(`[DICOM] Thumbnail failed: ${err.message}`);
    serveBrokenImagePlaceholder(size, res);
  }
}

module.exports = { serveFile, serveThumbnail };
