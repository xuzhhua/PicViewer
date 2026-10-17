const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { readData } = require('../data/store');
const dicom = require('./dicom');
const cache = require('./cache');
const { createLimiter } = require('../utils/limiter');
const { applyFreshness } = require('../utils/httpCache');

// libvips' operation cache keeps an open handle to every source file it reads
// until the process exits. That leaves any file we generate a thumbnail for
// undeletable (EBUSY) — most noticeably on SMB/network drives, where the handle
// is held for the whole session. Thumbnails are cached on disk anyway, so the
// operation cache buys us nothing; disabling it also keeps memory flat.
sharp.cache(false);

// 缩略图生成的并发上限（可用环境变量覆盖）。
// 不限流时，一次滚动/一次打开灯箱就能同时甩出几十个 sharp 解码任务，
// 把 libuv 线程池占满，原图请求跟着一起卡住。默认 3：足够跑满小图的吞吐，
// 又始终留得下线程给原图流。
const THUMBNAIL_CONCURRENCY = Math.max(1, parseInt(process.env.PICVIEWER_THUMB_CONCURRENCY, 10) || 3);
const runThumbnailJob = createLimiter(THUMBNAIL_CONCURRENCY);
console.log(`[Thumbnail] concurrency limit: ${THUMBNAIL_CONCURRENCY}`);

// 同一个 cacheKey 的并发请求只做一次真实生成（网格/灯箱/预加载可能同时要同一张）
const inFlightThumbnails = new Map();

/**
 * 生成一张缩略图并落盘缓存：经过并发限制器，且同 key 的并发请求共享结果。
 * @param {string} cacheKey 缓存文件路径
 * @param {() => Promise<Buffer>} generate 真正的生成函数
 * @returns {Promise<Buffer>}
 */
function generateThumbnail(cacheKey, generate) {
  const pending = inFlightThumbnails.get(cacheKey);
  if (pending) return pending;
  const job = runThumbnailJob(async () => {
    const buffer = await generate();
    try {
      await fs.writeFile(cacheKey, buffer);
    } catch (e) {
      // 缓存目录不可写不该让图片显示不出来：本次照常返回，只是下次得再生成
      console.warn(`[Cache] write failed ${path.basename(cacheKey)}: ${e.message}`);
    }
    return buffer;
  });
  inFlightThumbnails.set(cacheKey, job);
  return job.finally(() => {
    if (inFlightThumbnails.get(cacheKey) === job) inFlightThumbnails.delete(cacheKey);
  });
}

// Video formats that browsers can play natively (no transcoding needed)
const BROWSER_NATIVE_VIDEO = new Set(['.mp4', '.webm', '.m4v']);

// All supported video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.m4v', '.mts', '.m2ts'];

// DICOM extension
const DICOM_EXTENSION = '.dcm';

// --- 灯箱预览图（比原图小一个数量级，网络盘/远程访问的关键） ---
// 长边规则（默认 1920、夹在 320~4096）在 utils/previewParams 里，便于单测。
const {
  PREVIEW_DEFAULT_EDGE,
  clampPreviewEdge,
} = require('../utils/previewParams');
// 原图本来就不大时没必要重新编码（省一次 sharp 全解码）
const PREVIEW_MAX_ORIGINAL_BYTES = 500 * 1024;
// 预览图内容由源文件决定，源文件不变就可以长期缓存；变了靠 ETag 失效
const PREVIEW_CACHE_CONTROL = 'public, max-age=604800, must-revalidate';
// 动图（gif）和矢量图（svg）压成静态 JPEG 会丢帧/丢清晰度，交回原流程
const PREVIEW_PASSTHROUGH = new Set(['.gif', '.svg']);

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

