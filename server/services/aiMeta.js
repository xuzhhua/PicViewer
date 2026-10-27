'use strict';

/**
 * AI 生成元数据解析（ComfyUI / A1111 / 通用 EXIF·XMP）。
 *
 * 为什么需要这个模块：AI 工具把提示词和参数写进 PNG 的 tEXt/zTXt/iTXt 块、
 * JPEG 的 EXIF UserComment、WebP 的 EXIF/XMP chunk，格式各工具互不相同。
 * 这里统一读成前端可直接渲染的结构：
 *
 *   { tool, positive, negative, params: [{label,value}],
 *     texts: [{label,text}], raw: [{key,text}] }
 *
 * 两条硬约束：
 *  1) 只读文件头部。网络盘上一张图几十 MB，为了 20 KB 元数据整文件读一遍会让
 *     「详细信息」面板卡住好几秒。PNG 读到 IDAT、JPEG 读到 SOS 就停。
 *  2) 不能相信输入。JSON 里可能有裸 NaN（ComfyUI 的 is_changed）、chunk 长度可能
 *     是天文数字、EXIF 偏移可能越界。所有读取都做边界检查，解析失败返回 null，
 *     绝不让一个坏文件把请求打成 500。
 */

const fs = require('fs').promises;
const zlib = require('zlib');
const { createMetaCache } = require('../utils/metaCache');

const cache = createMetaCache({ maxEntries: 2000 });

const MAX_SCAN_BYTES = 8 * 1024 * 1024;
const MAX_SINGLE_CHUNK = 8 * 1024 * 1024;
const MAX_TEXT = 100000;
const MAX_RAW = 200000;
const MAX_XMP = 50000;

// ---------------------------------------------------------------- 基础工具

/** 读文件指定区间；越界时返回实际读到的部分（调用方自行判断长度）。 */
async function readAt(fh, offset, length) {
  if (offset < 0 || length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  try {
    const { bytesRead } = await fh.read(buf, 0, length, offset);
    return buf.subarray(0, bytesRead);
  } catch (_) {
    return Buffer.alloc(0);
  }
}

/**
 * 文本解码：AI 工具普遍违反「tEXt 只能是 Latin-1」的规范，把 UTF-8 直接塞进去
 * （ComfyUI 的中文提示词就是这样）。先按 UTF-8 解，出现替换字符再退回 Latin-1。
 */
function decodeText(buf) {
  if (!buf || buf.length === 0) return '';
  const utf8 = buf.toString('utf8');
  if (!utf8.includes('\uFFFD')) return utf8;
  const latin = buf.toString('latin1');
  // Latin-1 里再出现替换字符说明数据本身坏了，用 UTF-8 的结果至少还能看
  return latin.includes('\uFFFD') ? utf8 : latin;
}

function countReplacement(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 0xFFFD) n++;
  return n;
}

/** 清掉尾部 NUL / 空白，并保留内部换行（提示词的多行是有意义的）。 */
function cleanText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000+$/g, '').replace(/\r\n/g, '\n').trim();
}

function clamp(text, max) {
  if (typeof text !== 'string') return '';
  return text.length > max ? text.slice(0, max) + '\n…（已截断）' : text;
}

// ---------------------------------------------------------------- PNG

/** 解析单个 PNG 文本 chunk，返回 { key, text } 或 null。 */
function decodePngTextChunk(type, data) {
  try {
    if (!data || data.length < 2) return null;
    const nul = data.indexOf(0);
    if (nul < 1) return null;
    const key = data.subarray(0, nul).toString('latin1');
    if (!/^[\x20-\x7e]{1,79}$/.test(key)) return null;

    if (type === 'tEXt') {
      return { key, text: decodeText(data.subarray(nul + 1)) };
    }

    if (type === 'zTXt') {
      if (data.length < nul + 3) return null;
      const method = data[nul + 1];
      if (method !== 0) return null;
      const inflated = zlib.inflateSync(data.subarray(nul + 2), { maxOutputLength: MAX_SINGLE_CHUNK });
      return { key, text: decodeText(inflated) };
    }

    if (type === 'iTXt') {
      // keyword \0 compFlag(1) compMethod(1) langTag \0 translatedKeyword \0 text
      const flag = data[nul + 1];
      const method = data[nul + 2];
      let pos = nul + 3;
      const langEnd = data.indexOf(0, pos);
      if (langEnd < 0) return null;
      pos = langEnd + 1;
      const transEnd = data.indexOf(0, pos);
      if (transEnd < 0) return null;
      pos = transEnd + 1;
      let body = data.subarray(pos);
      if (flag === 1) {
        if (method !== 0) return null;
        body = zlib.inflateSync(body, { maxOutputLength: MAX_SINGLE_CHUNK });
      }
      return { key, text: decodeText(body) };
    }
  } catch (_) {
    // 坏 chunk 直接忽略：同一张图还有别的块可用
  }
  return null;
}

