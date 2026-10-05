/**
 * ترجمة عملية Electron الرئيسية وpreload بesbuild إلى dist-desktop/ (CJS):
 *   main.cjs    — محمل رقيق يشغّل main.jsc (bytecode) ويرجع لmain-full.cjs عند أي فشل
 *   main.jsc    — main-full.cjs مجمّعة bytecode عبر bytenode داخل عملية Electron
 *                 رئيسية حقيقية (Electron 44 / V8 ≥ 14.8 يرفض snapshot عملية
 *                 Node بالSIGTRAP — لذا electronMain:true لا RUN_AS_NODE)
 *   main-full.cjs — النسخة المشوشة (esbuild minify) — احتياط المحمل، لا مصدر
 *   preload.cjs — جسور contextBridge (عقد المُصيّر) مشوشة كذلك
 * better-sqlite3 وelectron-updater وelectron وbytenode تبقى خارجية (تُحل من
 * node_modules وقت التشغيل) — الوحدات الأصلية لا تُحزَّم.
 */
import { build } from 'esbuild'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  /* v1.0.14 (المرحلة ④): تشويش — أسماء مختصرة وبلا مسافات؛ الحماية الأساسية
     هي bytecode (main.jsc) وهذا طبقة التشويش المطلوبة للملف الاحتياطي */
  minify: true,
  external: ['electron', 'better-sqlite3', 'electron-updater', 'bytenode'],
  logLevel: 'info',
}

/* العملية الرئيسية: تُبنى لmain-full.cjs (احتياطي) ثم تُجمَّع bytecode لmain.jsc */
await build({
  ...shared,
  entryPoints: ['desktop/main.ts'],
  outfile: 'dist-desktop/main-full.cjs',
})

/* المحمل الرقيق (main.cjs): يحاول bytecode أولاً؛ عند أي فشل (توافق V8 غير
   متوقع) يرجع للنسخة المشوشة — التطبيق لا يتعطل أبداً بسبب طبقة الحماية */
writeFileSync('dist-desktop/main.cjs', `/* تَحَكَّم — محمل المحرك (v1.0.14): bytecode أولاً والاحتياط المشوش ثانياً */
try {
  require('bytenode')
  module.exports = require('./main.jsc')
} catch (error) {
  console.error('[tahakom] bytecode load failed — falling back to obfuscated build:', error && error.message)
  module.exports = require('./main-full.cjs')
}
`)

await build({
  ...shared,
  entryPoints: ['desktop/preload.ts'],
  outfile: 'dist-desktop/preload.cjs',
})

/* v1.0.14 (المرحلة ④): توليد bytecode — يجب أن يجري داخل عملية Electron
   رئيسية حقيقية (نفس snapshot V8 الذي سيشغّل التطبيق). bytenode يفتح
   إلكتروناً مخفياً بنفسه؛ يتعذر فقط في بيئات بلا ثنائي Electron (كساندبوكس
   التطوير) — نتخطاه بتحذير صادق، والإنتاج (CI/جهاز المالك) يولّده دائماً. */
const electronBinary = [
  join('node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  join('node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
]
const hasElectron = electronBinary.some((p) => existsSync(p))
if (hasElectron) {
  const { compileFile } = await import('bytenode')
  await compileFile({
    filename: 'dist-desktop/main-full.cjs',
    output: 'dist-desktop/main.jsc',
    electronMain: true,
    electronPath: electronBinary.find((p) => existsSync(p)),
  })
  console.log('✅ dist-desktop/main.jsc (bytecode, electronMain) + main.cjs (loader) + preload.cjs')
} else {
  console.warn('⚠️ بلا ثنائي Electron في هذه البيئة — تُخطي توليد main.jsc؛ الحزمة ستعمل بالاحتياط المشوش main-full.cjs. بيئة الإنتاج (CI/ويندوز) تولّد الـ bytecode دائماً.')
  console.log('✅ dist-desktop/main.cjs (loader) + main-full.cjs (obfuscated) + preload.cjs')
}
