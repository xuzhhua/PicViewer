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

### 文件管理 & 移动端
- 🗑️ **删除到回收站** — 右键 / 灯箱 / 多选三入口删除图片与视频，删除前二次确认，文件移入系统回收站（可恢复），并自动清理失效收藏。网络盘/映射盘没有系统回收站，这类位置会再弹一次「永久删除、无法恢复」的确认后才删除
- 🖼️ **刷新缩略图** — 手动强制重新生成某项缩略图，可修复损坏或过期的缩略图
- ☝️ **长按菜单（移动端）** — 手机上长按图片/视频即弹出操作菜单，与桌面右键一致
- 🧹 **缓存自动管理** — 缩略图/转码缓存有容量上限（LRU 淘汰），启动时清理孤儿缓存，删除文件时同步清除其缓存
- ✅ **单击多选** — 网格/列表勾选框单击即可选中；桌面亦可用 Ctrl+A / Ctrl+点击
- 📱 **移动端精简** — 手机端自动隐藏桌面专属操作：批量下载、在文件管理器中打开、复制路径/图片、快捷键提示

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
- ✅ iOS 全屏适配（顶栏/侧边栏/灯箱自动避开状态栏与 Home 条）
- ✅ 触屏交互 — 长按弹出操作菜单、单击勾选多选、删除到回收站

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

## 🪟 Windows 桌面客户端（Electron）

将 PicViewer 编译为独立的 Windows `.exe` 桌面程序，无需浏览器。

### 快速启动

```bash
npm run setup          # 安装所有依赖（含 Electron）
npm run build          # 构建前端
npm run electron:dev   # 启动桌面客户端
```

### 桌面版特性

| 特性 | 说明 |
|------|------|
| **原生窗口** | 独立窗口、最小化到系统托盘、窗口大小/位置记忆 |
| **系统托盘** | 右键菜单：显示窗口 / 打开浏览器 / 退出 |
| **关闭到托盘** | 点击 ✕ 最小化到托盘而非退出 |
| **Electron 外壳** | 内嵌 Chromium，和浏览器版功能完全一致 |

### 编译为安装包

```bash
npm run electron:dist:win    # Windows → dist-electron/PicViewer Setup x.x.x.exe
npm run electron:dist:mac    # macOS   → dist-electron/PicViewer-x.x.x.dmg
npm run electron:dist:linux  # Linux   → dist-electron/PicViewer-x.x.x.AppImage
```

> 打包需在目标平台执行（Windows 上打 Windows 包，macOS 上打 macOS 包）。

> 安装包只包含代码与构建产物：`server/cache/`（缩略图/转码缓存，可能达数 GB）和 `server/data/*.json`（各用户自己的根目录/收藏/忽略列表）都会被排除。这些文件在首次运行时自动生成，因此换机器/重装不会带走旧配置。

> 打包版把可变数据放在 asar 之外的可写目录（`app.getPath('userData')`，Windows 上是 `%APPDATA%\PicViewer`）：
> `cache/`（缩略图与转码）、`data/`（根目录/收藏/忽略列表）、`config.json`（首次运行从内置默认复制一份，之后可直接编辑）。
> 这是必要的：安装包内的 `app.asar` 是**只读**的，写在那里会导致缩略图无法缓存、无法添加根文件夹。
> 从源码运行（`npm start` / `start.bat`）时这些数据仍留在 `server/` 下，行为不变；可用环境变量 `PICVIEWER_DATA_DIR` 手动指定位置。

### 架构

```
┌─ Electron Main Process ────────────────┐
│  electron-main.js                       │
│  ├─ 启动 Express 服务 (复用 server/)     │
│  ├─ 创建 BrowserWindow                  │
│  ├─ 系统托盘 + 关闭到托盘               │
│  └─ 窗口状态持久化                       │
├─ Express Server (server/index.js) ──────┤
│  图片/视频/搜索/DICOM API                │
├─ BrowserWindow ─────────────────────────┤
│  加载 http://localhost:{port}           │
│  React 前端 (client/dist/)              │
└─────────────────────────────────────────┘
```

### 文件结构（新增）

