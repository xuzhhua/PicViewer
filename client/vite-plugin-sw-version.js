import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BUILD_PLACEHOLDER = '__SW_BUILD__';
const PRECACHE_PLACEHOLDER = '__SW_PRECACHE__';

/** 不需要预缓存的产物：SW 自身、诊断文件 */
const EXCLUDED = new Set(['sw.js', 'version.json']);

/** Vite 放在 assets/ 下的产物文件名自带内容 hash，内容变了名字必变 */
const CONTENT_HASHED_DIR = 'assets/';

/** 递归列出目录下所有文件，返回相对 base 的正斜杠路径 */
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * 构建时把 client/public/sw.js 模板渲染成带构建指纹的 dist/sw.js。
 *
 * 为什么必须这么做：浏览器判断 Service Worker 是否需要更新，靠的是
 * 「逐字节比对 sw.js 的内容」。旧版本把版本号写死成 picviewer-v2，
 * 于是每次构建后 sw.js 内容完全一致 → 浏览器认为「没有新版本」→ 不 install
 * → activate 不触发 → 缓存永远不清 → 设备被永久锁死在旧版本。
 *
 * 渲染后 CACHE_NAME 会带上构建指纹，同时把真实的产物清单写进预缓存列表。
 */
export default function swVersionPlugin() {
  let outDir;
  let publicDir;

  return {
    name: 'picviewer-sw-version',
    apply: 'build',
    // post：保证在所有内置插件之后跑，此时 public/ 已经拷贝进 dist/
    enforce: 'post',

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      publicDir = path.resolve(config.root, config.publicDir || 'public');
    },

    async closeBundle() {
      const templatePath = path.join(publicDir, 'sw.js');

      if (!fs.existsSync(templatePath)) {
        this.warn(`[sw-version] 找不到 SW 模板：${templatePath}`);
        return;
      }
      if (!fs.existsSync(outDir)) {
        this.warn(`[sw-version] 找不到构建产物目录：${outDir}`);
        return;
      }

      const template = fs.readFileSync(templatePath, 'utf-8');
      if (!template.includes(BUILD_PLACEHOLDER) || !template.includes(PRECACHE_PLACEHOLDER)) {
        this.warn('[sw-version] sw.js 模板缺少占位符，跳过注入');
        return;
      }

      // 1) 预缓存清单 = dist 下所有产物（除 sw.js / version.json / sourcemap）
      const files = walk(outDir)
        .filter((rel) => !EXCLUDED.has(rel) && !rel.endsWith('.map'))
        .sort();

      const precache = files.map((rel) => `/${rel}`);
      if (!precache.includes('/index.html')) {
        this.warn('[sw-version] 产物里没有 index.html，预缓存清单可能不完整');
      }
      if (!precache.includes('/')) precache.unshift('/'); // start_url

      // 2) 构建指纹：只对「文件名不含 hash」的产物做内容摘要。
      //    这样「改了代码」和「只改了 index.html」都会换指纹，
      //    而「原样重新构建」指纹不变，不会给手机端推送无意义的新版本提示。
      const digest = crypto.createHash('sha1');
      digest.update(precache.join('\n'));
      digest.update(template); // 模板本身改了（如缓存策略）也算新版本
      for (const rel of files) {
        if (rel.startsWith(CONTENT_HASHED_DIR)) continue; // 名字里已含内容 hash
        digest.update(fs.readFileSync(path.join(outDir, rel)));
      }
      const version = digest.digest('hex').slice(0, 8);

      const rendered = template
        .replaceAll(BUILD_PLACEHOLDER, version)
        .replaceAll(PRECACHE_PLACEHOLDER, JSON.stringify(precache, null, 2));

      // 渲染后先校验再落盘，避免发布一个语法不合法的 Service Worker
      if (rendered.includes(BUILD_PLACEHOLDER) || rendered.includes(PRECACHE_PLACEHOLDER)) {
        this.error('[sw-version] 渲染后仍有占位符残留，检查模板是否在代码里还引用了它们');
      }
      try {
        // 仅做语法解析，不执行
        new Function(rendered); // eslint-disable-line no-new-func
      } catch (err) {
        this.error(`[sw-version] 渲染后的 sw.js 语法不合法：${err.message}`);
      }

      // 3) 覆盖 Vite 从 public/ 原样拷过来的文件
      fs.writeFileSync(path.join(outDir, 'sw.js'), rendered);
      fs.writeFileSync(
        path.join(outDir, 'version.json'),
        JSON.stringify({ version, builtAt: new Date().toISOString() }, null, 2)
      );

      console.log(`[sw-version] sw.js → picviewer-${version}（${precache.length} 个预缓存资源）`);
    },
  };
}
