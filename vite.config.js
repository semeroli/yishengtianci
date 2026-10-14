import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const API_TARGET = process.env.API_TARGET || 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true }
    }
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['vue', 'vue-router'],
          md: ['markdown-it']
        }
      }
    }
  }
})