```
PicViewer/
├── electron-main.js        # Electron 主进程入口
├── package.json            # 含 electron 脚本 + electron-builder 打包配置
└── dist-electron/          # 打包输出目录（gitignore）
```

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express |
| 桌面客户端 | [Electron](https://www.electronjs.org/)（Windows/macOS/Linux） |
| 缩略图 | [sharp](https://sharp.pixelplumbing.com/) |
| DICOM | [dicom-parser](https://github.com/cornerstonejs/dicomParser)（.dcm 医学影像解析与转换） |
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
{ "port": 18093 }
```

> 打包版（Electron）读取的是 `%APPDATA%\PicViewer\config.json`（首次运行自动从内置默认复制，可直接编辑）；源码运行读 `server/config.json`。

### 根文件夹
网页界面管理（侧边栏 `+`），数据保存在 `server/data/folders.json`。

### 缓存上限
缩略图、预览图与视频转码缓存在 `server/cache/`，默认上限 1024 MB / 2048 MB / 2048 MB，超出后按最近最少使用淘汰：

```json
{ "port": 18093, "cache": { "thumbnailMaxMB": 1024, "transcodeMaxMB": 2048, "previewMaxMB": 2048 } }
```

服务启动时会自动清理孤儿缓存（源文件已删除/改名/移动，或根文件夹已移除），之后每 6 小时再检查一次。

三种添加方式：✏️ 手动输入 / 📁 系统选择器 / 🖱️ 拖拽

### 局域网 / 远程访问（默认关闭）
出于安全考虑，**服务默认只监听 `127.0.0.1`**，只有本机能访问。要让手机/平板/反向代理访问，在 `server/config.json` 里打开：

```json
{ "port": 18093, "lanAccess": true }
```

重启后监听 `0.0.0.0`，启动日志会打印本机地址：

```
LAN access:  http://192.168.1.5:18093
局域网访问已开启（监听 0.0.0.0）。本服务不含账号体系——对外访问请走前置反向代理（Authentik 等），并只放行代理来源地址。
```

- 环境变量覆盖：`PICVIEWER_LAN=1` 开、`PICVIEWER_LAN=0` 关、`PICVIEWER_HOST` 指定监听地址。
- **本服务没有账号体系，也不打算有。** 对外访问请把 Authentik / Nginx / Traefik 等反向代理放在前面做登录，并且最好在 Windows 防火墙里把该端口只放行给代理的来源 IP，不要让 `0.0.0.0` 的端口直接暴露到公网。
- 代理后常见配置：转发到 `http://127.0.0.1:18093`（代理与本机同机，此时连 `lanAccess` 都不用开），或 `http://192.168.1.5:18093`（代理在别的机器上）。`Host` 保留或改写都行，CORS 同时认 `Host` 和 `X-Forwarded-Host`。
- 早期版本用 `?token=` 访问令牌，现已移除（会和前置登录冲突）。`server/data/security.json` 若存在可直接删除。

### 忽略文件夹
侧边栏底部 `🚫 已忽略` 区域 → 拖拽或手动添加路径，浏览/搜索自动跳过。

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
| `Delete` | 删除当前项（确认后移入回收站） |
| `Esc` | 关闭 |
| 双击 | 切换 1x ↔ 2x |

## 📁 项目结构

```
PicViewer/
├── start.bat
├── LICENSE                    # MIT 许可证全文
├── package.json
├── electron-main.js          # Electron 桌面客户端主进程
├── server/
│   ├── index.js               # Express 入口（支持 import 和 standalone）
│   ├── paths.js               # 可变数据位置（缓存/数据/配置；支持 PICVIEWER_DATA_DIR）
│   ├── config.json            # 端口 + 缓存上限配置
│   ├── routes/
│   │   ├── folders.js         # 文件夹 CRUD + 系统选择器
│   │   ├── browse.js          # 目录浏览 + 递归浏览
│   │   ├── image.js           # 图片/视频流 + 缩略图
│   │   ├── download.js        # 批量下载 ZIP
│   │   ├── delete.js          # 删除文件（移入回收站；网络盘回退为永久删除）
│   │   ├── ignored.js         # 忽略文件夹
│   │   ├── search.js          # 全量搜索
│   │   └── actions.js         # 收藏/旋转/资源管理器
│   ├── services/
│   │   ├── browse.js          # 文件系统扫描 + 安全校验
│   │   ├── image.js           # sharp 缩略图 + ffmpeg 转码
│   │   └── cache.js           # 缓存命名/登记/孤儿清理/容量上限（LRU）
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
            ├── ConfirmDialog    # 通用确认弹窗（删除等确认）
            ├── AboutDialog      # 关于 / 许可证 / 版权声明
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
| `GET` | `/api/image/view?path=` | 流式传输原文件（支持 Range，带 ETag） |
| `GET` | `/api/image/thumbnail?path=&size=&fit=&refresh=1` | 缩略图（`refresh=1` 强制重新生成；`size` 夹紧到 16~2048） |
| `GET` | `/api/image/preview?path=&w=` | 灯箱预览图（长边夹紧到 320~4096，默认 1920，落盘缓存） |
| `GET` | `/api/download?paths=` | 批量 ZIP 下载 |
| `POST` | `/api/download` | 批量 ZIP 下载（POST 大列表） |
| `POST` | `/api/delete` | 删除文件（移入系统回收站）body `{ paths: [], permanent?: boolean }`；不支持回收站的位置在响应 `needsPermanent` 中返回，确认后需带 `permanent: true` 重发 |
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
`.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.svg` `.tiff` `.tif` `.ico` `.avif` `.heic` `.heif` `.dcm`

> `.dcm` (DICOM) 医学影像格式：服务端自动解析像素数据并转换为 JPEG 显示。支持 MONOCHROME1/2、RGB、YBR_FULL 等 photometric interpretation，自动窗宽窗位调整。

### 视频
`.mp4` `.webm` `.mov` `.mkv` `.avi` `.wmv` `.flv` `.m4v` `.mts` `.m2ts`

## 📝 许可证

本项目以 **MIT License**（`MIT`）发布。

Copyright (c) 2026 xuzhhua

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

完整协议文本见 [LICENSE](./LICENSE)。要点：

- 你可以自由使用、修改、分发、商用、闭源再发布本软件，**唯一的义务是保留版权声明和许可声明**（在源码或打包产物中包含 `LICENSE` 即可，Electron 打包配置已经带上）。
- 没有「必须开源修改版」的要求，也没有 AGPL/GPL 那种「对外提供网络服务须提供源码」的义务。
- 本软件按「现状」提供，不附带任何明示或默示担保，作者不对使用后果负责。
- 界面左下角的「ⓘ 关于」按钮展示版本、版权与 MIT 许可声明，并给出许可全文与源码仓库地址（非强制，纯属方便使用者）。
- 第三方依赖分别遵循其自身许可（MIT / ISC / Apache-2.0 等），与 MIT 均兼容；`sharp` 是 Apache-2.0，保留其声明即可。


