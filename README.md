# 🖼️ PicViewer — 本地图片视频浏览器

基于 Web 的本地文件浏览工具，支持局域网共享文件夹和映射驱动器。Node.js + React 构建。

## ✨ 功能特性

### 浏览体验
- 📂 **文件夹管理** — 手动输入、系统原生选择器、拖拽三种添加方式，支持 UNC / 映射盘符
- 🖼️ **四种浏览模式** — 网格、瀑布流（保持比例）、列表（详细信息）、全部（递归子目录）
- 🔍 **全量搜索** — 遍历所有配置文件夹的实时搜索，结果显示来源目录，一键跳转
- 🎚️ **缩略图尺寸滑块** — 120px ~ 500px 实时调节，偏好自动保存
- 📱 **移动端适配** — 汉堡菜单、自适应网格、触控手势、可滚动面包屑

### 灯箱
- 👁️ **全屏查看器** — 缩放/平移/旋转、触控手势、鼠标拖拽
- 🎞️ **幻灯片播放** — 可调速 1s/3s/5s/10s，空格启停
- ⚡ **图片预加载** — 前后各预加载 2 张，翻页瞬间显示
- 🔄 **旋转** — 90° 递增旋转，R/L 快捷键
- ℹ️ **信息面板** — EXIF + 视频编码信息（I 键切换）

### 视频支持
- 🎬 **多格式播放** — 不兼容格式（.mkv/.avi/.wmv 等）自动 ffmpeg 实时转码 H.264 MP4
- 🎞️ **视频缩略图** — ffmpeg 提取真实帧

### 效率工具
- ⭐ **收藏夹** — 右键或灯箱工具栏添加，侧边栏展示，点击跳转所在文件夹
- 🚫 **忽略文件夹** — 拖拽添加，浏览和搜索时自动跳过
- ⬇ **批量下载** — 多选后 ZIP 打包，自动去重文件名
- 🔄 **目录刷新** — F5 或 🔄 按钮
- ⌨️ **键盘快捷键** — Ctrl+F 搜索、F5 刷新、Ctrl+A 全选、灯箱全套

### 视觉与体验
- 🌗 **深色/浅色主题** — 一键切换
- 🎨 **QingIcon 图标** — 侧边栏、工具栏、视图切换全部使用矢量图标
- 📐 **侧边栏美化** — 选中态左侧色条、子目录树状缩进、折叠面板、数量徽章
- 📱 **移动端适配** — 44px 触摸目标、全尺寸响应式、PWA 可安装

### 移动客户端
- 📲 **PWA 安装** — 添加到手机主屏幕，全屏运行，支持离线缓存
- 🤖 **Android 原生** — Capacitor 打包为 APK
- 🍎 **iOS 原生** — Capacitor 打包为 IPA（需 macOS + Xcode）

## 📱 移动客户端

### 方案一：PWA（推荐，零配置）

将 PicViewer 安装到手机主屏幕，像原生 App 一样全屏运行。

**使用步骤：**

```bash
# 1. 确保手机和电脑在同一 WiFi 网络
# 2. 启动 PicViewer
npm start        # 生产模式：http://<电脑IP>:18093
# 或
npm run dev      # 开发模式：http://<电脑IP>:5173
```

**安装到手机：**

| 平台 | 操作 |
|------|------|
| **Android** | Chrome 打开 → 自动弹出"添加到主屏幕" → 点击安装 |
| **iOS** | Safari 打开 → 点击分享按钮 → "添加到主屏幕" → 确认 |

**PWA 特性：**
- ✅ 全屏运行（隐藏浏览器地址栏和底部导航）
- ✅ 主屏幕图标（192×192 + 512×512）
- ✅ 离线缓存（静态资源缓存在本地，无网络也能打开界面）
- ✅ 自动更新（Service Worker 自动检测新版本）

### 方案二：原生 APK / IPA

将 PicViewer 编译为真正的 Android `.apk` 或 iOS `.ipa` 安装包。

