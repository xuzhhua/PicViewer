const express = require('express');
const router = express.Router();
const { extractAiMeta } = require('../services/aiMeta');
const { isPathAllowed } = require('../security/pathGuard');
const { sendError } = require('../utils/respond');

function decodePath(encodedPath) {
  return Buffer.from(encodedPath, 'base64url').toString('utf-8');
}

// AI 生成参数（提示词/采样器/种子…）
// GET /api/ai-meta?path=<base64url>
//
// 只读文件头部，不整文件读；解析失败时返回 { hasAI: false }，
// 前端据此决定是否显示「AI 信息」分页，普通照片不受影响。
router.get('/', async (req, res) => {
  try {
    const encodedPath = req.query.path;
    if (!encodedPath) {
      return sendError(res, 400, 'Path is required');
    }

    let filePath;
    try {
      filePath = decodePath(String(encodedPath));
    } catch (_) {
      return sendError(res, 400, 'Invalid path');
    }
    if (!filePath) {
      return sendError(res, 400, 'Invalid path');
    }

    // 与浏览/原图接口同一套白名单：路径必须落在已配置的根目录内
    if (!isPathAllowed(filePath)) {
      return sendError(res, 403, 'Path not allowed');
    }

    const meta = await extractAiMeta(filePath);
    if (!meta) {
      return res.json({ hasAI: false });
    }
    res.json(meta);
  } catch (err) {
    console.error('AI meta error:', err);
    return sendError(res, 500, err.message);
  }
});

module.exports = router;
