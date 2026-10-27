# AI 生成信息分页 —— 设计

日期：2026-10-27
状态：已获用户口头批准（实现中）
范围：Lightbox「详细信息」面板新增「AI 信息」分页 + 服务端元数据解析

## 问题

PicViewer 只展示图片本身的技术元数据（尺寸、格式、色彩空间等）。对 AI 生成的图片，用户最需要的信息是**提示词和生成参数**——现在它们埋在 PNG 的 `tEXt` 块 / JPEG 的 EXIF `UserComment` 里，只能靠 `exiftool` 之类的工具在命令行里翻。

ComfyUI、Stable Diffusion WebUI（A1111）等工具都会把参数写进这些字段，格式各不相同：

- ComfyUI：`prompt` / `workflow` 两个 JSON 块。`prompt` 是 API 格式的节点图，提示词要先从采样器的 `positive`/`negative` 输入顺着链接追到编码器节点才能拿到；JSON 里还带非标准的 `NaN`（标准 `JSON.parse` 直接抛错）。
- A1111：一个 `parameters` 文本块，`正向提示词\nNegative prompt: 反向提示词\nSteps: 20, Sampler: ..., CFG scale: ...`。
- JPEG：EXIF `UserComment`（0x9286，带 `UNICODE` 前缀）或 XMP。
- WebP：`EXIF` / `XMP ` chunk。

## 目标

1. 打开灯箱 → 详细信息 → 若图片带 AI 元数据，出现「AI 信息」分页。
2. 分页里：正向提示词、反向提示词、生成参数、原始元数据（折叠），每项可复制，另有「复制全部」。
3. 中文等非 ASCII 提示词完整保留，换行不丢。
4. 解析失败/没有元数据 → 不出分页，不报错，普通照片完全不受影响。
5. 不整文件读入内存：只读文件头部，网络盘上也不能为了一个面板拖几十 MB。

## 非目标

- 不解析视频/DICOM。
- 不做提示词翻译、不做图生图溯源、不解析 LoRA 具体权重。
- 不在服务端持久化元数据（进程内 LRU 即可）。

## 架构

### 服务端

新增 `server/services/aiMeta.js`：

```js
async function extractAiMeta(filePath) -> AiMeta | null
```

`AiMeta` 结构（前端只依赖这个，不关心来源工具）：

```js
{
  tool: 'ComfyUI' | 'Stable Diffusion' | 'Unknown',
  positive: string,
  negative: string,
  params: [{ label: string, value: string }],
  texts: [{ label: string, text: string }],   // 其他长文本（如 TextGenerate 节点）
  raw: [{ key: string, text: string }]        // 原始元数据块，含完整 JSON
}
```

**读取策略**（按扩展名分派，全部只读头部）：

| 容器 | 做法 | 停止条件 |
| --- | --- | --- |
| PNG | 8 字节签名后逐 chunk 读 `length/type/data` | 遇 `IDAT` 或 `IEND` |
| JPEG | 从 `SOI` 开始逐段扫描 `marker/length` | 遇 `SOS`（之后是图像数据） |
| WebP | `RIFF` 头 + 逐 chunk | 读满 4MB 或读完 |
| 其他 | 读前 4MB 做文本兜底扫描 | — |

chunk 数据超过累计 8MB 时放弃（防止畸形文件把内存吃满）。

**解析规则**

- ComfyUI（`prompt` 键存在）：
  1. 宽松 JSON：先把裸 `NaN`/`Infinity`/`-Infinity` 替换成 `null` 再 `JSON.parse`，失败再用括号配平截取。
  2. 找采样器节点：`class_type` 匹配 `/Sampler/i` 且有 `inputs.positive`；优先 `KSampler`/`KSamplerAdvanced`/`SamplerCustom`。
  3. 从 `positive`/`negative` 链接递归上溯，收集链上的字符串输入；最长的那段作为提示词，其余进 `texts`。识别不了编码器节点也能用，因为只看字符串。
  4. 参数启发式：`ckpt_name`、`model_name`、`lora_name`、`sampler_name`、`scheduler`、`steps`、`cfg`、`seed`/`noise_seed`、`denoise`、`width`/`height`、`batch_size`。
  5. `raw` 放 `prompt` 与 `workflow` 原文（各截断到 200KB）。
