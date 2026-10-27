const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { extractAiMeta, _internal } = require('../server/services/aiMeta');

// ---------------------------------------------------------------- 样本构造

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** 1×1 假 PNG；texts 为 [ [key, text], ... ]，写成 tEXt（UTF-8 字节，符合 AI 工具的实际做法） */
function makePng(texts = []) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // RGB
  const idat = zlib.deflateSync(Buffer.from([0, 0, 0, 0]));
  const textChunks = texts.map(([key, text]) => pngChunk('tEXt', Buffer.concat([
    Buffer.from(key, 'latin1'),
    Buffer.from([0]),
    Buffer.from(text, 'utf8')
  ])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    ...textChunks,
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/** 只含 ExifIFD→UserComment 的 APP1；value 为 UNDEFINED(7)，符合相机/AI 工具写法 */
function exifApp1(userComment) {
  const ifd0Offset = 8;
  const exifIfdOffset = ifd0Offset + 2 + 12 + 4;        // 26
  const dataOffset = exifIfdOffset + 2 + 12 + 4;        // 44
  const tiff = Buffer.alloc(dataOffset + userComment.length);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(ifd0Offset, 4);

  // IFD0：一个条目，指向 ExifIFD
  tiff.writeUInt16LE(1, ifd0Offset);
  tiff.writeUInt16LE(0x8769, ifd0Offset + 2);
  tiff.writeUInt16LE(4, ifd0Offset + 4);
  tiff.writeUInt32LE(1, ifd0Offset + 6);
  tiff.writeUInt32LE(exifIfdOffset, ifd0Offset + 10);
  tiff.writeUInt32LE(0, ifd0Offset + 14);

  // ExifIFD：UserComment(0x9286)
  tiff.writeUInt16LE(1, exifIfdOffset);
  tiff.writeUInt16LE(0x9286, exifIfdOffset + 2);
  tiff.writeUInt16LE(7, exifIfdOffset + 4);
  tiff.writeUInt32LE(userComment.length, exifIfdOffset + 6);
  tiff.writeUInt32LE(dataOffset, exifIfdOffset + 10);
  tiff.writeUInt32LE(0, exifIfdOffset + 14);
  userComment.copy(tiff, dataOffset);

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, payload]);
}

function makeJpeg(segments) {
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xd9])]);
}

function comfyPromptGraph() {
  const graph = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: '一座雪山静静地立在晨雾中，冷色调，胶片质感', clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: '模糊，低质量，畸变', clip: ['1', 1] } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    6: { class_type: 'PreviewAny', inputs: { source: [NaN] } },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed: 123456789,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0]
      }
    }
  };
  // 模拟 ComfyUI 落盘时的非标准 NaN：JSON.parse 会直接抛错
  return JSON.stringify(graph).replace('"source":[null]', '"source":[NaN]');
}

// ---------------------------------------------------------------- 测试辅助

let tmpDir;
test.before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-ai-meta-'));
});
test.after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let seq = 0;
function writeTemp(name, buf) {
  const file = path.join(tmpDir, `${seq++}-${name}`);
  fs.writeFileSync(file, buf);
  return file;
}

function param(meta, label) {
  return (meta.params || []).find((p) => p.label === label);
}

// ---------------------------------------------------------------- PNG + ComfyUI

test('ComfyUI PNG：中文提示词、反向提示词与采样参数', async () => {
  const file = writeTemp('comfy.png', makePng([
    ['prompt', comfyPromptGraph()],
    ['workflow', '{"nodes":[],"links":[]}']
  ]));
  const meta = await extractAiMeta(file);

  assert.ok(meta, '应解析出元数据');
  assert.strictEqual(meta.hasAI, true);
  assert.strictEqual(meta.tool, 'ComfyUI');
  assert.match(meta.positive, /雪山/);
  assert.match(meta.negative, /模糊/);
  assert.strictEqual(param(meta, '种子').value, '123456789');
  assert.strictEqual(param(meta, '步数').value, '20');
  assert.strictEqual(param(meta, 'CFG').value, '7');
  assert.strictEqual(param(meta, '采样器').value, 'euler');
  assert.strictEqual(param(meta, '模型').value, 'sd_xl_base_1.0.safetensors');
  // 原始 prompt JSON 保留下来，方便用户复制完整工作流
  assert.ok(meta.raw.some((r) => r.key === 'prompt'));
});

