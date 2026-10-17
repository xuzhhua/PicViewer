# PicViewer - 进度日志

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
