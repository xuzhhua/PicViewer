# PicViewer - 进度日志

## 2026-07-11
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
