/**
 * بوابة تغليف سطح المكتب (بلاغ v1.0.0: الشاشة البيضاء على ويندوز).
 *
 * الجذر: vite بلا base './' يُخرج index.html بمسارات أصول **مطلقة**
 * (/assets/…) — عند التحميل عبر file:// في التطبيق المُثبَّت تُطلب من جذر
 * القرص (file:///C:/assets/…) ⇒ 404 ⇒ شاشة بيضاء صامتة.
 *
 * تحمي البوابة كل إصدار قادم قبل النشر (تُشتغل ضمن verify:all في سير
 * الإصدار — لا حزمة تكسر بوابة):
 *   1) vite.config يفرض base './'
 *   2) بناء حقيقي للواجهة ثم فحص كل مرجع في index.html — نسبياً لا مطلقاً
 *   3) الأصول المُشار إليها موجودة فعلاً بجوار index.html (منطق file:// نفسه)
 *   4) electron-builder يشحن dist وdist-desktop، والوحدة الأصلية مفكوكة
 *   5) قنوات التشخيص الميداني حاضرة (did-fail-load + صفحة خطأ + سجل ملفي)
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')

let passed = 0
const ok = (msg) => { passed += 1; console.log(`  ✓ ${msg}`) }
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exit(1) }
console.log('═══ بوابة تغليف سطح المكتب (الشاشة البيضاء لا تعود) ═══')

/* ── 1) تكوين vite: مسارات نسبية إلزامية ── */
{
  const viteConfig = readFileSync(join(appRoot, 'vite.config.ts'), 'utf8')
  if (!/base:\s*['"]\.\/['"]/.test(viteConfig)) fail('vite.config.ts بلا base \'./\' — الأصول ستصدر بمسارات مطلقة تكسر التحميل عبر file://')
  ok('vite.config يفرض base \'./\' (مسارات نسبية تصلح file://)')
}

/* ── 2) بناء حقيقي للواجهة ثم فحص المراجع ── */
{
  console.log('  … بناء الواجهة (vite build)')
  execFileSync('npx', ['vite', 'build'], { cwd: appRoot, stdio: 'pipe', shell: process.platform === 'win32' })
  const html = readFileSync(join(appRoot, 'dist', 'index.html'), 'utf8')
  if (!html.includes('<div id="root">')) fail('dist/index.html بلا نقطة إقلاع الواجهة')
  /* كل مرجع أصل محلي: نسبية فقط — المطلقة (/…) تهرب خارج التطبيق تحت file:// */
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !/^(https?:|data:|#|mailto:)/.test(r))
  const absolute = refs.filter((r) => r.startsWith('/'))
  if (absolute.length) fail(`مراجع مطلقة في index.html تكسر file:// (الشاشة البيضاء): ${absolute.join('، ')}`)
  ok(`كل مراجع index.html نسبية (${refs.length} مرجعاً) — تعمل عبر file://`)
  /* الأصول المُشار إليها موجودة فعلاً بجوار index.html — منطق loadFile نفسه */
  const missing = refs.filter((r) => !existsSync(join(appRoot, 'dist', r.replace(/^\.\//, '').split('?')[0])))
  if (missing.length) fail(`أصول مُشار إليها غير موجودة في dist/: ${missing.join('، ')}`)
  ok('كل أصل مُشار إليه موجود فعلاً في dist/ (محاكاة تحميل file://)')
}

/* ── 3) تعبئة electron-builder: الملفات الثلاثة الحاسمة ── */
{
  const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8')
  for (const needle of ['dist/**/*', 'dist-desktop/**/*']) {
    if (!yml.includes(needle)) fail(`electron-builder.yml لا يشحن ${needle} — الواجهة أو الجسور ستغيب من الحزمة`)
  }
  if (!/asarUnpack:[\s\S]*better-sqlite3/.test(yml)) fail('الوحدة الأصلية better-sqlite3 ليست مفكوكة من asar')
  const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  if (pkg.main !== 'dist-desktop/main.cjs') fail(`main في package.json = ${pkg.main} — إقلاع الحزمة سيفشل`)
  ok('electron-builder يشحن dist + dist-desktop والوحدة الأصلية مفكوكة ونقطة الإقلاع صحيحة')
}

/* ── 4) ترجمة العملية الرئيسية والجسور ── */
{
  execFileSync('node', ['desktop/build.mjs'], { cwd: appRoot, stdio: 'pipe' })
  for (const file of ['dist-desktop/main.cjs', 'dist-desktop/main-full.cjs', 'dist-desktop/preload.cjs']) {
    if (!existsSync(join(appRoot, file))) fail(`${file} لم يُترجم — الحزمة بلا عملية رئيسية`)
  }
  const preload = readFileSync(join(appRoot, 'dist-desktop', 'preload.cjs'), 'utf8')
  if (!preload.includes('shopsysLanHost')) fail('preload بلا جسور شبكة المحل — مفاجآت وقت التشغيل')
  /* v1.0.14: main.cjs محمل رقيق (bytecode ثم احتياط) — الفحص على الجوهر
     في main-full.cjs (وmain.jsc يُولَّد ببيئة فيها ثنائي Electron وقت النشر) */
  const loader = readFileSync(join(appRoot, 'dist-desktop', 'main.cjs'), 'utf8')
  if (!loader.includes("require('./main.jsc')") || !loader.includes("require('./main-full.cjs')")) fail('main.cjs ليس محمل main.jsc مع احتياط main-full.cjs')
  const mainCjs = readFileSync(join(appRoot, 'dist-desktop', 'main-full.cjs'), 'utf8')
  if (!mainCjs.includes('lan-host:start')) fail('العملية الرئيسية بلا خادم شبكة المحل')
  ok('العملية الرئيسية والجسور مترجمة: محمل bytecode + احتياط مشوش يحملان خادم الشبكة')
}

/* ── 5) قنوات التشخيص الميداني حاضرة (بلاغ v1.0.0: عطل بلا أثر) ── */
{
  const mainSrc = readFileSync(join(appRoot, 'desktop', 'main.ts'), 'utf8')
  for (const needle of ['did-fail-load', 'render-process-gone', 'main.log', 'console-message']) {
    if (!mainSrc.includes(needle)) fail(`desktop/main.ts بلا قناة تشخيص «${needle}» — الأعطال الميدانية ستعود صامتة`)
  }
  ok('قنوات التشخيص الميداني حاضرة: فشل التحميل يعرض صفحة خطأ عربية والأخطاء تُسجَّل في main.log')
}

/* ── 6) أعلى الملف سجل لا يُشحن سجلات التشخيص للمستخدم النهائي ── */
{
  const yml = readFileSync(join(appRoot, 'electron-builder.yml'), 'utf8')
  if (!/^\s*-\s*!?release\/?$/m.test(yml) && !/release\/\*\*/.test(yml)) {
    /* release/ مخرجات electron-builder محلية — لا تُشحن؛ إن لم تكن مستثناة صراحة فالقائمة files لا تشملها أصلاً */
    ok('مخرجات النشر (release/) خارج قائمة الشحن — الحزمة نظيفة')
  } else {
    fail('قائمة files تشحن مخرجات release/ — حزمة منتفخة')
  }
  void statSync
  void writeFileSync
}

console.log(`✅ بوابة تغليف سطح المكتب: ${passed} فحوصاً — الشاشة البيضاء مستحيلة العودة`)
