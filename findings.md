# PicViewer - 技术发现与研究

## 项目决策记录

### 技术选型
- **后端**: Express.js - 成熟稳定，Node.js 原生支持 Windows UNC 路径和映射盘符
- **缩略图**: sharp - 高性能 Node.js 图片处理库，支持流式处理
- **前端**: Vite + React - 快速开发体验，React 生态丰富

### Windows 路径处理
- UNC 路径 (`\\server\share`) 和映射盘符 (`Z:\`) 在 Node.js 的 `fs` 模块中均原生支持
- 需要注意路径分隔符统一使用 `path.sep`
- 安全: 必须做路径遍历防护，防止 `../` 越权访问

### API 设计
- 文件夹路径通过 Base64 编码传递以避免特殊字符问题
- 缩略图按需生成并缓存到本地目录
