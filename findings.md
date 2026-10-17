# PicViewer - 技术发现与研究

## 项目决策记录

### 技术选型
- **后端**: Express.js - 成熟稳定，Node.js 原生支持 Windows UNC 路径和映射盘符
- **缩略图**: sharp - 高性能 Node.js 图片处理库，支持流式处理、cover/inside 两种缩放模式
- **视频处理**: ffmpeg - 用于不兼容格式转码 (AVI→MP4) 和视频帧提取缩略图
- **前端**: Vite + React - 快速开发体验，React 生态丰富
- **图标**: QingIcon - 统一矢量图标体系，替换所有 emoji 和 Unicode 字符

### Windows 路径处理
- UNC 路径 (`\\server\share`) 和映射盘符 (`Z:\`) 在 Node.js 的 `fs` 模块中均原生支持
- 需要注意路径分隔符统一使用 `path.sep`
- **安全**: 路径遍历防护必须使用 `startsWith(rootNorm + path.sep)` 而非 `startsWith(rootNorm)`

### API 设计
- 文件夹路径通过 Base64url 编码传递以避免特殊字符问题
- 缩略图按需生成并缓存，缓存 key 包含路径+尺寸+缩放模式
- 视频 Range 请求支持 HTTP 206，默认每次 5MB 分块
- 递归浏览限制最大深度 5 层，fast 模式跳过 metadata 提取
- 全量搜索限制 500 条结果，超限提示细化搜索词
- ZIP 下载限制 200 文件，自动去重文件名（父目录前缀）
- 删除接口：先 `trash()` 移入系统回收站；网络/映射盘没有回收站，`trash()` 必然抛错，这些路径改为在响应 `needsPermanent` 中返回，前端二次确认「永久删除、无法恢复」后再带 `permanent: true` 重发（服务端走 `fs.unlink`）。绝不在未确认的情况下永久删除

### 数据持久化
- 使用 JSON 文件存储配置、忽略列表、收藏夹
- 关键数据采用原子写入（tmp → rename）避免并发竞争
- `readData` 解析失败静默返回 []，避免阻塞启动
- 忽略列表读取后在扫描开始时一次性加载，避免逐文件磁盘 I/O

### 视频处理
- 浏览器不支持 AVI/WMV/MKV/FLV 等容器格式的原生播放
- 解决方案: 服务端 ffmpeg 转码为 H.264+AAC MP4
- 转码结果缓存到 `cache/transcodes/`，key 包含路径+mtime
- 转码参数: `libx264` + `fast preset` + `crf 23` + `movflags faststart`
- 视频缩略图: `ffmpeg -ss 1 -vframes 1` 提取第 1 秒帧
- 降级策略: ffmpeg 不可用时回退到 SVG 占位符 / 直接提供原文件
- `checkFfmpeg` 结果可缓存，避免每次视频请求都 spawn 进程

### 性能优化
- 缩略图磁盘缓存：按路径+尺寸+模式生成 md5 key
- 损坏图片标记：`.broken` 文件避免重复调用 sharp
- **libvips 操作缓存会一直占着源文件句柄**：`sharp(path)` 读完不释放（网络/SMB 盘上尤其明显），导致该文件在进程退出前一直无法删除（`EBUSY`）——表现为「删不掉刚才看过的图」。`sharp.cache(false)` 后立即释放；缩略图本来就有磁盘缓存，关掉操作缓存无损失且内存更平稳
- 灯箱缩略图条用 128px 缩略图而非全分辨率
- 灯箱图片预加载前后各 2 张
- CSS `content-visibility: auto` 虚拟滚动
- 递归浏览 fast 模式跳过 sharp/ffprobe
- **缩略图生成必须限流**（`server/utils/limiter.js`，默认 3，`PICVIEWER_THUMB_CONCURRENCY` 可覆盖）：不限流时一次打开灯箱/滚动就能同时甩出上百个 sharp 解码，把 libuv 线程池占满，**原图请求被排在后面**——实测 129 个缩略图同时重生成时原图首字节 509ms vs 限流后 6ms。同 cacheKey 的并发请求共享一次生成
- **灯箱缩略图条必须窗口化渲染**：全目录渲染 DOM + `scrollIntoView` 会让每张进入视口的 128px 缩略图都触发一次全量解码（128 与网格档位都不同，缓存全不命中）
- **预加载必须持有 Image 引用**（Map 路径→Image）：只 `new Image()` 不保留引用，解码位图可能被回收，等于没预加载。记录已就绪的路径后，切到相邻图可以跳过加载动画（`setLoaded(false)` 不要无条件调用）
- **自动刷新（轮询）不要带 `details=1`**：带上的话服务端对每个文件跑一次 sharp 读元数据，网络盘上等于整目录重读；轮询只需要判断有无新文件，增量合并时未变化条目沿用旧对象引用
- **大文件/网络盘/远程访问慢的三个真正瓶颈**（按影响排序，均已解决）：
  1. 目录扫一遍要对每个文件 `sharp().metadata()` / `ffprobe` —— SMB 上每次都要把整个文件读过来。用「路径+size+mtime」做 LRU 元数据缓存 + `Promise.all` 并发富化（不是串行），文件不变就不再读第二次
  2. 灯箱直接拉原图（3840x2160 / 3~4MB）—— 改成 `/api/image/preview?w=` 拉长边受限的 JPEG，实测 **3902KB → 484KB（12%）**；只有放大超过 1.25x 才叠原图。注意 WebP 编码慢 2.5 倍且对已压缩的 JPEG 源收益很小（实测某张甚至比 JPEG 大 4%），预览图默认用 JPEG
  3. 没有任何条件请求 —— 缓存一过期就整份重下。原图/预览/缩略图都加了 ETag + `If-None-Match` → 304 空响应
- 预览图体积的经验值：2560px JPEG q82 ≈ 原图的 15~41%（取 1920~2560 长边已足够灯箱全屏看）；1080px ≈ 4~7%
- **`server/cache/` 在 DSH 沙箱里不可写**：`services/cache.js` 模块加载时就 `ensureDir`，所以任何 require 到它的测试在沙箱里都会 EPERM。`ensureDirs` 已改为容错（只 warn、不抛），预览图写缓存失败也只是「下次再生成」，不影响响应
- 服务端目前监听 `0.0.0.0` 且**没有任何鉴权**，暴露到公网等于同网段/全网谁都能看。要做远程访问需要先加认证（未实现，用户明确说暂时不用担心）

### 打包（electron-builder）
- `files` 用 `server/**/*` 会连带把**运行时产物**打进安装包，必须显式排除：
  - `!server/cache/**` —— 缩略图/转码缓存，曾达 4.3 GB
  - `!server/data/*.json` —— 各用户自己的根目录/收藏/忽略列表（`folders.json` 里是开发者本机的私有路径，`ignored_folders.json` 甚至带着 `X:\xuzhhua\Private\shoujo\_SYNCAPP`）。这些文件由 `store.js` 在首次读取时自动创建为 `[]`，因此排除后不影响启动
- electron-builder 会**自动剔除 devDependencies**（electron/electron-builder 等），`node_modules/**/*` 其实是默认行为，写不写都一样
- **可变数据必须放在 asar 外**（`server/paths.js`）。electron-builder 默认 `asar: true`，而代码内 `__dirname` 指向 app.asar 内部，**asar 只读** —— 若把 `cache/`、`data/`、`config.json` 写在那里，打包版会表现为缩略图全部退化成占位图、添加根文件夹返回 500。因此 `electron-main.js` 在 require server **之前**把 `PICVIEWER_DATA_DIR` 指向 `app.getPath('userData')`（`server/paths.js` 在模块加载时解析该变量，所以顺序不能颠倒）。未设该变量时 `STATE_ROOT` 回落到 `server/`，从源码运行（`npm start`）行为完全不变
- 打包版首次运行会把 asar 里的 `server/config.json` 复制一份到 userData 作为可编辑的实时配置（asar 里那份用户改不了），这也是 `extraResources` 可以删掉的原因 —— 它当初拷到 `resources/server/config.json` 的位置根本没有任何代码读取
- **构建环境的坑**：electron-builder 从 GitHub 拉 Electron 二进制（约 137 MB）与 nsis/winCodeSign 等工具，在受限网络下 `got` 会以 `Timeout awaiting 'request' for 600000ms` 失败且**在 %TEMP% 留下 0 字节的 `electron-download-*` 暂存目录**（据此可快速判断是卡在下载而非代码问题）。绕过办法：`ELECTRON_BUILDER_BINARIES_MIRROR` 指镜像，并用 `--config.electronDist=<已解压的 Electron 目录>` 完全跳过 Electron 下载（实测 GitHub 454 KB/s vs 镜像 21 MB/s）。注意 `ELECTRON_OVERRIDE_DIST_PATH` 对该版本无效，必须用 `electronDist`

### 缓存管理
- **缓存命名必须带「源路径指纹」前缀** —— `cache/thumbnails/<md5(源路径)>__<size>__<fit>.jpg`、`cache/transcodes/<md5(源路径)>__<mtime>.mp4`。md5 不可逆，旧方案 `md5(路径::尺寸::fit)` 把三者混进一个哈希，导致**无法从缓存文件反推源文件**，因此既做不了「删文件时清缓存」也做不了孤儿清理。前缀化后按前缀即可批量处理
- **`cache/sources.jsonl` 是唯一的反查依据**：追加式登记 `{h: md5(路径), p: 路径}`，启动时压缩重写。孤儿清理靠它逐个 `existsSync` 判断，避免为查孤儿而遍历所有根目录（SMB 上极慢）。进程被强杀最多丢掉尾部登记，代价只是那次缓存文件被当作不可达回收
- **孤儿/不可达判定**：①登记中源文件不存在或已不在任何根目录下 → 删除该前缀全部文件；②文件名不匹配新命名（旧方案遗留）或前缀不在登记中 → 一律回收（旧命名永远无法再命中，属纯占位）
- **容量上限按目录独立**：缩略图默认 1024 MB、转码默认 2048 MB（`config.json` 的 `cache.thumbnailMaxMB` / `cache.transcodeMaxMB`）。转码单文件可达数百 MB，与缩略图共用额度会让一次淘汰误删昂贵的转码结果
- **淘汰按「最近最少使用」**，用 `max(atime, mtime)`；Windows 常关闭 atime 更新，此时退化为「最久未写入」，仍是正确的淘汰端。删除 `.jpg` 时连带删除同名 `.broken` 标记，避免标记与文件状态不一致
- **淘汰需有 60 秒保护期**：刚写入的缓存可能仍在向客户端流式传输，立即删除会打断响应
- 定期维护（6 小时）用 `unref()` 的定时器，不阻止进程退出；`init()` 不阻塞启动

### 安全加固
- `isPathAllowed()` 必须检查 `normalized === rootNorm || normalized.startsWith(rootNorm + path.sep)`
- 服务端 `explorer /select,` 而非浏览器 `file://` 协议

#### 路径白名单：只能有**一个**判定入口
- 这条规则以前在 `browse.js` / `image.js` 各有一份拷贝，`download.js` / `delete.js` 又各写了一遍
  内联版。每加一个路由都要记得再抄一次，抄漏就是洞 —— 实测漏了
  `/api/actions/rotate`、`/api/actions/explorer`、`/api/actions/folder-preview` 三条
  （任意文件读取 + 命令注入）。现在全部走 `server/security/pathGuard.js`。
- 判定细节：先 `path.normalize`，再去尾部反斜杠（`D:\Pics\` ≡ `D:\Pics`），
  Windows 下折叠大小写，子树判定必须带 `path.sep` 边界（否则 `D:\Pics` 会匹配 `D:\Pics2`）。
- 「添加根目录」也必须校验：允许任意路径当根目录 = 白名单形同虚设（一条 POST 就能把
  `C:\` 加进来）。`validateRootCandidate` 拒绝磁盘根、系统目录、相对路径、不存在的路径。

#### 命令执行
- **绝不用 `exec` 拼字符串**。`exec(\`explorer /select,"${path}"\`)` 里路径完全可控，
  一个 `" & calc & "` 就是任意命令执行。改成 `spawn('explorer.exe', [...], {stdio:'ignore'})`
  不经 shell。注意 explorer 需要把 `/select,` 和路径放在**同一个参数**里
  （`['/select,' + p]`），拆成两个参数时带空格的路径会失效。

#### 监听地址与令牌
- 默认 `127.0.0.1`；开 `lanAccess` 才绑 `0.0.0.0`，并且此时**强制**开令牌 ——
  不允许出现「监听公网 + 无鉴权」的组合。
- 图片是普通 `<img>` 加载的，加不了自定义请求头，所以令牌必须能走 Cookie；
  用 `?token=` 打开一次页面 → 服务端种 HttpOnly Cookie → 之后所有请求自动带上。
- 本机判定要**同时**看「连接来源地址是回环」和「Host 是 localhost/127.0.0.1」：
  只看来源地址会让「同机反向代理转发公网流量」被当成内网放行。
- `Access-Control-Allow-Origin: *` + 无鉴权 + `0.0.0.0` = 用户浏览器里任意恶意页面
  都能对 `127.0.0.1:18093/api/delete` 发 JSON POST 删文件（JSON 触发预检，`*` 放行预检）。
  CORS 必须回显同源/本机来源，不能通配。

#### 其它崩溃/DoS 面
- `Buffer.alloc(rows * columns * 4)` 里 rows/columns 来自 DICOM 文件内容：假头
  `65535×65535` = 17GB 分配。任何「用文件内容算缓冲区大小」的地方都必须先夹上限。
- `parseInt(req.query.size) || 256` 直接进 sharp：`size=20000` ≈ 1.6GB 位图。图片参数必须白名单+夹紧。
- 所有 `readStream.pipe(res)` 都要用 `stream.pipeline` 或显式 error 监听：
  否则客户端中途断开 = 未捕获异常（Electron 里就是主进程退出）。
  archiver 同样必须监听 `error`，且此时 headers 往往已发出，只能 `res.destroy()`。
- Range 解析不能手写 `split('-') + parseInt`：`bytes=-500`（后缀区间）会得到
  `start=NaN` → `Content-Length: NaN` → Node 抛错 500。走 `server/utils/range.js` 的纯函数 + 单测。

#### 私有数据不能进仓库
- `server/data/*.json` 里是用户真实磁盘路径、收藏、以及局域网令牌。`ignored_folders.json`
  曾被提交并推送（内容是 `X:\...\Private\...`）。`.gitignore` 必须覆盖全部 data 文件；
  已跟踪的要 `git rm --cached`（注意：这不清理历史，真要清得 rewrite history）。

### 移动客户端
- **PWA**: 首选方案，零配置即可安装到手机主屏幕。manifest.json + Service Worker 实现离线缓存
- **Capacitor**: 用于编译原生 APK/IPA。需要 Android Studio（Android）或 Xcode + macOS（iOS）
- **图标**: 使用 sharp 从 SVG 源文件生成 192px 和 512px PNG，支持 `npm run generate-icons` 重新生成
- **触摸优化**: Apple HIG 44px 最小触摸目标，全局应用 `min-height: 44px`
- **iOS 全屏安全区**: `viewport-fit=cover` + `black-translucent` + `display: standalone` 会让内容延伸到状态栏/刘海后，必须用 `env(safe-area-inset-*)` 避让。封装为 CSS 变量 `--sat/--sab/--sal/--sar`（桌面为 0，不影响桌面布局）
- **安全区陷阱**: ①固定高度顶部容器加 `padding-top` 会挤压内容，需改 `min-height: calc(原高 + var(--sat))` + `height: auto`；②媒体查询覆盖规则（如 ≤480px 重写 padding）会覆盖基础规则的安全区 padding，每个覆盖点都要保留 `var(--sat)/var(--sab)`；③`--topbar-height: auto` 会让 `calc(auto + ...)` 非法被丢弃
- **响应式断点**: 1024px（平板）、768px（手机）、480px（小屏手机）
- **移动端 Topbar**: 面包屑换行独占一行，控件行在上，避免挤压
- **Vite host**: 配置 `host: '0.0.0.0'` 允许局域网内其他设备连接
- 批量下载 POST 替代 GET 避免 URL 长度限制
- 端口重试上限 100 次防止无限递归
- 网格: CSS Grid `repeat(auto-fill, minmax(180px, 1fr))` — 整齐卡片
- 瀑布流: CSS `column-count` (4/3/2 列自适应) — 保持原始比例
- 列表: Flexbox 行布局 — 缩略图 + 文件名 + 尺寸/格式标签
- 全部: 服务端递归 `fs.readdir` 遍历子目录 — 瀑布流 + 来源目录标注

### 响应式缩略图
- 桌面 (≥1201px): 瀑布 600px, 网格 300px, 列表 200px
- 平板 (769-1200px): 瀑布 500px, 网格 300px, 列表 120px
- 手机 (<769px): 瀑布 400px, 网格 250px, 列表 120px
- 通过 `window.innerWidth` + resize 事件去抖 (150ms) 实现

### 启动脚本
- `start.bat` 使用 Node.js 一行命令读取 `config.json` 端口
- 替代了脆弱的 `findstr` + batch 字符串解析
- 不再交互式询问端口，直接使用配置值