async function parsePngEntries(fh, fileSize) {
  const entries = [];
  const sig = await readAt(fh, 0, 8);
  if (sig.length < 8 || sig.toString('latin1') !== '\x89PNG\r\n\x1a\n') return entries;

  let pos = 8;
  let scanned = 0;
  while (pos + 8 <= fileSize && scanned < MAX_SCAN_BYTES) {
    const head = await readAt(fh, pos, 8);
    if (head.length < 8) break;
    const length = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    if (type === 'IDAT' || type === 'IEND') break;
    if (length > MAX_SINGLE_CHUNK) break;
    pos += 8;

    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const data = await readAt(fh, pos, length);
      const entry = decodePngTextChunk(type, data);
      if (entry) entries.push(entry);
      scanned += length;
    }
    pos += length + 4; // data + CRC
  }
  return entries;
}

// ---------------------------------------------------------------- JPEG

async function parseJpegEntries(fh, fileSize) {
  const entries = [];
  let pos = 2; // skip SOI
  let scanned = 0;
  while (pos + 4 <= fileSize && scanned < MAX_SCAN_BYTES) {
    const markerBuf = await readAt(fh, pos, 2);
    if (markerBuf.length < 2 || markerBuf[0] !== 0xff) break;
    const marker = markerBuf[1];
    // 无长度的标记
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
    const lenBuf = await readAt(fh, pos + 2, 2);
    if (lenBuf.length < 2) break;
    const segLen = lenBuf.readUInt16BE(0);
    if (segLen < 2) break;
    if (marker === 0xe1 || marker === 0xfe || marker === 0xed) {
      const data = await readAt(fh, pos + 4, Math.min(segLen - 2, MAX_SINGLE_CHUNK));
      if (marker === 0xfe) {
        entries.push({ key: 'Comment', text: decodeText(data) });
      } else if (marker === 0xe1) {
        entries.push(...decodeApp1(data));
      } else if (marker === 0xed) {
        const xmp = decodePhotoshopXmp(data);
        if (xmp) entries.push({ key: 'XMP', text: xmp });
      }
      scanned += data.length;
    }
    pos += 2 + segLen;
  }
  return entries;
}

/** APP1：Exif 或 XMP 包，数据可能超出 64KB 规范，按实际读到长度处理。 */
function decodeApp1(data) {
  const out = [];
  try {
    if (data.length > 6 && data.toString('latin1', 0, 6) === 'Exif\u0000\u0000') {
      const fields = parseExifTiff(data.subarray(6));
      for (const [key, value] of Object.entries(fields)) {
        if (value) out.push({ key, text: value });
      }
      return out;
    }
    const xmpPrefix = 'http://ns.adobe.com/xap/1.0/\u0000';
    if (data.toString('latin1', 0, xmpPrefix.length) === xmpPrefix) {
      out.push({ key: 'XMP', text: decodeText(data.subarray(xmpPrefix.length)) });
    }
  } catch (_) { /* 坏 EXIF 不影响浏览 */ }
  return out;
}

const TIFF_TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/**
 * 极简 TIFF/EXIF 读取：只取 IFD0 与 ExifIFD 里展示用的字段，不解析缩略图。
 * 任何越界都返回空，绝不抛错。
 */