// Cache path for a thumbnail. The md5(source path) prefix is what lets the cache
// service find (and drop) every artifact of a source file by prefix — see cache.js.
function getCacheKey(filePath, size, fit = 'cover') {
  return cache.thumbnailFile(filePath, size, fit);
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

  const cachePath = cache.transcodeFile(filePath, stat.mtimeMs);
  cache.registerSource(filePath);

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

  // 条件请求：文件没变就回 304，不再整份传输（视频 Range 请求同样受益）
  const cacheControl = 'public, max-age=3600, must-revalidate';
  if (applyFreshness(res.req, res, stat, cacheControl)) return;

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
    res.setHeader('Cache-Control', cacheControl);

    const stream = require('fs').createReadStream(filePath, { start, end });
    stream.pipe(res);
    return;
  }

  res.setHeader('Content-Length', stat.size);

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

/**
 * 灯箱用的中间尺寸预览图。
 *
 * 灯箱原来直接加载原图：一张 3840×2160 的照片 3~8MB，网络盘上还得先从 SMB
 * 把整张读过来再发出去。实测压到长边 2560 之后只剩原图的 15%~40%
 * （565KB~1.5MB），1080 边长只有 2%~7%。生成结果落盘缓存，第二次访问直接从
 * 本地盘流出去 —— 网络盘的原图只需要读一次。
 *
 * 页面上放大到超过预览图分辨率时，客户端会另外请求原图。
 */
async function servePreview(filePath, res, opts = {}) {
  if (!isPathAllowed(filePath)) {
    throw Object.assign(new Error('Path not allowed'), { status: 403 });
  }

  const maxEdge = clampPreviewEdge(opts.w);
  const ext = path.extname(filePath).toLowerCase();
  const fileStat = await fs.stat(filePath);

  // 视频/DICOM/动图/矢量图交回原流程
  if (VIDEO_EXTENSIONS.includes(ext) || ext === DICOM_EXTENSION || PREVIEW_PASSTHROUGH.has(ext)) {
    return serveFile(filePath, res);
  }

  let meta = null;
  try {
    meta = await sharp(filePath).metadata();
  } catch (e) {
    // 解不开的格式（或坏文件）至少还能让浏览器自己试试
    return serveFileDirect(filePath, res);
  }
  // 多帧图片（动图 webp / apng）压成静态图会丢帧
  if (!meta || meta.pages > 1) {
    return serveFileDirect(filePath, res);
  }

  const longest = Math.max(meta.width || 0, meta.height || 0);
  if (longest > 0 && longest <= maxEdge && fileStat.size <= PREVIEW_MAX_ORIGINAL_BYTES) {
    return serveFileDirect(filePath, res);
  }

  // 带透明通道的图用 webp（jpeg 会把透明区域变成黑/白底）
  const format = meta.hasAlpha ? 'webp' : 'jpg';
  const contentType = format === 'webp' ? 'image/webp' : 'image/jpeg';
  const cacheKey = cache.previewFile(filePath, maxEdge, format);

  // 放在生成之前：浏览器已经有这张预览图时，一个 304 就结束，不跑 sharp
  if (applyFreshness(res.req, res, fileStat, PREVIEW_CACHE_CONTROL)) return;

  cache.registerSource(filePath);

  // 磁盘缓存命中：直接从本地盘流出去
  try {
    const cacheStat = await fs.stat(cacheKey);
    if (cacheStat.mtime > fileStat.mtime) {
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', cacheStat.size);
      return require('fs').createReadStream(cacheKey).pipe(res);
    }
  } catch (e) { /* cache miss */ }

  try {
    const buffer = await generateThumbnail(cacheKey, () => {
      const pipeline = sharp(filePath)
        .rotate() // 按 EXIF 方向摆正：原图是靠浏览器读 EXIF 才正的
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
      // progressive：慢速链路上浏览器可以先出模糊轮廓再逐步清晰
      return format === 'webp'
        ? pipeline.webp({ quality: 82 }).toBuffer()
        : pipeline.jpeg({ quality: 82, progressive: true }).toBuffer();
    });

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error(`[Preview] ${path.basename(filePath)} failed: ${err.message}`);
    // 兜底：原图总比什么都没有强
    return serveFileDirect(filePath, res);
  }
}

