# PicViewer - 进度日志

## 2026-10-19（同名文件替换后缩略图 / 大图不刷新）

现象：有一张图 A 已生成过缩略图；删掉 A 之后放入另一张图 B，**文件名和 A 完全相同**，
缩略图和灯箱大图都还是旧的（既不换图也不报错，像被“钉死”了）。

两个同时存在的根因：

1. **服务端缓存键只含源路径**（`server/services/cache.js`）。缩略图名是
   `<md5(路径)>__<size>__<fit>.jpg`，是否过期靠 `cacheStat.mtime > fileStat.mtime`。
   B 如果是从相机 / 压缩包 / 网络盘拷进来的，mtime 往往**比旧缓存还旧**，于是
   旧缓存永远“看起来更新” → 永久命中。
2. **浏览器 HTTP 缓存**（`Cache-Control: max-age=86400`，预览图 7 天）。URL 只由路径构成，
   文件换了 URL 没变，浏览器在有效期内根本不回服务器 —— 所以即使服务端修好了，
   浏览器还是会显示旧图，直到手动强刷。

改动：

- 新增 `server/utils/cacheKey.js`（纯函数，便于单测）：`sourceFingerprint(stat)` =
  `<mtimeMs>-<size>`，缓存文件名改为 `<md5(路径)>__<size>__<fit>__<mtime>-<bytes>.jpg`，
  预览图同理。命中条件从「比源文件新」变成「文件名完全一致」，与写入先后无关；
  旧的无指纹缓存不再匹配，由下次启动 sweep 回收（升级后缩略图会重新生成一遍）。
- `server/services/image.js`：4 处 `cacheStat.mtime > fileStat.mtime` 判断全部删除
  （缩略图 / 视频缩略图 / DICOM 缩略图 / 预览图）；所有 `getCacheKey` 调用都传入
  `fs.stat()` 结果。
- `server/services/cache.js`：`removeSourcesCache()` 现在也清 `cache/previews`
  （删文件后预览图立刻回收，不必等 sweep）；`enforceCap()` 淘汰时顺带删 `.broken` 标记。
- 客户端新增 `client/src/utils/mediaUrl.js` 的 `mediaVersion(item)`（= `mtime-size`），
  拼进缩略图 / 预览图 / 原图的 URL（`&v=`）。文件内容一变 URL 就变，浏览器必须重取；
  文件没变 URL 不变，缓存照常命中。覆盖 `ImageGrid.jsx`、`Lightbox.jsx`（主图、预加载、
  缩略图条、放大叠加的原图、视频、下载）、`App.jsx`（新标签页打开、复制图片）。
- 单测新增 `tests/cacheKeys.test.js`（7 项）与 `tests/mediaUrl.test.mjs`（5 项），
  均含「同名文件替换且 mtime 更旧」的回归用例；`npm test` 现为 12 个文件 96 项。

验证：隔离实例 E2E 21/21 —— 用 A 生成缓存后，用 B 覆盖 `a.jpg` 并把 mtime 回拨到 2020 年，
同一 URL 的缩略图 / 预览图 / 原图内容与 ETag 全部更新；带旧 ETag 条件请求回 200（不是 304），
带当前 ETag 回 304；新旧两份指纹缓存互不覆盖；浏览条目的 size/mtime 变化使客户端版本号变化。

## 2026-10-17（移除内置令牌鉴权：改由前置反向代理负责）

起因：令牌方案要求带 `?token=` 打开，用户在 PicViewer 前面已经部署了 Authentik，
这个内置令牌既多余又和前置登录冲突，正常访问反而被 401 挡住。

- 删除 `server/security/auth.js`（令牌生成/持久化/Cookie/请求校验）与 `tests/auth.test.js`。
- `server/index.js`：去掉鉴权中间件与 `runtime.token`；启动日志不再打印 `?token=`；
  `lanAccess` 现在**只决定监听地址**（`true` → `0.0.0.0`，默认 `127.0.0.1`）。
- `client/src/main.jsx`：去掉地址栏 `?token=` 的清除逻辑。
- `server/middleware/cors.js`：`hostName` 内联到本文件（原来从 auth.js 引），
  允许头里去掉 `X-PicViewer-Token`；判来源时同时认 `Host` 与 `X-Forwarded-Host`
  （代理常把 Host 改写成 `127.0.0.1:port`，这样代理后仍有跨源调用也不会莫名 403）。