function parseExifTiff(tiff) {
  const fields = {};
  if (!tiff || tiff.length < 8) return fields;
  const order = tiff.toString('latin1', 0, 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return fields;

  const readU16 = (o) => (little ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const readU32 = (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));

  try {
    if (readU16(2) !== 42) return fields;
  } catch (_) { return fields; }

  const readValue = (type, count, offset) => {
    const size = TIFF_TYPE_SIZE[type];
    if (!size) return null;
    const bytes = size * count;
    if (offset < 0 || offset + bytes > tiff.length) return null;
    try {
      if (type === 2) {
        return decodeText(tiff.subarray(offset, offset + bytes)).replace(/\u0000+$/, '');
      }
      if (type === 7) {
        return tiff.subarray(offset, offset + bytes);
      }
      if (type === 3) {
        return count === 1 ? readU16(offset) : Array.from({ length: Math.min(count, 16) }, (_, i) => readU16(offset + i * 2));
      }
      if (type === 4 || type === 9) {
        const read = type === 4
          ? (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
          : (o) => (little ? tiff.readInt32LE(o) : tiff.readInt32BE(o));
        return count === 1 ? read(offset) : Array.from({ length: Math.min(count, 16) }, (_, i) => read(offset + i * 4));
      }
      if (type === 5 || type === 10) {
        const read = type === 5
          ? (o) => (little ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o))
          : (o) => (little ? tiff.readInt32LE(o) : tiff.readInt32BE(o));
        if (count < 2) return null;
        const den = read(offset + 4) || 1;
        return read(offset) / den;
      }
    } catch (_) { /* fallthrough */ }
    return null;
  };

  const readIfd = (offset, target) => {
    if (!Number.isFinite(offset) || offset < 8 || offset + 2 > tiff.length) return 0;
    let count;
    try { count = readU16(offset); } catch (_) { return 0; }
    if (count > 1000) return 0;
    let exifIfd = 0;
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      const tag = readU16(entry);
      const type = readU16(entry + 2);
      const n = readU32(entry + 4);
      const size = TIFF_TYPE_SIZE[type];
      if (!size) continue;
      const total = size * n;
      if (total < 0 || total > 4 * 1024 * 1024) continue;
      const valueOffset = total <= 4 ? entry + 8 : readU32(entry + 8);
      if (tag === 0x8769) { exifIfd = valueOffset; continue; }
      const value = readValue(type, n, valueOffset);
      if (value != null && value !== '') target[tag] = value;
    }
    return exifIfd;
  };

  readIfd(readU32(4), fields);

  // ExifIFD 里才放 UserComment（0x9286）等
  let exifOffset = 0;
  {
    const ifd0 = readU32(4);
    if (Number.isFinite(ifd0) && ifd0 + 2 <= tiff.length) {
      let count = readU16(ifd0);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > tiff.length) break;
        if (readU16(entry) === 0x8769) { exifOffset = readU32(entry + 8); break; }
      }
    }
  }
  if (exifOffset) readIfd(exifOffset, fields);

  const out = {};
  const asText = (v) => {
    if (v == null) return '';
    if (Buffer.isBuffer(v)) return decodeUserComment(v);
    if (typeof v === 'string') return cleanText(v);
    return '';
  };

  const description = asText(fields[0x010e]);
  const userComment = asText(fields[0x9286]);
  const software = asText(fields[0x0131]);
  const artist = asText(fields[0x013b]);
  const copyright = asText(fields[0x8298]);
  const xpComment = asText(fields[0x9c9c]);
  const xpSubject = asText(fields[0x9c9f]);
  const xpKeywords = asText(fields[0x9c9e]);

  if (description) out.Description = description;
  if (userComment) out.UserComment = userComment;
  if (software) out.Software = software;
  if (artist) out.Artist = artist;
  if (copyright) out.Copyright = copyright;
  if (xpComment) out['XPComment'] = xpComment;
  if (xpSubject) out['XPSubject'] = xpSubject;
  if (xpKeywords) out['XPKeywords'] = xpKeywords;
  return out;
}

/**
 * EXIF UserComment：前 8 字节是字符集标识（ASCII / UNICODE / JIS / 全 0）。
 * 中文 Windows 写的是 UNICODE，但字节序没有统一标注，只能嗅探。
 */
function decodeUserComment(buf) {
  if (!buf || buf.length === 0) return '';
  if (buf.length <= 8) return cleanText(decodeText(buf));
  const head = buf.toString('latin1', 0, 8);
  const body = buf.subarray(8);
  if (head.startsWith('ASCII')) return cleanText(decodeText(body));
  if (head.startsWith('JIS')) return cleanText(decodeText(body));
  if (head.startsWith('UNICODE')) return cleanText(decodeUtf16(body));
  // 没有标识：全 0 头通常是 UTF-16LE 或 UTF-8，优先 UTF-8（可读性更好）
  return cleanText(decodeText(buf));
}

function decodeUtf16(body) {
  if (!body.length) return '';
  let b = body;
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    b = Buffer.from(b.subarray(2));
    b.swap16 && b.swap16();
    return b.toString('utf16le');
  }
  // 统计零字节分布判断字节序：UTF-16LE 的 ASCII 文本高位字节在奇数位
  let zeroEven = 0;
  let zeroOdd = 0;
  const limit = Math.min(b.length, 256);
  for (let i = 0; i < limit; i++) {
    if (b[i] === 0) (i % 2 === 0 ? zeroEven++ : zeroOdd++);
  }
  if (zeroEven > zeroOdd * 2) {
    const swapped = Buffer.from(b);
    swapped.swap16 && swapped.swap16();
    return swapped.toString('utf16le');
  }
  return b.toString('utf16le');
}