test('ComfyUI：同一编码器两个输出时从 negative_prompt 字段取反向提示词', async () => {
  const graph = {
    1: { class_type: 'UnetLoaderGGUF', inputs: { unet_name: 'qwen_image.safetensors' } },
    2: {
      class_type: 'TextEncodeQwenImageEdit',
      inputs: {
        clip: ['1', 1],
        positive_prompt: '把天空换成极光，其余保持不变',
        negative_prompt: '改变人物面部，改变构图'
      }
    },
    3: {
      class_type: 'SamplerCustom',
      inputs: { model: ['1', 0], positive: ['2', 0], negative: ['2', 1], steps: 25, cfg: 4, seed: 42 }
    }
  };
  const meta = await extractAiMeta(writeTemp('qwen.png', makePng([['prompt', JSON.stringify(graph)]])));
  assert.ok(meta);
  assert.strictEqual(meta.tool, 'ComfyUI');
  assert.match(meta.positive, /极光/);
  assert.match(meta.negative, /改变人物面部/);
  // negative 不能再被当成「其他文本」重复一遍
  assert.ok(!(meta.texts || []).some((t) => /改变人物面部/.test(t.text)));
});

test('ComfyUI：采样器参数是链接时解析上游节点里的真实值', async () => {
  const graph = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev.safetensors' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: '未来城市，赛博朋克风格，夜景', clip: ['1', 1] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: '过曝，噪点', clip: ['1', 1] } },
    4: { class_type: 'PrimitiveInt', inputs: { value: 30 } },
    5: {
      class_type: 'KSampler',
      inputs: { steps: ['4', 0], seed: 7, cfg: 3.5, sampler_name: 'dpmpp_2m', positive: ['2', 0], negative: ['3', 0] }
    }
  };
  const meta = await extractAiMeta(writeTemp('linked.png', makePng([['prompt', JSON.stringify(graph)]])));
  assert.ok(meta);
  assert.strictEqual(param(meta, '步数').value, '30');
});

// ---------------------------------------------------------------- PNG + A1111

test('A1111 PNG：parameters 文本里的正向/反向提示词与参数', async () => {
  const parameters = [
    'masterpiece, best quality, 一座被雪覆盖的森林小屋, <lora:detail_tweaker:0.6>',
    'Negative prompt: lowres, bad anatomy, 模糊',
    'Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 99887766, Size: 832x1216, Model: dreamshaper_8'
  ].join('\n');
  const meta = await extractAiMeta(writeTemp('a1111.png', makePng([['parameters', parameters]])));
  assert.ok(meta);
  assert.strictEqual(meta.hasAI, true);
  assert.strictEqual(meta.tool, 'Stable Diffusion');
  assert.match(meta.positive, /森林小屋/);
  assert.match(meta.negative, /bad anatomy/);
  assert.strictEqual(param(meta, '步数').value, '28');
  assert.strictEqual(param(meta, '采样器').value, 'DPM++ 2M Karras');
  assert.strictEqual(param(meta, '种子').value, '99887766');
  assert.strictEqual(param(meta, '尺寸').value, '832x1216');
});

// ---------------------------------------------------------------- JPEG + EXIF

