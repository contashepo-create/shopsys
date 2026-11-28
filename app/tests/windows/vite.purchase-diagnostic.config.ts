import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify('ci-purchase-diagnostic') },
  plugins: [react()],
  build: {
    outDir: process.env.PURCHASE_DIAGNOSTIC_OUT || 'purchase-diagnostic-build',
    emptyOutDir: true,
    rollupOptions: { input: resolve('tests/windows/purchase_diagnostic.html') },
  },
})
