/**
 * ترجمة عملية Electron الرئيسية وpreload بesbuild إلى dist-desktop/ (CJS):
 *   main.cjs    — العملية الرئيسية (قاعدة SQLite والطباعة والتحديث)
 *   preload.cjs — جسور contextBridge (عقد المُصيّر)
 * better-sqlite3 وelectron-updater وelectron تبقى خارجية (تُحل من node_modules
 * وقت التشغيل) — الوحدات الأصلية لا تُحزَّم.
 */
import { build } from 'esbuild'

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  external: ['electron', 'better-sqlite3', 'electron-updater'],
  logLevel: 'info',
}

await build({
  ...shared,
  entryPoints: ['desktop/main.ts'],
  outfile: 'dist-desktop/main.cjs',
})

await build({
  ...shared,
  entryPoints: ['desktop/preload.ts'],
  outfile: 'dist-desktop/preload.cjs',
})

console.log('✅ dist-desktop/main.cjs + preload.cjs')