// Photoshop IRB 里的 XMP（APP13），只在 8BIM 资源 id 0x0424 里出现
function decodePhotoshopXmp(data) {
  try {
    const text = decodeText(data);
    const start = text.indexOf('<x:xmpmeta');
    if (start < 0) return '';
    const end = text.indexOf('</x:xmpmeta>', start);
    if (end < 0) return '';
    return clamp(text.slice(start, end + 12), MAX_XMP);
  } catch (_) {
    return '';
  }
}

// ---------------------------------------------------------------- WebP

async function parseWebpEntries(fh, fileSize) {
  const entries = [];
  const head = await readAt(fh, 0, 12);
  if (head.length < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WEBP') {
    return entries;
  }
  let pos = 12;
  let scanned = 0;
  while (pos + 8 <= fileSize && scanned < MAX_SCAN_BYTES) {
    const h = await readAt(fh, pos, 8);
    if (h.length < 8) break;
    const fourcc = h.toString('latin1', 0, 4);
    const size = h.readUInt32LE(4);
    if (size > MAX_SINGLE_CHUNK) break;
    if (fourcc === 'EXIF') {
      const data = await readAt(fh, pos + 8, size);
      // EXIF chunk 可能省略 'Exif\0\0' 前缀
      const tiff = data.length > 6 && data.toString('latin1', 0, 6) === 'Exif\u0000\u0000' ? data.subarray(6) : data;
      try {
        for (const [key, value] of Object.entries(parseExifTiff(tiff))) {
          if (value) entries.push({ key, text: value });
        }
      } catch (_) { /* ignore */ }
      scanned += size;
    } else if (fourcc === 'XMP ') {
      const data = await readAt(fh, pos + 8, size);
      if (data.length) entries.push({ key: 'XMP', text: clamp(decodeText(data), MAX_XMP) });
      scanned += size;
    }
    pos += 8 + size + (size % 2);
  }
  return entries;
}

// ---------------------------------------------------------------- 兜底扫描

/**
 * 未知容器（AVIF 等）兜底：在头部字节里找 `key\0value` 形态的文本块。
 * 只认 AI 工具会用到的几个键，避免把图像数据误当文本。
 */
function scanEmbeddedEntries(buf) {
  const entries = [];
  if (!buf || buf.length === 0) return entries;
  const keys = ['prompt', 'workflow', 'parameters', 'Description', 'Comment', 'Software'];
  for (const key of keys) {
    const needle = Buffer.from(key + '\u0000', 'latin1');
    let from = 0;
    for (let hit = 0; hit < 3; hit++) {
      const idx = buf.indexOf(needle, from);
      if (idx < 0) break;
      const start = idx + needle.length;
      // 值到下一个 NUL 或 chunk 边界：取到下一个 NUL
      let end = buf.indexOf(0, start);
      if (end < 0) end = Math.min(buf.length, start + 200000);
      const text = decodeText(buf.subarray(start, end));
      if (text.length > 20) entries.push({ key, text });
      from = start + 1;
    }
  }
  return entries;
}

// ---------------------------------------------------------------- 解析器：ComfyUI

/**
 * 宽松 JSON：ComfyUI 的 prompt 里会出现裸 NaN/Infinity（不是合法 JSON）。
 * 标准 JSON.parse 会抛 SyntaxError，这里先做一遍词法替换。
 */
function parseLooseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const attempts = [
    text,
    text.replace(/(?<![\w."])-?(NaN|Infinity)(?![\w.])/g, 'null')
  ];
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch (_) { /* next */ }
  }
  // 有前后噪声（比如 workflow 后面跟了别的字符）时截取最外层花括号
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1).replace(/(?<![\w."])-?(NaN|Infinity)(?![\w.])/g, 'null'));
    } catch (_) { /* give up */ }
  }
  return null;
}

function isLink(value) {
  return Array.isArray(value) && value.length === 2
    && (typeof value[0] === 'string' || typeof value[0] === 'number')
    && typeof value[1] === 'number';
}

/** 从某个链接出发，向上游收集所有字符串输入（节点图可能是 DAG，要防环）。 */
function collectUpstreamTexts(graph, link, maxDepth) {
  const out = [];
  const queue = [{ id: String(link[0]), depth: 0 }];
  const seen = new Set();
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (seen.has(id) || depth > (maxDepth || 24)) continue;
    seen.add(id);
    const node = graph[id];
    if (!node || typeof node !== 'object') continue;
    const inputs = node.inputs || {};
    for (const [key, value] of Object.entries(inputs)) {
      if (isLink(value)) queue.push({ id: String(value[0]), depth: depth + 1 });
      else if (typeof value === 'string') out.push({ key, text: value, cls: node.class_type || '' });
    }
  }
  return out;
}

