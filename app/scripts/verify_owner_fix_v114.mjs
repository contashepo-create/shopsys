#!/usr/bin/env node
/**
 * بوابة المرحلة ④ (ضمن جولة v1.0.15): bytenode + تشويش المحرك الرئيسي
 * طبقتا الحماية لعملية Electron الرئيسية:
 *   1) main.jsc — bytecode يُجمَّع داخل عملية Electron رئيسية حقيقية
 *      (electronMain:true — Electron 44/V8≥14.8 يرفض snapshot عملية Node
 *      بالSIGTRAP، لذا لا يجوز ELECTRON_RUN_AS_NODE للتجميع)
 *   2) main-full.cjs — نسخة esbuild minify (تشويش) كاحتياط
 * والمحمل main.cjs رقيق: bytecode أولاً ثم الاحتياط — التطبيق لا يتعطل.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(DIR, '..', p), 'utf8').replace(/\r\n/g, '\n')
let failed = 0
const failedNames = []
const check = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) { failed++; failedNames.push(name) }
}

const build = read('desktop/build.mjs')
check('④ البناء: main يُبنى لmain-full.cjs مشوشاً (esbuild minify)', build.includes('main-full.cjs') && build.includes('minify: true'))
check('④ البناء: توليد bytecode داخل عملية Electron رئيسية حقيقية (electronMain: true)', build.includes('electronMain: true') && build.includes('compileFile'))
check('④ البناء: bytenode خارجي بالحزمة (يُحل من node_modules وقت التشغيل)', build.includes("'bytenode'"))
check('④ البناء: بلا ثنائي Electron (ساندبوكس التطوير) يتخطى بتحذير صادق لا بصمت', build.includes('بلا ثنائي Electron') && build.includes('⚠️'))

const pkg = JSON.parse(read('package.json'))
check('④ bytenode في dependencies (يدخل حزمة الإنتاج)', pkg.dependencies && pkg.dependencies.bytenode)
check('④ main الحقيقي للتطبيق لا يزال main.cjs (المحمل)', pkg.main === 'dist-desktop/main.cjs')

const yml = read('electron-builder.yml')
check('④ الحزمة تحمل dist-desktop كاملاً (الـ bytecode والاحتياط معاً)', yml.includes('dist-desktop/**/*'))

/* فحوص المخرجات الفعلية بعد بناء حقيقي في بيئة التطوير */
import { existsSync, statSync } from 'node:fs'
const out = (p) => join(DIR, '..', 'dist-desktop', p)
const loaderOk = existsSync(out('main.cjs'))
const fullOk = existsSync(out('main-full.cjs'))
const preloadOk = existsSync(out('preload.cjs'))
check('④ المخرجات: main.cjs (المحمل) موجود بعد البناء', loaderOk)
check('④ المخرجات: main-full.cjs (الاحتياط المشوش) + preload.cjs موجودان', fullOk && preloadOk)
if (loaderOk) {
  const loader = readFileSync(out('main.cjs'), 'utf8')
  check('④ المحمل: bytecode أولاً ثم fallback — التطبيق لا يتعطل بفشل طبقة الحماية', loader.includes("require('./main.jsc')") && loader.includes("require('./main-full.cjs')"))
}
if (fullOk) {
  const full = readFileSync(out('main-full.cjs'), 'utf8')
  /* التشويش: لا تعليقات عربية توثيقية بالمصدر (تُقصف بالminify) — علامة قصّ الأسماء */
  const minified = full.length < 200_000 && !full.includes('/**') && !full.includes('tahakom — نسخة سطح المكتب')
  check('④ التشويش: main-full.cjs مضغوط بلا تعليقات المصدر (minify فعلي)', minified && statSync(out('main-full.cjs')).size > 10_000)
}

console.log('')
if (failed > 0) {
  console.error(`✗ فشل ${failed} فحصاً من بوابة v1.0.14:`)
  for (const n of failedNames) console.error(`  — ${n}`)
  process.exit(1)
}
console.log('✓ بوابة المرحلة ④ (11 فحصاً): bytenode (electronMain) + تشويش المحرك ومحمل لا يكسر التطبيق')
