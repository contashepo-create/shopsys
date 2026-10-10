import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
// @ts-expect-error — إضافة JS خالصة لوضع التطوير فقط (قاعدة البيانات التجريبية)
import { demoDatabasePlugin } from './demo-db/vitePlugin.mjs'

/* v1.0.22: سياسة المحتوى تُطبَّق في الإنتاج فقط. وضع التطوير يحقن سكربتاً مضمّناً
   لتحديث الصفحة (React Refresh) وقناة HMR، وهما يُحجبان بسياسة صارمة — فنزيل الوسم في الخدمة. */
const CSP_META_RE = /\s*<meta http-equiv="Content-Security-Policy"[^>]*>/
const devStripsCsp = {
  name: 'shopsys-dev-strip-csp',
  transformIndexHtml: {
    order: 'post' as const,
    handler(html: string, ctx: { server?: unknown }) {
      return ctx.server ? html.replace(CSP_META_RE, '') : html
    },
  },
}

const appPackage = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// معمارية جاهزة للويب: نفس الواجهة تعمل في المتصفح اليوم وداخل Electron غداً
// base './': مسارات أصول نسبية — إلزامي للتحميل عبر file:// في النسخة المُثبَّتة
// (المسارات المطلقة '/assets/…' تهرب خارج مجلد التطبيق ⇒ شاشة بيضاء — بلاغ v1.0.0)
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appPackage.version) },
  base: './',
  plugins: [react(), tailwindcss(), demoDatabasePlugin(), devStripsCsp],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
})
