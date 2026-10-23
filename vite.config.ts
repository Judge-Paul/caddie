import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

const apiProxy = { '/api': 'http://localhost:8787' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@shared': path.resolve(import.meta.dirname, './shared'),
    },
  },
  // The classifier is a Bun/Hono server; Vite only fronts it in dev and preview.
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
