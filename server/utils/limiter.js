/**
 * 简单的 FIFO 并发限制器。
 *
 * 缩略图生成是重活：整文件解码（网络盘上还要先把整张原图读过来）+ 缩放，
 * 而 Node 的 libuv 线程池默认只有 4 个线程。灯箱缩略图条 / 网格滚动会
 * 同时请求几十张缩略图，占满线程池之后，连原图流的 fs.stat /
 * createReadStream 都要排在后面 —— 用户看到的就是「切两三张图之后越来越慢」。
 *
 * 给缩略图生成加一个上限，让原图请求始终有线程可用。
 *
 * 用法：
 *   const run = createLimiter(3);
 *   const buffer = await run(() => heavyWork());
 */
function createLimiter(maxConcurrent) {
  const limit = Math.max(1, Number(maxConcurrent) || 1);
  let active = 0;
  const queue = [];

  function pump() {
    while (active < limit && queue.length > 0) {
      const job = queue.shift();
      active += 1;
      Promise.resolve()
        .then(job.fn)
        .then(
          (value) => { active -= 1; job.resolve(value); pump(); },
          (err) => { active -= 1; job.reject(err); pump(); }
        );
    }
  }

  function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      pump();
    });
  }

  // 供测试/诊断使用
  run.stats = () => ({ active, queued: queue.length, limit });
  return run;
}

module.exports = { createLimiter };