const ENCODER_CLASS = /(text.?encode|encode.*text|text.?encoder|prompt)/i;
const TEXT_INPUT_KEYS = new Set(['prompt', 'text', 'text_g', 'text_l', 'string', 'positive']);
const NEGATIVE_KEYS = new Set(['negative_prompt', 'negative_text', 'neg_prompt', 'negative']);

/**
 * 字符串够不够像「提示词」。
 *
 * ComfyUI 图里字符串输入不全是文本：模型文件名（`qwen_image_2.1_int8_convrot.safetensors`）、
 * 枚举值（`euler` / `index_timestep_zero`）也长这样。不加过滤的话，反向提示词
 * 十有八九会选成一个 CLIP 模型名。
 */
function looksLikePrompt(text) {
  const t = cleanText(text);
  if (t.length < 4) return false;
  if (/\.(safetensors|ckpt|pt|pth|bin|gguf|png|jpe?g|webp|gif|mp4)$/i.test(t)) return false;
  // 完全不含空白、全是标识符字符的短串（euler、qwen_image、index_timestep_zero）
  if (!/\s/.test(t) && /^[A-Za-z0-9_\-.:+]+$/.test(t) && t.length < 60) return false;
  return true;
}

function promptScore(candidate, role) {
  const key = String(candidate.key || '').toLowerCase();
  let score = 0;
  if (NEGATIVE_KEYS.has(key)) score += role === 'negative' ? 40 : 0;
  if (key === 'prompt' || key === 'text' || key === 'text_g' || key === 'text_l') score += 30;
  if (key === 'string') score += 10;
  if (ENCODER_CLASS.test(String(candidate.cls || ''))) score += 15;
  if (looksLikePrompt(candidate.text)) score += 5;
  score += Math.min(cleanText(candidate.text).length, 3000) / 3000;
  return score;
}

function pickBestText(candidates, role) {
  let best = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (!looksLikePrompt(c.text)) continue;
    const score = promptScore(c, role);
    if (score > bestScore) {
      bestScore = score;
      best = { ...c, text: cleanText(c.text) };
    }
  }
  return best;
}

/**
 * 把链接解析成上游的原始值，穿过 Primitive* 与 ComfySwitchNode。
 * ComfyUI 的数值参数经常不是字面量而是 `["170:167", 0]` 这种链接，
 * 直接回退成 `"170:167, 0"` 会得到一串看不懂的垃圾值。
 */
function resolveLinkValue(graph, value, depth, visited) {
  if (!isLink(value)) return value;
  const d = depth || 0;
  if (d > 8) return null;
  const id = String(value[0]);
  if (visited && visited.has(id)) return null;
  const nextVisited = visited ? new Set(visited) : new Set();
  nextVisited.add(id);
  const node = graph[id];
  if (!node || typeof node !== 'object') return null;
  const cls = String(node.class_type || '');
  const inputs = node.inputs || {};
  if ('value' in inputs && !isLink(inputs.value)) return inputs.value;
  if (/switch/i.test(cls)) {
    const cond = resolveLinkValue(graph, inputs.switch, d + 1, nextVisited);
    const branch = cond ? 'on_true' : 'on_false';
    if (inputs[branch] !== undefined) return resolveLinkValue(graph, inputs[branch], d + 1, nextVisited);
    return null;
  }
  if (/primitive|int|float|boolean|string|number/i.test(cls) && inputs.value !== undefined) {
    return resolveLinkValue(graph, inputs.value, d + 1, nextVisited);
  }
  return null;
}

// 只保留「采样器/潜空间节点上的数值参数」。模型文件名走 LOADER_KEYS，
// 否则同一个 LoRA 会以「带强度」和「不带强度」出现两次。
const PARAM_LABELS = {
  base_model: '基础模型',
  sampler_name: '采样器',
  scheduler: '调度器',
  steps: '步数',
  cfg: 'CFG',
  seed: '种子',
  noise_seed: '种子',
  denoise: '重绘幅度',
  width: '宽度',
  height: '高度',
  batch_size: '批量',
  clip_skip: 'Clip Skip'
};

function formatParamValue(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    const parts = value.filter((v) => typeof v === 'string' || typeof v === 'number');
    return parts.map(String).join(', ');
  }
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