- 仍未改变的安全边界：默认只听回环；对外必须是「前置代理 + 防火墙只放行代理来源 IP」。
  `server/data/security.json` 若已生成可直接删掉，代码不再读取它。
- README「局域网 / 远程访问」一节改写为代理部署说明。

## 2026-10-17（安全加固：暴露面 / 崩溃点 / 越权校验）

起因：全工程审计后按用户批准的三组改动实施（只做这三组，其它审计项未动）。

### 组 1：收窄暴露面
- `server/index.js`：**默认只监听 `127.0.0.1`**（以前固定 `0.0.0.0`）。
  需要手机/远程访问时在 `server/config.json` 设 `"lanAccess": true`（或环境变量
  `PICVIEWER_LAN=1`，`PICVIEWER_HOST` 可覆盖地址）；此时监听 `0.0.0.0` 并**强制**
  开启令牌鉴权 —— 不允许「监听公网 + 无鉴权」的组合。
- 新增 `server/security/auth.js`：令牌持久化在 `server/data/security.json`
  （首次启动生成 24 字节 base64url），启动日志打印带 `?token=` 的局域网地址；
  校验通过后种 HttpOnly `SameSite=Lax` Cookie（`<img>` 请求也会带上）。
  本机请求（回环地址 + 本机 Host 同时成立）直接放行，Electron/本机浏览器无需令牌。
- 新增 `server/middleware/cors.js` 替换 `app.use(cors())`：只回显同源、本机回环、
  以及（开启局域网模式时）本机局域网 IP；恶意来源的预检直接 403。
- `client/src/main.jsx`：从地址栏抹掉 `?token=`（截图/分享/Referer 不外泄）。
- 私有数据出库：`.gitignore` 补上 `server/data/{folders,ignored_folders,favorites,security}.json`
  与 `server/cache/`；`git rm --cached` 摘掉已跟踪的 `ignored_folders.json` / `favorites.json`
  （前者历史上提交过 `X:\...\Private\...` 这种真实路径）。

### 组 2：消除进程级崩溃点
- 新增 `server/utils/range.js`：重写 Range 解析。旧实现把 `bytes=-500` 解析成
  `start=NaN` / `Content-Length: NaN`（Node 直接抛错 500），越界也不回 416。
  现在后缀区间、开区间（5MB 分块）、越界 416、多段取第一段、非法忽略都有单测。
- `server/services/image.js`：所有 `createReadStream(...).pipe(res)` 改成 `pipeline` +
  统一错误处理（客户端中途断开不再触发 `ERR_STREAM_PREMATURE_CLOSE` 未捕获异常）。
- `server/routes/download.js`：archiver 补 `error` 监听 + `res.on('close')` 中止打包
  （打包中途失败以前会回 200 + 半截 ZIP）；补上定义了却从未使用的 `MAX_TOTAL_SIZE`
  （>4GB 直接回 413 提示分批）。
- `server/services/dicom.js`：DICOM 头里的 Rows/Columns 是文件内容，旧代码直接
  `Buffer.alloc(rows*columns*4)`（最坏 17GB OOM）。加像素总数上限 2500 万、
  文件大小上限 512MB、像素数据长度校验。
- `server/index.js`：进程级 `uncaughtException` / `unhandledRejection` 兜底
  （单次只记录不退出，10 秒内 5 次才退出，避免 Electron 主进程被一次读失败带走）。
- `server/routes/image.js`：错误映射统一走 `sendError`（headers 已发出时 destroy 而不是
  再 `res.status().json()` 抛 `ERR_HTTP_HEADERS_SENT`）。

### 组 3：越权路径校验全覆盖
- 新增 `server/security/pathGuard.js`：全服务端唯一的路径判定入口
  （normalize + 尾部反斜杠归一 + Windows 大小写折叠 + 分隔符边界），
  `browse.js` / `image.js` 里各自那份拷贝合并到这里。
