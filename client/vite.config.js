import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import swVersionPlugin from './vite-plugin-sw-version.js';

// Read server port from config, same logic as server/index.js
function getServerPort() {
  try {
    const configPath = path.resolve(__dirname, '..', 'server', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.port) return config.port;
    }
  } catch (e) { /* ignore */ }
  return 3456;
}

// 应用元信息（版本号 / 源码仓库地址），用于「关于」对话框
function getAppMeta() {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return {
      version: pkg.version || '0.0.0',
      repository: (pkg.repository && (pkg.repository.url || pkg.repository)) || ''
    };
  } catch (e) {
    return { version: '0.0.0', repository: '' };
  }
}

export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  // 关于对话框展示的版本号 / 源码地址：构建时从根 package.json 注入，不手写常量
  define: {
    __APP_VERSION__: JSON.stringify(getAppMeta().version),
    __APP_REPOSITORY__: JSON.stringify(getAppMeta().repository)
  },
  server: {
    host: '0.0.0.0',  // Allow mobile devices on same network to connect
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${getServerPort()}`,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