const LOADER_KEYS = [
  ['unet_name', '模型'], ['ckpt_name', '模型'], ['model_name', '模型'],
  ['clip_name', 'CLIP'], ['clip_name1', 'CLIP'], ['clip_name2', 'CLIP'],
  ['vae_name', 'VAE'], ['lora_name', 'LoRA'], ['upscale_model', '放大模型']
];

function parseComfyPromptText(text) {
  const graph = parseLooseJson(text);
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return null;
  const nodes = Object.entries(graph).filter(([, n]) => n && typeof n === 'object' && n.inputs);

  // 选采样器：优先带 positive 的 KSampler/SamplerCustom
  const samplers = nodes
    .filter(([, n]) => /sampler/i.test(String(n.class_type || '')))
    .sort((a, b) => {
      const rank = (n) => {
        const cls = String(n.class_type || '');
        if (/^KSamplerAdvanced$/.test(cls)) return 0;
        if (/^KSampler$/.test(cls)) return 1;
        if (/^SamplerCustom/.test(cls)) return 2;
        return 3;
      };
      return rank(a[1]) - rank(b[1]);
    });

  let positive = '';
  let negative = '';
  const extraTexts = [];

  for (const [, node] of samplers) {
    const inputs = node.inputs || {};
    const positiveLink = inputs.positive;
    if (!isLink(positiveLink)) continue;

    const posCandidates = collectUpstreamTexts(graph, positiveLink);
    const pos = pickBestText(posCandidates, 'positive');
    if (!pos) continue;
    positive = clamp(pos.text, MAX_TEXT);

    const negativeLink = inputs.negative;
    if (isLink(negativeLink)) {
      const sameNode = String(negativeLink[0]) === String(positiveLink[0])
        && negativeLink[1] !== positiveLink[1];
      if (sameNode) {
        // 一个编码器两个输出（Qwen-Image 这类）：第二个输出对应它自己的 negative_prompt 字段
        const enc = graph[String(positiveLink[0])] || {};
        const encInputs = enc.inputs || {};
        const explicit = ['negative_prompt', 'negative_text', 'neg_prompt']
          .map((k) => encInputs[k])
          .find((v) => typeof v === 'string');
        const explicitText = cleanText(explicit || '');
        if (explicitText && explicitText !== pos.text) negative = clamp(explicitText, MAX_TEXT);
      } else {
        const negCandidates = collectUpstreamTexts(graph, negativeLink);
        const neg = pickBestText(negCandidates, 'negative');
        if (neg && neg.text !== pos.text) negative = clamp(neg.text, MAX_TEXT);
      }
    }

    // 同一条链上的其他长文本（比如 TextGenerate 生成的描述）
    for (const c of posCandidates) {
      const t = cleanText(c.text);
      const key = String(c.key || '').toLowerCase();
      if (t.length < 12 || !looksLikePrompt(t)) continue;
      if (t === positive || t === negative) continue;
      if (!TEXT_INPUT_KEYS.has(key) && !ENCODER_CLASS.test(String(c.cls || ''))) continue;
      if (extraTexts.some((e) => e.text === t)) continue;
      extraTexts.push({ label: c.cls || '节点', text: clamp(t, MAX_TEXT) });
    }
    break;
  }

  // 没有采样器（比如纯 LLM 出图的 workflow）：退化成「最像提示词的字符串」
  if (!positive) {
    const all = [];
    for (const [, node] of nodes) {
      for (const [key, value] of Object.entries(node.inputs || {})) {
        if (typeof value === 'string') all.push({ key, text: value, cls: node.class_type || '' });
      }
    }
    const best = pickBestText(all, 'positive');
    if (best) positive = clamp(best.text, MAX_TEXT);
  }

  const params = [];
  const seenParam = new Set();
  const pushParam = (label, valueText) => {
    const value = cleanText(valueText);
    if (!value) return;
    const id = `${label}\u0000${value}`;
    if (seenParam.has(id)) return;
    seenParam.add(id);
    params.push({ label, value: clamp(value, 500) });
  };

  // 第一轮：加载器类节点上的模型文件名（不是采样器参数，但用户最想看）
  for (const [, node] of nodes) {
    const cls = String(node.class_type || '');
    if (!/loader/i.test(cls)) continue;
    const inputs = node.inputs || {};
    for (const [key, label] of LOADER_KEYS) {
      if (typeof inputs[key] !== 'string' || !inputs[key]) continue;
      let value = inputs[key];
      if (label === 'LoRA' && typeof inputs.strength_model === 'number') {
        value += `（强度 ${inputs.strength_model}）`;
      }
      pushParam(label, value);
    }
  }

  // 第二轮：数值/枚举参数；链接先解析成 Primitive/开关节点的真实值
  for (const [, node] of nodes) {
    for (const [key, raw] of Object.entries(node.inputs || {})) {
      const label = PARAM_LABELS[key];
      if (!label) continue;
      if (Array.isArray(raw)) {
        const resolved = resolveLinkValue(graph, raw);
        if (resolved == null || typeof resolved === 'object') continue;
        pushParam(label, formatParamValue(resolved));
      } else {
        pushParam(label, formatParamValue(raw));
      }
    }
  }

  const texts = extraTexts
    .filter((e) => e.text !== positive && e.text !== negative)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 10);

  if (!positive && !negative && params.length === 0) return null;
  return { tool: 'ComfyUI', positive, negative, params, texts };
}

