/**
 * 统一的错误响应出口。
 *
 * 路由里的 catch 块原来直接 `res.status(500).json(...)`，但流式接口
 * （图片/视频/ZIP）一旦开始写 body，headers 就已经发出去了，再调 `res.status()`
 * 会抛 `ERR_HTTP_HEADERS_SENT`，而 Express 4 不会捕获 async 函数里的拒绝 ——
 * 结果是一个普通的「文件读一半失败」升级成进程级未捕获异常。
 *
 * 规则：headers 已经发出 → 只能把连接掐断（客户端看到的是不完整的响应，
 * 而不是「200 + 错误的 JSON body」）；否则正常回 JSON 错误。
 */
function sendError(res, status, message) {
  if (!res) return false;
  if (res.headersSent || res.writableEnded) {
    try {
      res.destroy();
    } catch (_) { /* 连接已经没了 */ }
    return false;
  }
  res.status(status).json({ error: message });
  return true;
}

module.exports = { sendError };
