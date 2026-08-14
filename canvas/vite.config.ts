import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Dev lane: canvas 5601, game server 5600 (docs/2026-08-15-dev-runner-ports-plan.md).
    // strictPort because ports mean things in that scheme — a silent bump would leave the
    // proxy pointing somewhere a different app answers.
    port: Number(process.env.CANVAS_PORT ?? 5601),
    strictPort: true,
    // Same-origin `/api/...` in dev too — prod nginx does this for real.
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:5600',
        changeOrigin: true,
      },
    },
  },
})
