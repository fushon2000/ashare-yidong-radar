import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const rootDir = __dirname
const webRoot = resolve(rootDir, 'src/web')

/**
 * 网页版（PWA）构建配置。
 * 与 electron.vite.config.ts 完全独立，共用 src/shared 引擎与 src/renderer 界面。
 */
export default defineConfig({
  root: webRoot,
  base: '/ashare-yidong-radar/',
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(rootDir, 'src/renderer/src'),
      '@shared': resolve(rootDir, 'src/shared')
    }
  },
  build: {
    outDir: resolve(rootDir, 'dist-web'),
    emptyOutDir: true,
    target: 'es2020',
    chunkSizeWarningLimit: 2500
  }
})
