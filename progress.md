# PicViewer - 进度日志

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
