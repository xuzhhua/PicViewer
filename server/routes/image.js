const express = require('express');
const router = express.Router();
const imageService = require('../services/image');
const { clampThumbSize, normalizeFit } = require('../utils/imageParams');
const { sendError } = require('../utils/respond');

/** base64url → 路径 */
function decodePath(encodedPath) {
  return Buffer.from(encodedPath, 'base64url').toString('utf-8');
}

/**
 * 统一的错误映射。
 * 注意 headers 可能已经发出去了（流式响应写到一半失败），sendError 会处理。
 */
function handleError(res, err, label) {
  if (err.code === 'ENOENT') return sendError(res, 404, 'File not found');
  if (err.status === 403 || err.code === 'EACCES' || err.code === 'EPERM') {
    return sendError(res, 403, 'Permission denied');
  }
  console.error(`${label}:`, err);
  return sendError(res, 500, err.message);
}

// Serve original image
// GET /api/image/view?path=<base64 encoded path>
router.get('/view', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    if (!encodedPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    await imageService.serveFile(decodePath(encodedPath), res);
  } catch (err) {
    handleError(res, err, 'Image serve error');
  }
});

// Get thumbnail
// GET /api/image/thumbnail?path=<base64 encoded path>&size=256&fit=cover&refresh=1
router.get('/thumbnail', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    if (!encodedPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    // size/fit 必须夹紧：size=20000 会让 sharp 申请约 1.6GB 的位图，
    // fit 是任意字符串时会原样传给 sharp。规则见 utils/imageParams.js。
    const size = clampThumbSize(req.query.size);
    const fit = normalizeFit(req.query.fit);
    const refresh = req.query.refresh === '1';

    await imageService.serveThumbnail(decodePath(encodedPath), size, fit, res, { refresh });
  } catch (err) {
    handleError(res, err, 'Thumbnail error');
  }
});

// Get lightbox preview (downscaled original, cached on disk)
// GET /api/image/preview?path=<base64 encoded path>&w=1920
// w = 期望的长边像素（会夹紧到 320~4096，默认 1920）；客户端按屏幕大小传
router.get('/preview', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    if (!encodedPath) {
      return res.status(400).json({ error: 'Path is required' });
    }
    await imageService.servePreview(decodePath(encodedPath), res, { w: req.query.w });
  } catch (err) {
    handleError(res, err, 'Preview serve error');
  }
});

module.exports = router;