- `server/routes/actions.js`：`/rotate`、`/explorer`、`/folder-preview` 三条路由以前
  **完全不校验路径**（任意文件读取 / RCE）。现在全部 `isPathAllowed`；
  `/rotate` 还限制可旋转扩展名与 90° 步进；`/folder-preview` 的 `count` 夹到 1..9；
  `/explorer` 由 `exec(模板字符串)` 改成 `spawn('explorer.exe', args)`（不经 shell，
  路径里的引号/`&` 不再能注入命令）。
- `server/routes/folders.js`：新增根目录走 `validateRootCandidate` —— 拒绝磁盘根目录、
  系统目录、相对路径、不存在的路径（以前一条 POST 就能把 `C:\` 加进白名单）。
- `server/routes/image.js`：缩略图 `size` 夹到 16..2048（`size=20000` 曾让 sharp 申请
  约 1.6GB 位图），`fit` 只认 `cover` / `inside`（`server/utils/imageParams.js`，含单测）。
- `electron-main.js`：窗口/托盘地址由 `localhost` 改成 `127.0.0.1`，避免 Windows 上
  先解析到 `::1` 再回退的额外等待。

### 验证
- 单测 94 项全过（新增 pathGuard 14 / range 10 / thumbParams 6 / auth 12 / cors 8）。
- 隔离实例 E2E 58 项全过：默认模式 30（浏览/ETag 304/Range 206/416/缩略图夹紧/CORS/gzip）、
  写接口路径校验 13（rotate/explorer/folder-preview/download 越权 403、加根目录白名单、
  ZIP 正常）、局域网模式 15（无令牌 401、三种令牌通道、图片请求、回环免令牌、401 HTML 页）。
- `npm run build` 通过（`dist/assets/index-DPh59Etu.js 208.02 kB`）。

### 注意
- **升级后第一次启动会生成 `server/data/security.json`**；不开 `lanAccess` 时它不参与鉴权。
- 服务重启后局域网地址中的 token 不变（持久化），手机书签可以一直用。
- 之前如果已经用手机访问，升级后需要重新用带 `?token=` 的新地址打开一次。

## 2026-10-17（大文件 / 网络盘 / 远程访问加载慢 —— 三层优化）

### 第一层：目录元数据 + 并发（网络盘最先卡在这里）
- 新增 `server/utils/metaCache.js`：以「路径 + size + mtime」为 key 的 LRU 元数据缓存
  （默认 2 万条）。文件没变就不再对每张图 `sharp().metadata()` / `ffprobe`，
  网络盘上浏览 = 从「每张图读一遍文件」变成「只 readdir + stat」。
- `server/services/browse.js`：元数据富化从**串行 for 循环**改为 `Promise.all` 并发，
  并发上限 `PICVIEWER_ENRICH_CONCURRENCY`（默认 6）；顺带修了 `videos` 从未排序的 bug。
- 删掉 / 改名的文件下次扫描自然被新路径覆盖，元数据缓存不需要主动失效。

### 第二层：预览图 + 条件请求 + gzip
- 新增 `/api/image/preview?path=&w=`：灯箱不再默认拉原图，而是拉长边受限的 JPEG。
  实测 3902KB的 3840x2160 原图 → 1920 宽预览 484KB（**12%**），单张生成 188ms，
  命中磁盘缓存 6ms。已足够小/已压缩的图（≤500KB 且尺寸不超）直接透传原图。
- 新增 `server/utils/httpCache.js`（`makeEtag` / `isFresh` / `applyFreshness`）：
  原图、预览图、缩略图全部带 ETag + `must-revalidate`，带 `If-None-Match` 直接 **304**。
  以前缓存过期就整份重下，现在只回一个空 304。
- 预览图缓存 `cache/previews/<md5(源路径)>__<长边>.jpg`，接入既有 LRU 管理，
  默认上限 2048MB（`cache.previewMaxMB`）。
- `server/middleware/jsonCompression.js`：`/api/*` 的 JSON 开了 gzip
  （实测目录列表 42841B → 4025B，**9%**）。内网千兆下收益有限，但远程访问时很值。
- `server/index.js` 设 `keepAliveTimeout=65s` / `headersTimeout=66s`：
  省掉远程访问每张图重新握手的开销。

### 第三层：客户端按需加载
- `useApi.js` 新增 `getPreviewUrl()`；`Lightbox.jsx` 主图改用按屏幕算出来的预览尺寸
  （`getPreviewEdge()`：手机 1280 / 桌面 1920 / 高分屏 2560~4096）。
- **只有放大超过 1.25x 才叠加上原图**（绝对定位的 `lightbox-image-detail`，加载完才淡入），
  没放大就一直是预览图，切图不会再为「可能根本不会放大的原图」买单。
- 预加载也改成预加载预览图；预览图加载失败自动回退原图。
- `previews` 与缩略图一样进 Service Worker 运行时缓存，重复查看不再走网络。

### 测试
- 新增 `tests/metaCache.test.js`（8）、`tests/httpCache.test.js`（8）、
  `tests/jsonCompression.test.js`（9）、`tests/previewParams.test.js`（4），
  连同上一轮的 15 项，`npm test` 共 **44 项全通过**。
- 隔离实例 E2E（`PORT=18101` + 临时 `PICVIEWER_DATA_DIR`，不会污染真实缓存）：
  **32 项断言全通过** —— gzip 9%、预览 12% 体积、w 参数夹紧、四种资源 ETag 304、
  Range 206 且带 Cache-Control、小图透传、预览缓存落盘。
- `npm run build` 通过（`dist/assets/index-0VgoBaEZ.js 207.78 kB`）。
- 环境注意：`server/cache/` 在 DSH 沙箱里不可写，所以凡是要 `require` 到
  `services/cache` 的测试都会在 `ensureDir` 处 EPERM；`ensureDirs` 已改成容错 +
  预览图落盘失败不影响响应，测试也因此能在沙箱里跑。

### 没做的（按需再说）
- 公网鉴权（当前服务监听 0.0.0.0 且无任何认证，暴露到公网等于谁都能看）。
- 传输层压缩/协议升级（HTTP/2、Brotli、WebP/AVIF 预览），收益远小于上面三层。

## 2026-10-15（浏览时自动刷新 + 灯箱切换卡顿修复）

### 需求 1：浏览时按频率刷新，新图片自动出现在列表里
- `client/src/App.jsx`：新增 5 秒轮询（`AUTO_REFRESH_MS`），只对普通文件夹生效
  （搜索结果与「展平」递归模式不轮询）；标签页不可见时暂停；从后台切回立即刷一次。
- 慢速目录自适应退避：一次扫描耗时越长，下次间隔越大（上限 60 秒，`AUTO_REFRESH_MAX_MS`），
  避免把网络/映射盘读爆；一旦发现列表有变化立刻回到 5 秒。
- `client/src/hooks/useApi.js` 新增 `refreshBrowse()`：静默刷新（不置 `loading`、
  失败不弹错误、不整体替换数据）；轮询故意不带 `details=1`（否则服务端会对每张图跑
  sharp 读元数据，网络盘上等于整目录重读一遍）。
- 新增 `client/src/utils/mergeBrowse.js`：增量合并新旧列表 —— 未变化的条目沿用原对象引用
  （React key 稳定 → 缩略图不重挂载、不丢滚动位置和选中状态），完全无变化时返回 `null`
  连 `setState` 都不做。
- 灯箱打开期间列表在变：改为按 **path** 记住当前查看的文件（而不是数字下标），
  新图插入到前面时不会串图；正在看的文件被删掉时就近停住而不是关掉灯箱。

### 需求 2：打开大图后切换几张贴别慢
- 根因一（灯箱缩略图条）：原来一次性渲染全目录的缩略图 DOM，每次切换还会
  `scrollIntoView` 把更多 `loading="lazy"` 的缩略图带进视口，每个都是一次
  128px 全量解码（尺寸与网格档位都不同 → 缓存全部未命中）。
  现改为**窗口化渲染**（当前项前后各 48 张，按 24 张步进），未渲染部分用占位元素撑住
  滚动宽度：`Lightbox.jsx` 新增 `getThumbWindow()` / `.lightbox-thumb-spacer`。
- 根因二（预加载形同虚设）：旧实现 `new Image()` 建完就丢引用，解码位图随时可能被回收。
  现用 `preloadedImages`（Map，路径 → Image）持有引用，并记录 `readyPaths`：
  切到已预加载的相邻图直接显示，**不再先闪一下加载动画**（旧代码无条件 `setLoaded(false)`）。
  离开窗口的预加载图片会释放，集合有上限（`MAX_READY_PATHS = 800`）。
- 根因三（服务端被缩略图洪泛拖死）：缩略图生成没有任何并发上限，
  实测 129 个缩略图同时强制重生成时，一个原图请求要等 **509/504ms**；
  加 3 并发上限后降到 **11/6ms**。
  新增 `server/utils/limiter.js`（FIFO 并发限制器）+ `server/services/image.js` 的
  `generateThumbnail()`：同 cacheKey 的并发请求共享同一次生成，上限可用
  `PICVIEWER_THUMB_CONCURRENCY` 覆盖（默认 3，视频抽帧同样受限）。
- 缩略图与原图加 `decoding="async"`，减少主线程解码卡顿。

### 测试
- 新增 `tests/limiter.test.js`（5 项）、`tests/mergeBrowse.test.mjs`（10 项），
  `npm test` 直接以进程内模式运行这两个文件（沙箱/CI 下避免 node 测试运行器 spawn 子进程）。
- `npm run build` 通过；隔离实例（`PORT=18099` + `PICVIEWER_DATA_DIR` 指向临时目录）
  实测 `/api/browse`、`/api/image/thumbnail`（cover/inside/命中缓存）、`/api/image/view` 均正常。

## 2026-08-11（iOS 全屏 PWA 安全区修复）

### 问题
- iPhone/iPad 添加到主屏幕全屏打开时，顶部顶栏被状态栏（时间/信号）遮挡且无法点击
- 侧边栏头部被遮挡、位置错乱（`--topbar-height: auto` 导致 `calc()` 失效）
- 灯箱顶栏被遮挡，且按钮过多横向溢出显示不全

### 修复
- `index.css` 新增 safe-area 变量 `--sat/--sab/--sal/--sar`（`env(safe-area-inset-*)`，桌面为 0）
- 移除 ≤480px `--topbar-height: auto` 覆盖（使 `calc(var(--topbar-height) + var(--sat))` 恢复有效）
- 主界面：顶栏/侧边栏头部/底栏/操作栏/缩放提示全部接入安全区 padding
- 灯箱：顶栏/缩略图条/提示条/信息面板接入安全区 padding
- 灯箱顶栏移动端改两行布局（文件名行 + 按钮行，按钮右对齐 + 横向滚动兜底）
- 修复多处媒体查询覆盖规则丢失 safe-area padding 的问题

## 2026-07-18（移动客户端 + 触摸优化）

### PWA 可安装应用
- 创建 `manifest.json`：应用名、图标、全屏模式、主题色
- 创建 `sw.js`：Service Worker 静态资源缓存 + API 网络优先策略
- `index.html` 添加 Apple 移动端 meta 标签（`apple-mobile-web-app-capable` 等）
- `main.jsx` 注册 Service Worker
- 使用 sharp 从 SVG 自动生成 192px / 512px PNG 图标
- 脚本 `npm run generate-icons` 可重新生成图标

### Capacitor 原生打包
- 安装 `@capacitor/core` + `@capacitor/cli`
- 创建 `capacitor.config.json`：App ID、启动图、安全策略
- `package.json` 添加全套构建脚本：
  - `capacitor:add:android` / `capacitor:add:ios`
  - `capacitor:build:android` / `capacitor:build:ios`
  - `capacitor:sync`

### 触摸体验全面升级
- Apple HIG 标准：全局 `min-height: 44px` 触摸目标
- Topbar 全面放大：hamburger 44×44、视图按钮 38×38、搜索栏 40px 高
- Lightbox 按钮 44×44、导航箭头 48×72、缩略图 52×52
- 图片网格卡片字体 14px、复选框 24×24、文件夹项 15px
- 列表项 padding 加大、右键菜单项 15px
- 侧边栏宽度 280px、移除按钮始终可见
- Vite `host: '0.0.0.0'` 允许手机局域网访问

### 设计系统升级
- 色彩体系重构：暗色 `#0c0c0e`、accent `#5b8def`（低饱和蓝灰）
- 字体栈升级：`'Segoe UI', 'SF Pro Display', system-ui`
- 等宽字体：`'Cascadia Code', 'JetBrains Mono', 'Fira Code'`
- Z-index 变量化：`--z-sidebar`、`--z-lightbox`、`--z-context-menu`
- 全局交互状态：`:hover` / `:active`(scale) / `:focus-visible`(2px ring)
- 阴影色调化：带 accent 色调的复合阴影
- 100vh → 100dvh（iOS Safari 视口兼容）
- 标题改为 sentence case（移除 `text-transform: uppercase`）

## 2026-07-11（下午 — 全面优化）

### 新功能
- 忽略文件夹：拖拽添加，浏览/搜索自动跳过
- 全量搜索 API：遍历所有配置文件夹，350ms 防抖
- 收藏夹：右键/灯箱工具栏添加，侧边栏展示，点击跳转目录
- 全局快捷键：Ctrl+F 搜索、F5 刷新、Ctrl+A 全选
- 灯箱图片预加载：前后各 2 张，翻页秒显
- 灯箱图片旋转：↺↻ 按钮 + R/L 键，90° 递增
- 幻灯片速度调节：1s/3s/5s/10s 下拉菜单，键盘 1-4
- 缩略图尺寸滑块：120-500px，偏好保存 localStorage
- 目录刷新按钮：F5 + 🔄 按钮
- 搜索结果文件夹入口：↗ 按钮一键跳转
- 文件夹预览图 API：/api/actions/folder-preview
- 在文件管理器中打开：服务端 explorer /select,
- 复制图片到剪贴板：右键菜单

### UI 美化
- 侧边栏全面翻新：选中态左侧色条、子目录树状缩进线、面板化布局
- 数量徽章：My Folders (3)、Ignored (2)、Favorites (5)
- 忽略区域可折叠，拖拽自动展开
- 面包屑移动端横向可滚动
- 视图模式图标：QingIcon grid/waterfall/list/all.svg 替换 Unicode 字符
- 网站图标：QingIcon picture_fill.svg
- 侧边栏 Logo + Root 图标：QingIcon house/picture.svg 替换 emoji
- 面包屑 span → button 可访问性修复
- 右键菜单增强：分割线 + 快捷键提示

### Bug 修复 & 安全
- 路径遍历安全漏洞：startsWith(root) → startsWith(root + path.sep)
- 数据竞争：writeData/writeIgnored 改为原子写入（tmp → rename）
- isIgnored 性能：每次调用读磁盘 → 预读一次共享
- 灯箱缩略图条：全分辨率 getImageUrl → 128px getThumbnailUrl
- 递归浏览 fast 模式：跳过 sharp/ffprobe 元数据提取
- 批量下载 GET URL 过长 → POST + Blob，加 200 文件限制 + 重名去重
- 端口重试无上限 → MAX_RETRIES=100
- FolderTree 拖拽异步竞态 → dragId useRef
- Vite 代理端口硬编码 3456 → 动态读取 config.json
- IgnoredFolders useApi 函数定义顺序 TDZ 错误
- 删除死代码：FOLDER_EXTENSIONS、searchImages 存根
- 全部模式切换目录 → 自动切回网格模式

## 2026-07-11（上午）
- 修复 config.json 损坏导致的启动端口乱码问题
- start.bat 改为 Node.js 解析 JSON，移除交互式端口询问
- 新增 ffmpeg 视频转码: AVI/WMV/MKV/MOV/FLV 等自动转为 H.264 MP4
- 转码结果缓存到 cache/transcodes/，支持 Range 请求
- 新增视频真实缩略图 (ffmpeg 提取第 1 秒帧)，降级 SVG 占位符
- 视频加载时显示"正在处理视频..."旋转提示
- 新增三种视图模式切换器: 网格 ⊞ / 瀑布 ▥ / 列表 ☰
- 瀑布流保持图片原始宽高比 (fit=inside + object-fit:contain)
- 列表模式显示尺寸、格式等详细信息
- 响应式缩略图尺寸 (桌面/平板/手机三档)
- 新增"全部"模式 ⊡: 递归遍历子目录展示所有媒体
- 全部模式每张卡片标注来源子目录
- 修复 ImageGrid.css 残留行导致的 CSS 构建警告
- 更新 README.md

## 2026-07-05
- 开始项目初始化
- 确定技术方案: Express + Vite + React
- 完成基础浏览功能 (文件夹/图片/灯箱)
