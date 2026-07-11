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
- 灯箱缩略图条用 128px 缩略图而非全分辨率
- 灯箱图片预加载前后各 2 张
- CSS `content-visibility: auto` 虚拟滚动
- 递归浏览 fast 模式跳过 sharp/ffprobe

### 安全加固
- `isPathAllowed()` 必须检查 `normalized === rootNorm || normalized.startsWith(rootNorm + path.sep)`
- 服务端 `explorer /select,` 而非浏览器 `file://` 协议
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
