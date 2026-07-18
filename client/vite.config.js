import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

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

export default defineConfig({
  plugins: [react()],
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