- A1111（`parameters` 键存在）：按 `Negative prompt:` 与 `Steps:` 行切三段；`Steps:` 行按逗号切键值（支持带引号的值）。
- EXIF：`ImageDescription` / `UserComment` / `Software` / `Artist` / `Copyright`；`UserComment` 处理 `ASCII\0\0\0`、`UNICODE\0`、`JIS\0\0\0\0\0` 前缀（`UNICODE` 按 big-endian UTF-16LE 嗅探）。
- 通用：`Description`、`Comment`、`Title`、`Software` 及所有未识别的 tEXt 键 → `raw`。

**缓存**：复用 `server/utils/metaCache.js` 的 LRU（同 path + size + mtime 失效），容量 2000；解析异常不写缓存。

**路由**：`server/routes/aiMeta.js`

```
GET /api/ai-meta?path=<base64url>
200 { hasAI: false }
200 { hasAI: true, tool, positive, negative, params, texts, raw }
400 缺少 path / path 非法
403 不在根目录白名单内（security/pathGuard.isPathAllowed）
404 文件不存在
500 其他
```

挂载：`app.use('/api/ai-meta', aiMetaRouter)`（`server/index.js`）。

### 客户端

- `client/src/utils/clipboard.js`：`copyText(text) → Promise<boolean>`。优先 `navigator.clipboard.writeText`，非安全上下文（局域网 HTTP）回退 `textarea + document.execCommand('copy')`。现有 `App.jsx:331 handleCopyPath` 一并改用它。
- `Lightbox.jsx`：
  - 面板打开时（`showInfo && !isVideo`）请求一次 `/api/ai-meta`，结果按 `path + version` 缓存在 ref 里，切换图片不重复请求。
  - header 下加 tab 条：`信息` / `AI 信息`（仅 `hasAI` 时出现）。
  - AI 分页：正向提示词卡片（右上角复制）、反向提示词卡片、参数两列网格、`<details>` 原始元数据（每项一个复制按钮）、底部「复制全部」（拼成 A1111 风格文本）。
  - 面板 body 继续用 `.info-panel-body` 滚动；tab 与关闭按钮常驻。
- `Lightbox.css`：新增 `.info-tabs/.info-tab`、`.ai-section/.ai-section-head/.ai-copy-btn`、`.ai-prompt`（等宽/保留换行）、`.ai-params`、`.ai-raw details`，移动端 @768/@480 收敛字号与 padding。

## 数据流

1. 用户点「详细信息」→ `showInfo=true`。
2. effect 发现面板打开且当前是图片 → `fetch('/api/ai-meta?path=...')`。
3. 服务端读头部 → 解析 → 归一化 JSON。
4. 前端 `aiMeta` 落 state；`hasAI` 为 true 时渲染 tab。
5. 复制按钮：`copyText` → 成功后按钮文字变「已复制」2 秒。

## 错误处理

- 接口非 200 / 网络失败 → 前端静默（只保留「信息」分页），不弹错。
- 解析抛异常 → 服务端返回 `{ hasAI: false }`，原始文件仍可正常浏览。
- 超大 JSON → `raw` 截断并标注「已截断」。
- 并发：同一 path 的重复请求由前端 ref 缓存吸收；服务端 LRU 天然幂等。

## 测试

`tests/aiMeta.test.js`（node:test，风格同 `tests/metaCache.test.js`）：

1. 合成 PNG（tEXt `parameters`，中文提示词）→ A1111 解析。
2. 合成 PNG（tEXt `prompt`，含裸 `NaN` 的 ComfyUI 图）→ 追到正向/反向文本。
3. 合成 PNG（zTXt/iTXt 压缩块）→ 能解压。
4. 中文多行提示词逐字保留。
5. 无元数据的 PNG → `null`。
6. 真实样本 `D:\Comfy-Desktop\ComfyUI-Shared\output\Media_001.png` 存在时只读断言（取到中文提示词），不存在则跳过。

`package.json` 的 `test` 链追加 `node tests/aiMeta.test.js`。

## 风险

- `execCommand` 已废弃，但仍是局域网 HTTP 下唯一可用路径；失败时按钮提示「复制失败」。
- 超大 `workflow` 让响应变几十 KB——服务端 gzip 已启用（`middleware/jsonCompression.js`）。
- 不同 ComfyUI 自定义节点命名千奇百怪：解析用「找字符串最长的上游」兜底，宁可多收集也不漏。