// ---------------------------------------------------------------- 解析器：A1111

const A1111_LABELS = {
  'steps': '步数',
  'sampler': '采样器',
  'schedule type': '调度器',
  'cfg scale': 'CFG',
  'seed': '种子',
  'size': '尺寸',
  'model': '模型',
  'model hash': '模型哈希',
  'vae': 'VAE',
  'vae hash': 'VAE 哈希',
  'clip skip': 'Clip Skip',
  'denoising strength': '重绘幅度',
  'hires upscale': '高清放大',
  'hires steps': '高清步数',
  'hires upscaler': '高清放大器',
  'lora hashes': 'LoRA 哈希',
  'version': '版本',
  'ti hashes': '嵌入哈希',
  'ensd': 'ENSD'
};

/** 按逗号切 "Steps: 20, Sampler: Euler a" —— 引号内的逗号不切。 */
function splitKeyValueList(line) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function parseA1111Parameters(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  let negIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*Negative prompt:/i.test(lines[i])) { negIndex = i; break; }
  }
  let stepsIndex = -1;
  for (let i = negIndex >= 0 ? negIndex : 0; i < lines.length; i++) {
    if (/^\s*Steps:\s*/i.test(lines[i])) { stepsIndex = i; break; }
  }

  const positiveEnd = negIndex >= 0 ? negIndex : (stepsIndex >= 0 ? stepsIndex : lines.length);
  const positive = cleanText(lines.slice(0, positiveEnd).join('\n'));

  let negative = '';
  if (negIndex >= 0) {
    const negLines = lines.slice(negIndex, stepsIndex > negIndex ? stepsIndex : lines.length);
    negLines[0] = negLines[0].replace(/^\s*Negative prompt:\s*/i, '');
    negative = cleanText(negLines.join('\n'));
  }

  const params = [];
  if (stepsIndex >= 0) {
    const tail = lines.slice(stepsIndex).join(' ');
    for (const chunk of splitKeyValueList(tail)) {
      const idx = chunk.indexOf(':');
      if (idx <= 0) continue;
      const key = chunk.slice(0, idx).trim().toLowerCase();
      const value = chunk.slice(idx + 1).trim();
      if (!value) continue;
      params.push({ label: A1111_LABELS[key] || chunk.slice(0, idx).trim(), value: clamp(value, 500) });
    }
  }

  if (!positive && !negative && params.length === 0) return null;
  return { tool: 'Stable Diffusion', positive, negative, params, texts: [] };
}

// ---------------------------------------------------------------- 归一化

const TEXT_KEYS = new Set(['parameters', 'prompt', 'workflow', 'Comment', 'Description', 'UserComment']);

