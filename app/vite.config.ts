import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error — إضافة JS خالصة لوضع التطوير فقط (قاعدة البيانات التجريبية)
import { demoDatabasePlugin } from './demo-db/vitePlugin.mjs'

// معمارية جاهزة للويب: نفس الواجهة تعمل في المتصفح اليوم وداخل Electron غداً
export default defineConfig({
  plugins: [react(), tailwindcss(), demoDatabasePlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
})