test('JPEG EXIF UserComment（UNICODE）：中文生成参数', async () => {
  const text = [
    '夜色中的城市天际线，雨后街道反光',
    'Negative prompt: 模糊, 低质量, 变形',
    'Steps: 30, Sampler: Euler, CFG scale: 5.5, Seed: 12345, Model: flux1-dev'
  ].join('\n');
  // UNICODE 头 + UTF-16LE（带 BOM 是相机/Windows 的常见写法）
  const userComment = Buffer.concat([
    Buffer.from('UNICODE\0', 'latin1'),
    Buffer.from(`\uFEFF${text}`, 'utf16le')
  ]);
  const file = writeTemp('exif.jpg', makeJpeg([exifApp1(userComment)]));
  const meta = await extractAiMeta(file);

  assert.ok(meta, '应解析出元数据');
  assert.strictEqual(meta.tool, 'Stable Diffusion');
  assert.match(meta.positive, /城市天际线/);
  assert.match(meta.negative, /变形/);
  assert.strictEqual(param(meta, '步数').value, '30');
  assert.ok(meta.raw.some((r) => r.key === 'UserComment'));
});

test('JPEG EXIF UserComment（ASCII 头）：普通描述也不会被误判成 AI 图', async () => {
  const userComment = Buffer.concat([
    Buffer.from('ASCII\0\0\0', 'latin1'),
    Buffer.from('拍摄于西湖边', 'utf8')
  ]);
  const meta = await extractAiMeta(writeTemp('exif-ascii.jpg', makeJpeg([exifApp1(userComment)])));
  assert.ok(meta, '描述文字会作为原始元数据保留');
  assert.strictEqual(meta.hasAI, false);
  assert.strictEqual(meta.positive, '');
  assert.ok(meta.raw.some((r) => /西湖/.test(r.text)));
});

// ---------------------------------------------------------------- 普通照片 / 无元数据

test('普通 PNG：没有任何可展示元数据时返回 null（前端据此不显示 AI 分页）', async () => {
  const meta = await extractAiMeta(writeTemp('plain.png', makePng()));
  assert.strictEqual(meta, null);
});

test('非图片文件不会抛错', async () => {
  const meta = await extractAiMeta(writeTemp('notes.txt', Buffer.from('hello', 'utf8')));
  assert.strictEqual(meta, null);
});

// ---------------------------------------------------------------- 内部函数

test('decodePngTextChunk：zTXt 压缩的中文能解出来', () => {
  const text = '压缩块里的中文提示词';
  const data = Buffer.concat([
    Buffer.from('Comment', 'latin1'),
    Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from(text, 'utf8'))
  ]);
  const entry = _internal.decodePngTextChunk('zTXt', data);
  assert.ok(entry);
  assert.strictEqual(entry.key, 'Comment');
  assert.strictEqual(entry.text, text);
});

test('decodePngTextChunk：iTXt 未压缩的 UTF-8 文本', () => {
  const text = 'iTXt 中文提示词';
  const data = Buffer.concat([
    Buffer.from('prompt', 'latin1'),
    Buffer.from([0, 0, 0, 0, 0]), // compFlag, compMethod, langTag 结束, translatedKeyword 结束
    Buffer.from(text, 'utf8')
  ]);
  const entry = _internal.decodePngTextChunk('iTXt', data);
  assert.ok(entry);
  assert.strictEqual(entry.text, text);
});

test('parseLooseJson：容忍 NaN / Infinity', () => {
  const obj = _internal.parseLooseJson('{"a":NaN,"b":Infinity,"c":[1,2]}');
  assert.ok(obj);
  assert.strictEqual(obj.a, null);
  assert.strictEqual(obj.b, null);
  assert.deepStrictEqual(obj.c, [1, 2]);
});

test('parseLooseJson：不把普通字符串当 JSON', () => {
  assert.strictEqual(_internal.parseLooseJson('一座雪山'), null);
  assert.strictEqual(_internal.parseLooseJson(''), null);
});

test('parseComfyPromptText：没有采样器的纯 LLM workflow 也能找到提示词', () => {
  const graph = {
    1: { class_type: 'TextGenerate', inputs: { prompt: '请写一段关于秋天的散文，三百字以内' } },
    2: { class_type: 'PreviewAny', inputs: { source: ['1', 0] } }
  };
  const result = _internal.parseComfyPromptText(JSON.stringify(graph));
  assert.ok(result);
  assert.match(result.positive, /秋天的散文/);
});