function buildResult(entries) {
  const lookup = new Map();
  for (const e of entries) {
    if (!e || !e.key) continue;
    // 同名键保留最长的一份（tEXt 与 iTXt 可能重复）
    const prev = lookup.get(e.key);
    if (!prev || (e.text || '').length > (prev.text || '').length) lookup.set(e.key, e);
  }

  const promptEntry = lookup.get('prompt');
  const workflowEntry = lookup.get('workflow');
  const parametersEntry = lookup.get('parameters');

  // XMP 里可能藏着提示词（部分 SD 扩展写入 dc:description）
  const xmpEntry = lookup.get('XMP') || lookup.get('XML:com.adobe.xmp');

  let result = null;

  if (promptEntry) {
    result = parseComfyPromptText(promptEntry.text);
  }
  if (!result && parametersEntry) {
    result = parseA1111Parameters(parametersEntry.text);
  }
  if (!result && lookup.get('UserComment')) {
    const parsed = parseA1111Parameters(lookup.get('UserComment').text);
    // 只有带「Steps:」这类参数行才算 AI 生成：相机/修图软件也会往
    // UserComment 写一句普通描述，不能当成提示词
    if (parsed && parsed.params.length > 0) result = parsed;
  }
  if (!result && xmpEntry) {
    const desc = extractXmpDescription(xmpEntry.text);
    if (desc) {
      result = { tool: 'Unknown', positive: clamp(desc, MAX_TEXT), negative: '', params: [], texts: [] };
    }
  }

  // 普通照片：把可读的说明字段归入「原始元数据」，hasAI 仍是 false
  const raw = [];
  const pushRaw = (key, text) => {
    const value = cleanText(text);
    if (!value) return;
    raw.push({ key, text: clamp(value, MAX_RAW) });
  };

  for (const key of ['prompt', 'workflow', 'parameters', 'XMP', 'XML:com.adobe.xmp', 'UserComment', 'Description', 'Comment', 'Software', 'Artist', 'Copyright', 'XPComment', 'XPSubject', 'XPKeywords']) {
    const entry = lookup.get(key);
    if (entry) pushRaw(key, entry.text);
  }

  // 未识别的键也保留，用户可能想看到原始字段
  for (const e of lookup.values()) {
    if (raw.some((r) => r.key === e.key)) continue;
    if (TEXT_KEYS.has(e.key)) continue;
    if (!e.text || e.text.length < 2) continue;
    pushRaw(e.key, e.text);
    if (raw.length >= 40) break;
  }

  if (!result) {
    if (raw.length === 0) return null;
    result = { tool: 'Unknown', positive: '', negative: '', params: [], texts: [] };
  }

  return {
    tool: result.tool,
    positive: result.positive || '',
    negative: result.negative || '',
    params: result.params || [],
    texts: result.texts || [],
    raw,
    hasAI: !!(result.positive || result.negative || (result.params && result.params.length))
  };
}

function extractXmpDescription(xmp) {
  if (typeof xmp !== 'string' || !xmp) return '';
  const patterns = [
    /<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i,
    /<photoshop:Headline[^>]*>([\s\S]*?)<\/photoshop:Headline>/i
  ];
  for (const re of patterns) {
    const m = xmp.match(re);
    if (m) {
      const text = m[1]
        .replace(/<rdf:li[^>]*>/gi, '')
        .replace(/<\/rdf:li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
      const clean = cleanText(text);
      if (clean) return clean;
    }
  }
  return '';
}

// ---------------------------------------------------------------- 入口

/**
 * 读取并解析一个文件的 AI 元数据。
 * @returns {Promise<object|null>} 没有任何可展示信息时返回 null
 */
async function extractAiMeta(filePath) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (_) {
    return null;
  }
  if (!stat.isFile()) return null;

  const cached = cache.get(filePath, stat.size, stat.mtimeMs);
  if (cached !== undefined) return cached;

  let entries = [];
  const fh = await fs.open(filePath, 'r').catch(() => null);
  if (!fh) return null;
  try {
    const ext = require('path').extname(filePath).toLowerCase();
    if (ext === '.png') entries = await parsePngEntries(fh, stat.size);
    else if (ext === '.jpg' || ext === '.jpeg' || ext === '.jfif') entries = await parseJpegEntries(fh, stat.size);
    else if (ext === '.webp') entries = await parseWebpEntries(fh, stat.size);
    else entries = await parseGenericEntries(fh, stat.size);
  } catch (err) {
    // 畸形文件：不写缓存（下次文件可能已被替换），也不把错误抛给路由
    console.error('[aiMeta] parse failed:', filePath, err && err.message);
    return null;
  } finally {
    await fh.close().catch(() => {});
  }

  const result = buildResult(entries);
  cache.set(filePath, stat.size, stat.mtimeMs, result || null);
  return result;
}

/** 未知容器：读头部字节做启发式扫描；同时覆盖 TIFF 里的 EXIF。 */
async function parseGenericEntries(fh, fileSize) {
  const head = await readAt(fh, 0, Math.min(fileSize, 4 * 1024 * 1024));
  const entries = scanEmbeddedEntries(head);
  if (head.length > 8 && head.toString('latin1', 0, 4) === 'II*\u0000') {
    for (const [key, value] of Object.entries(parseExifTiff(head))) {
      if (value) entries.push({ key, text: value });
    }
  }
  return entries;
}

module.exports = {
  extractAiMeta,
  // 导出内部函数供单元测试直接构造样本
  _internal: {
    decodePngTextChunk,
    parseA1111Parameters,
    parseComfyPromptText,
    parseLooseJson,
    decodeUserComment,
    buildResult,
    parseExifTiff
  }
};