**环境准备：**

| 平台 | 必需工具 |
|------|----------|
| Android | [Android Studio](https://developer.android.com/studio) + Android SDK |
| iOS | macOS + [Xcode](https://developer.apple.com/xcode/) + Apple Developer 账号 |

**编译步骤：**

```bash
cd client

# 1. 安装依赖
npm install

# 2. 构建 Web 前端
npm run build

# === Android ===
npm run capacitor:add:android       # 初始化 Android 项目（仅首次）
npm run capacitor:build:android     # 构建 APK（在 Android Studio 中完成）

# === iOS（仅 macOS）===
npm run capacitor:add:ios           # 初始化 iOS 项目（仅首次）
npm run capacitor:build:ios         # 构建 IPA（在 Xcode 中完成）
```

**Capacitor npm scripts：**

| 命令 | 说明 |
|------|------|
| `npm run capacitor:add:android` | 创建 Android 原生项目 |
| `npm run capacitor:add:ios` | 创建 iOS 原生项目 |
| `npm run capacitor:sync` | 同步 Web 代码到原生项目 |
| `npm run capacitor:build:android` | 构建 + 同步 + 打开 Android Studio |
| `npm run capacitor:build:ios` | 构建 + 同步 + 打开 Xcode |
| `npm run generate-icons` | 重新生成 PWA 图标（需 sharp） |

**配置文件：**
- `client/capacitor.config.json` — Capacitor 项目配置（App ID、启动图等）
- `client/public/manifest.json` — PWA 清单（应用名、图标、全屏模式）
- `client/public/sw.js` — Service Worker（离线缓存策略）

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 缩略图 | [sharp](https://sharp.pixelplumbing.com/) |
| 视频处理 | [ffmpeg](https://ffmpeg.org/)（转码 + 缩略图） |
| ZIP 打包 | [archiver](https://www.archiverjs.com/) |
| 前端 | React 18 + Vite |
| 样式 | 纯 CSS（CSS 自定义属性 + 深色模式） |

## 📋 环境要求

- [Node.js](https://nodejs.org/) 18+
- 视频转码需安装 [ffmpeg](https://ffmpeg.org/) 并加入 PATH
- 推荐 Windows（文件夹选择器、UNC 路径支持最好），macOS / Linux 也可用

## 🚀 快速开始

```bash
npm run setup    # 安装依赖
npm run build    # 构建前端
npm start        # 启动服务
```

或双击 `start.bat`（自动读取 `server/config.json` 端口配置）。

浏览器打开 `http://localhost:18093`。

## 📦 开发模式

```bash
npm run dev      # 后端 + 前端并行启动，Vite 自动代理
```

## ⚙️ 配置

### 端口
编辑 `server/config.json`：
```json
{ "port": 12345 }
```

### 根文件夹
网页界面管理（侧边栏 `+`），数据保存在 `server/data/folders.json`。

三种添加方式：✏️ 手动输入 / 📁 系统选择器 / 🖱️ 拖拽

### 忽略文件夹
侧边栏底部 `🚫 Ignored` 区域 → 拖拽或手动添加路径，浏览/搜索自动跳过。

### 路径格式
| 格式 | 示例 |
|------|------|
| 本地磁盘 | `D:\照片` |
| 映射驱动器 | `Z:\共享` |
| UNC | `\\NAS\媒体` |

## ⌨️ 键盘快捷键

### 全局
| 按键 | 功能 |
|------|------|
| `Ctrl+F` | 聚焦搜索框 |
| `F5` | 刷新当前目录 |
| `Ctrl+A` | 全选 |

### 灯箱
| 按键 | 功能 |
|------|------|
| `←` `→` | 上一张 / 下一张 |
| `空格` | 幻灯片 启/停 |
| `1` `2` `3` `4` | 幻灯片速度 1s/3s/5s/10s |
| `+` `-` | 放大 / 缩小 |
| `0` | 重置缩放 & 旋转 |
| `R` / `L` | 右旋 / 左旋 90° |
| `I` | 切换信息面板 |
| `Esc` | 关闭 |
| 双击 | 切换 1x ↔ 2x |

## 📁 项目结构

```
PicViewer/
├── start.bat
├── package.json
├── server/
│   ├── index.js               # Express 入口
│   ├── config.json            # 端口配置
│   ├── routes/
│   │   ├── folders.js         # 文件夹 CRUD + 系统选择器
│   │   ├── browse.js          # 目录浏览 + 递归浏览
│   │   ├── image.js           # 图片/视频流 + 缩略图
│   │   ├── download.js        # 批量下载 ZIP
│   │   ├── ignored.js         # 忽略文件夹
│   │   ├── search.js          # 全量搜索
│   │   └── actions.js         # 收藏/旋转/资源管理器
│   ├── services/
│   │   ├── browse.js          # 文件系统扫描 + 安全校验
│   │   └── image.js           # sharp 缩略图 + ffmpeg 转码
│   └── data/
│       ├── store.js           # JSON 持久化（原子写入）
│       ├── folders.json       # 根目录配置
│       ├── ignored_folders.json
│       └── favorites.json
└── client/
    ├── package.json
    ├── vite.config.js
    ├── capacitor.config.json    # Capacitor 原生打包配置
    ├── scripts/
    │   └── generate-icons.cjs   # PWA 图标生成脚本
    ├── public/
    │   ├── manifest.json        # PWA 应用清单
    │   ├── sw.js                # Service Worker 离线缓存
    │   └── icons/               # QingIcon SVG + PWA 图标
    └── src/
        ├── App.jsx / App.css
        ├── index.css
        ├── main.jsx             # SW 注册入口
        ├── hooks/useApi.js
        └── components/
            ├── FolderTree       # 侧边栏文件夹导航 + 拖拽排序
            ├── ImageGrid        # 缩略图网格 + 懒加载
            ├── Lightbox         # 全屏灯箱 + 预加载 + 旋转
            ├── SearchBar        # 搜索框
            └── IgnoredFolders   # 忽略文件夹面板
```

## 🔧 API 接口

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/folders` | 根目录列表 |
| `POST` | `/api/folders` | 添加根目录 |
| `POST` | `/api/folders/pick` | 系统原生文件夹选择器 |
| `DELETE` | `/api/folders/:id` | 移除根目录 |
| `PUT` | `/api/folders/reorder` | 拖拽排序 |
| `GET` | `/api/browse?path=` | 浏览目录 |
| `GET` | `/api/browse/recursive?path=&fast=1` | 递归浏览（fast 跳过元数据） |
| `GET` | `/api/image/view?path=` | 流式传输原文件（支持 Range） |
| `GET` | `/api/image/thumbnail?path=&size=&fit=` | 缩略图 |
| `GET` | `/api/download?paths=` | 批量 ZIP 下载 |
| `POST` | `/api/download` | 批量 ZIP 下载（POST 大列表） |
| `GET` | `/api/ignored` | 忽略文件夹列表 |
| `POST` | `/api/ignored` | 添加忽略 |
| `DELETE` | `/api/ignored/:id` | 移除忽略 |
| `GET` | `/api/search?q=` | 全量搜索 |
| `GET` | `/api/actions` | 收藏列表 |
| `POST` | `/api/actions` | 添加收藏 |
| `DELETE` | `/api/actions/:id` | 移除收藏 |
| `GET` | `/api/actions/folder-preview?path=` | 文件夹预览图 |
| `POST` | `/api/actions/rotate` | 旋转图片 |
| `POST` | `/api/actions/explorer` | 在资源管理器中打开 |

## 📄 支持的文件格式

### 图片
`.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.svg` `.tiff` `.tif` `.ico` `.avif` `.heic` `.heif`

### 视频
`.mp4` `.webm` `.mov` `.mkv` `.avi` `.wmv` `.flv` `.m4v` `.mts` `.m2ts`

## 📝 许可证

MIT