// Extract a video frame as thumbnail using ffmpeg, with caching
async function serveVideoThumbnail(filePath, size, cacheKey, res, fileStat) {
  // Check cache first
  try {
    const cacheStat = await fs.stat(cacheKey);
    if (cacheStat.mtime > fileStat.mtime) {
      if (applyFreshness(res.req, res, fileStat, 'public, max-age=86400')) return;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', cacheStat.size);
      const stream = require('fs').createReadStream(cacheKey);
      return stream.pipe(res);
    }
  } catch (e) { /* cache miss */ }

  // 浏览器手里已有这张帧缩略图时不必再跑 ffmpeg
  if (applyFreshness(res.req, res, fileStat, 'public, max-age=86400')) return;

  // Try ffmpeg frame extraction
  const ffmpegReady = await checkFfmpeg();
  if (!ffmpegReady) {
    // Fallback to SVG placeholder
    return serveVideoThumbnailPlaceholder(size, res);
  }

  return runThumbnailJob(() => new Promise((resolve, reject) => {
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
  }));
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
async function serveThumbnail(filePath, size, fit, res, opts = {}) {
  if (!isPathAllowed(filePath)) {
    throw Object.assign(new Error('Path not allowed'), { status: 403 });
  }

  const fileStat = await fs.stat(filePath);
  cache.registerSource(filePath);

  // Force refresh: drop the cached thumbnail (+broken marker) for this size/fit
  // so it is regenerated on this request (used by the “刷新缩略图” context action)
  if (opts.refresh) {
    const staleKey = getCacheKey(filePath, size, fit);
    try { await fs.unlink(staleKey); } catch (_) { /* no cache file */ }
    try { await fs.unlink(staleKey + '.broken'); } catch (_) { /* no broken marker */ }
  }

  // Video thumbnail — extract frame via ffmpeg
  const ext = path.extname(filePath).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) {
    const cacheKey = getCacheKey(filePath, size, fit);
    return serveVideoThumbnail(filePath, size, cacheKey, res, fileStat);
  }

  // DICOM thumbnail — convert via dicom service
  if (ext === DICOM_EXTENSION) {
    return serveDicomThumbnail(filePath, size, fit, res, fileStat);
  }

  const cacheKey = getCacheKey(filePath, size, fit);

  // Check cache first
  try {
    const cacheStat = await fs.stat(cacheKey);

    // If cache is newer than original file, serve from cache
    if (cacheStat.mtime > fileStat.mtime) {
      if (applyFreshness(res.req, res, fileStat, 'public, max-age=86400')) return;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', cacheStat.size);
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

  // 浏览器手里已有这张缩略图时不必再跑 sharp（滚动列表时省掉大量重复生成）
  if (applyFreshness(res.req, res, fileStat, 'public, max-age=86400')) return;

  try {
    // Generate thumbnail with sharp (并发受限 + 同 key 去重)
    const resizeOpts = fit === 'inside'
      ? { fit: 'inside', withoutEnlargement: true }
      : { fit: 'cover', position: 'centre' };
    const buffer = await generateThumbnail(cacheKey, () => sharp(filePath)
      .resize(size, size, resizeOpts)
      .jpeg({ quality: 80 })
      .toBuffer());

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
async function serveDicomThumbnail(filePath, size, fit, res, fileStat) {
  const cacheKey = getCacheKey(filePath, size, fit);

  // Check cache
  try {
    const cacheStat = await fs.stat(cacheKey);
    if (cacheStat.mtime > fileStat.mtime) {
      if (applyFreshness(res.req, res, fileStat, 'public, max-age=86400')) return;
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', cacheStat.size);
      const stream = require('fs').createReadStream(cacheKey);
      return stream.pipe(res);
    }
  } catch (e) { /* cache miss */ }

  if (applyFreshness(res.req, res, fileStat, 'public, max-age=86400')) return;

  try {
    const buffer = await generateThumbnail(cacheKey, () => dicom.generateDicomThumbnail(filePath, size, fit));
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error(`[DICOM] Thumbnail failed: ${err.message}`);
    serveBrokenImagePlaceholder(size, res);
  }
}

module.exports = { serveFile, serveThumbnail, servePreview, clampPreviewEdge };
