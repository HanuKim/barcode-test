import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5174,
    allowedHosts: true,
    proxy: {
      // 푸드QR API 프록시 (CORS 우회)
      '/api/foodqr': {
        target: 'https://foodqr.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/foodqr/, '/openapi/service'),
        secure: true,
      },
    },
  },
})
