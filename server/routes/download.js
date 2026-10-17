const express = require('express');
const router = express.Router();
const path = require('path');
const archiver = require('archiver');
const { isPathAllowed } = require('../security/pathGuard');
const { sendError } = require('../utils/respond');

// Batch download selected files as ZIP
// GET or POST /api/download?paths=<base64,csv> or POST body { paths: [...] }
const MAX_FILES = 200;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024 * 1024; // 4 GB

router.get('/', handleDownload);
router.post('/', handleDownload);

async function handleDownload(req, res) {
  try {
    // Support both GET query and POST body
    let encoded;
    if (req.method === 'POST' && req.body && req.body.paths) {
      encoded = Array.isArray(req.body.paths) ? req.body.paths.join(',') : req.body.paths;
    } else {
      encoded = req.query.paths;
    }

    if (!encoded) {
      return res.status(400).json({ error: 'Paths are required' });
    }

    const paths = encoded.split(',').map(p => {
      try {
        return Buffer.from(p, 'base64').toString('utf-8');
      } catch (e) { return p; }
    });

    // Limit check
    if (paths.length > MAX_FILES) {
      return res.status(400).json({ error: `Too many files (max ${MAX_FILES})` });
    }

    // Security: verify all paths are within allowed folders
    for (const filePath of paths) {
      if (!isPathAllowed(filePath)) {
        return res.status(403).json({ error: `Path not allowed: ${filePath}` });
      }
    }

    // 总量上限：MAX_TOTAL_SIZE 以前定义了却从没检查过。网络盘上 200 张大图
    // 打包进去就是几个 GB 的下载，既拖垮服务也几乎必然中断，不如提前拒绝。
    const fsPromises = require('fs').promises;
    let totalBytes = 0;
    for (const filePath of paths) {
      try {
        const stat = await fsPromises.stat(filePath);
        if (stat.isFile()) totalBytes += stat.size;
      } catch (_) { /* 读不到的文件交给 archiver 跳过 */ }
    }
    if (totalBytes > MAX_TOTAL_SIZE) {
      return res.status(413).json({
        error: `所选文件总计 ${(totalBytes / 1073741824).toFixed(1)}GB，超过 ${MAX_TOTAL_SIZE / 1073741824}GB 上限，请分批下载`,
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="picviewer-download.zip"');

    const archive = archiver('zip', { zlib: { level: 1 } });

    // archiver 的错误必须接住：@archiver 在某个文件读失败时会 emit('error')，
    // 没有监听器就是进程级 uncaughtException；而这时 headers 早已发出去了。
    archive.on('error', (err) => {
      console.error('[Download] archive error:', err.message);
      try { archive.abort(); } catch (_) {}
      if (res.headersSent || res.writableEnded) {
        try { res.destroy(); } catch (_) {}
      } else {
        sendError(res, 500, err.message);
      }
    });

    // 客户端取消下载（关页面/断网）→ 停止打包，别继续读网络盘
    res.on('close', () => {
      if (!res.writableEnded) {
        try { archive.abort(); } catch (_) {}
      }
    });

    archive.pipe(res);

    // Deduplicate filenames by adding parent folder prefix
    const usedNames = new Map();
    for (const filePath of paths) {
      let name = path.basename(filePath);
      const count = usedNames.get(name) || 0;
      usedNames.set(name, count + 1);
      if (count > 0) {
        const parent = path.basename(path.dirname(filePath));
        name = `${parent}_${name}`;
        const parentCount = usedNames.get(name) || 0;
        usedNames.set(name, parentCount + 1);
        if (parentCount > 0) {
          name = `${parent}_${parentCount}_${path.basename(filePath)}`;
        }
      }
      try {
        archive.file(filePath, { name });
      } catch (e) {
        // Skip files that can't be read
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Download error:', err);
    sendError(res, 500, err.message);
  }
}

module.exports = router;
