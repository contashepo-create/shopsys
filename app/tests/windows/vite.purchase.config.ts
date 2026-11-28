import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// A separate build used only by the Windows CI fixture; it is never part of the installer.
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify('ci-purchase-smoke') },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: process.env.PURCHASE_SMOKE_OUT || 'purchase-smoke-build',
    emptyOutDir: true,
    rollupOptions: { input: resolve('tests/windows/purchase_close_fixture.html') },
  },
})
