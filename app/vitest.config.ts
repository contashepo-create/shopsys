import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// اختبارات E2E بمحاكاة مستخدم حقيقي (أمر الإصلاح):
// تسجيل كامل من المعالج، عزل الأقسام حسب النشاط، وقوائم منسدلة ببيانات حية
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'],
    testTimeout: 30000,
    globals: false,
  },
})
