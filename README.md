# 🖼️ PicViewer - 本地图片视频浏览器

基于 Web 的本地文件浏览工具，支持局域网共享文件夹和映射驱动器。Node.js + React 构建。

## ✨ 功能特性

- 📂 **文件夹管理** — 支持手动输入、系统原生选择器、拖拽三种方式添加文件夹，兼容 UNC 路径（`\\server\share`）和映射盘符（`Z:\`）
- 🖼️ **图片浏览** — 响应式缩略图网格，通过 `sharp` 按需生成缩略图并缓存
- 🎬 **视频播放** — 支持 `.mp4`、`.webm`、`.mov`、`.mkv`、`.avi` 等格式，使用原生 HTML5 播放器
- 👁️ **灯箱查看器** — 全屏查看，支持缩放、幻灯片、键盘导航、触控滑动
- 🔍 **搜索过滤** — 按文件名实时过滤
- 📱 **移动端适配** — 汉堡菜单、自适应网格、触控手势，手机平板均可使用
- 🌐 **局域网访问** — 服务监听 `0.0.0.0`，局域网内任意设备均可访问
- ⚡ **缩略图缓存** — 生成的缩略图缓存到磁盘，再次访问秒加载
- 🔒 **路径安全** — 仅可访问已配置的根目录，阻止目录穿越攻击

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 缩略图 | [sharp](https://sharp.pixelplumbing.com/) |
| 前端 | React 18 + Vite |
| 样式 | CSS Modules |

## 📋 环境要求

- [Node.js](https://nodejs.org/) 18 及以上
- 推荐 Windows（对 UNC 路径和映射驱动器支持最好），macOS / Linux 也可用

## 🚀 快速开始

```bash
# 1. 安装依赖
npm run setup

# 2. 构建前端并启动服务
npm run build
npm start

# Windows 用户也可以直接双击 start.bat
```

浏览器打开 `http://localhost:3456`。

## 📦 开发模式

```bash
# 同时启动后端和前端开发服务器，支持热更新
npm run dev
```

开发时 Vite 会自动将 `/api` 请求代理到 Express 后端。

## ⚙️ 配置

### 端口

编辑 `server/config.json`：

```json
{ "port": 8080 }
```

也可以设置 `PORT` 环境变量。`start.bat` 启动脚本每次会提示输入端口并自动保存。

### 根目录

通过网页界面管理文件夹（点击侧边栏的 `+` 按钮）。数据保存在 `server/data/folders.json`。

三种添加文件夹的方式：

| 方式 | 操作 |
|------|------|
| ✏️ 手动输入 | 在输入框中输入或粘贴路径 |
| 📁 浏览选择 | 点击文件夹图标，弹出系统原生文件夹选择对话框 |
| 🖱️ 拖拽 | 从资源管理器拖拽文件夹到侧边栏 |

### 支持的路径格式

| 格式 | 示例 |
|------|------|
| 本地磁盘 | `D:\照片` |
| 映射驱动器 | `Z:\共享` |
| UNC IP 路径 | `\\192.168.1.100\share` |
| UNC 主机名 | `\\NAS\媒体` |

## ⌨️ 键盘快捷键（灯箱模式）

| 按键 | 功能 |
|------|------|
| `←` `→` | 上一张 / 下一张 |
| `空格` | 切换幻灯片播放（仅图片） |
| `+` `-` | 放大 / 缩小 |
| `0` | 重置缩放 |
| 双击 | 切换 1x / 2x 缩放 |
| `Esc` | 关闭 |

## 📁 项目结构

```
PicViewer/
├── start.bat                  # Windows 一键启动脚本
├── package.json               # 根项目脚本
├── server/
│   ├── index.js               # Express 入口
│   ├── config.json            # 端口配置
│   ├── routes/
│   │   ├── folders.js         # 文件夹增删 + 原生选择器 API
│   │   ├── browse.js          # 目录浏览 API
│   │   └── image.js           # 图片/视频流 + 缩略图
│   ├── services/
│   │   ├── browse.js          # 文件系统扫描
│   │   └── image.js           # sharp 缩略图、视频 Range 流
│   └── data/
│       ├── store.js           # JSON 持久化
│       └── folders.json       # 用户根目录配置（已 gitignore）
└── client/
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx / App.css
        ├── index.css
        ├── hooks/
        │   └── useApi.js      # API 请求封装
        └── components/
            ├── FolderTree     # 侧边栏：文件夹列表、增删、拖拽
            ├── ImageGrid      # 缩略图网格 + 懒加载
            ├── Lightbox       # 全屏查看器（图片 + 视频）
            └── SearchBar      # 文件名搜索
```

## 🔧 API 接口

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/folders` | 获取已配置的根目录列表 |
| `POST` | `/api/folders` | 添加根目录 |
| `POST` | `/api/folders/pick` | 打开系统原生文件夹选择器 |
| `DELETE` | `/api/folders/:id` | 移除根目录 |
| `GET` | `/api/browse?path=` | 浏览目录（返回子文件夹 + 媒体文件） |
| `GET` | `/api/image/view?path=` | 流式传输原始文件（图片或视频，支持 Range） |
| `GET` | `/api/image/thumbnail?path=&size=` | 生成/获取缩略图 |

## 📄 支持的文件格式

### 图片
`.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.svg` `.tiff` `.tif` `.ico` `.avif` `.heic` `.heif`

### 视频
`.mp4` `.webm` `.mov` `.mkv` `.avi` `.wmv` `.flv` `.m4v` `.mts` `.m2ts`

## 📝 许可证

MIT
