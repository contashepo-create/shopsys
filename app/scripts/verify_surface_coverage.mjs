/**
 * verify_surface_coverage.mjs — الطبقة ① من منهجية الفحص: **حصر الأسطح**
 * ───────────────────────────────────────────────────────────────────────
 * المشكلة التي وُلدت منها هذه البوابة: كل جولة كانت تُكتشف فيها ثغرة في سطح لم
 * يخطر على البال — جرد، طبق، مصروف، إرجاع… لأن الاختبار كان «عيّنة» لا حصراً.
 *
 * الحل: نستخرج الأسطح **من الكود نفسه** (واجهة `DataState` + تنفيذاتها في المتجر)،
 * ونقيس تغطية كل سطح عبر سكربتات التحقق والاختبارات، ونفشل إن بقي سطح واحد بلا
 * استدعاء. الوثيقة `docs/تغطية_الأسطح.md` تُولَّد من هذه البوابة، فلا تتقادم يدوياً.
 *
 * التشغيل: node --experimental-strip-types scripts/verify_surface_coverage.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = join(here, '..')
const repoPath = join(appRoot, 'src/data/repo.ts')
const src = readFileSync(repoPath, 'utf8')

// ── ① استخراج أعضاء الواجهة (المصدر الرسمي للأسطح) ───────────────────────────
const ifaceStart = src.indexOf('interface DataState {')
if (ifaceStart < 0) throw new Error('لم تُعثر على واجهة DataState — تغيّر هيكل المتجر')
let depth = 0
let ifaceEnd = -1
for (let i = src.indexOf('{', ifaceStart); i < src.length; i++) {
  if (src[i] === '{') depth++
  else if (src[i] === '}') { depth--; if (depth === 0) { ifaceEnd = i; break } }
}
const ifaceBlock = src.slice(ifaceStart, ifaceEnd)
const ifaceMembers = [...new Set([...ifaceBlock.matchAll(/^ {2}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]))]

// ── ② استخراج التنفيذات من جسم المتجر (سطر مفتاح بمسافة 6 + قوس) ──────────────
const storeBody = src.slice(ifaceEnd)
const keyMatches = [...storeBody.matchAll(/^ {6}([a-zA-Z][a-zA-Z0-9]*): \(/gm)]
const implementations = new Map() // name → body
for (let i = 0; i < keyMatches.length; i++) {
  const name = keyMatches[i][1]
  if (!ifaceMembers.includes(name)) continue // تحميل داخلي/دالة مساعدة لا سطح متجر
  const from = keyMatches[i].index
  const to = i + 1 < keyMatches.length ? keyMatches[i + 1].index : storeBody.length
  implementations.set(name, storeBody.slice(from, to))
}

// ── ③ تصنيف الأسطح: مالية (تكتب دفتراً) أو بيانات فقط ───────────────────────
const MONEY_MARKERS = ['journal:', 'journal }', 'journal,', 'treasuries:', 'stockValueMinor', 'stockQty:']
const isMoney = (body) => MONEY_MARKERS.some((marker) => body.includes(marker))
const surfaces = [...implementations.entries()].map(([name, body]) => ({
  name,
  money: isMoney(body),
  stock: body.includes('stockQty') || body.includes('stockValueMinor'),
  lines: body.split('\n').length,
}))

// ── ④ قياس التغطية: استدعاء حقيقي في سكربتات التحقق أو الاختبارات ────────────
const readAll = (dir) =>
  readdirSync(join(appRoot, dir))
    .filter((file) => /\.(mjs|ts|tsx)$/.test(file))
    .map((file) => readFileSync(join(appRoot, dir, file), 'utf8'))
    .join('\n')
const gateSources = readAll('scripts')
const testSources = readAll('tests')
const callSites = (name, text) => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (text.match(new RegExp(`\\.${escaped}\\(`, 'g')) ?? []).length
}
for (const surface of surfaces) {
  surface.gateCalls = callSites(surface.name, gateSources)
  surface.testCalls = callSites(surface.name, testSources)
  surface.covered = surface.gateCalls + surface.testCalls > 0
}

const uncovered = surfaces.filter((s) => !s.covered)
const uncoveredMoney = uncovered.filter((s) => s.money)
const moneySurfaces = surfaces.filter((s) => s.money)
const stockSurfaces = surfaces.filter((s) => s.stock)

// ── ⑤ توليد وثيقة الحصر (مصدر الحقيقة للتغطية) ──────────────────────────────
const rows = [...surfaces]
  .sort((a, b) => Number(b.money) - Number(a.money) || Number(b.stock) - Number(a.stock) || a.name.localeCompare(b.name))
  .map((s) => `| \`${s.name}\` | ${s.money ? '💰 مالي' : '—'} | ${s.stock ? '📦 مخزون' : '—'} | ${s.gateCalls} | ${s.testCalls} | ${s.covered ? '✅' : '❌'} |`)
const doc = `# تغطية أسطح المتجر — وثيقة مولَّدة آلياً

> تُولَّد بـ\`node --experimental-strip-types app/scripts/verify_surface_coverage.mjs\`.
> لا تُحرَّر يدوياً؛ البوابة تفشل إن بقي سطح بلا استدعاء في التحقق أو الاختبار.

## الملخّص

| القياس | العدد |
|---|---|
| أعضاء واجهة المتجر | ${ifaceMembers.length} |
| أسطح مُنفَّذة (دوال) | ${surfaces.length} |
| أسطح مالية (تكتب دفتراً/خزائن) | ${moneySurfaces.length} |
| أسطح تمسّ المخزون | ${stockSurfaces.length} |
| أسطح مغطّاة باستدعاء فعلي | ${surfaces.length - uncovered.length} |
| **أسطح غير مغطّاة** | **${uncovered.length}** |
${uncovered.length ? `\nغير المغطّاة: ${uncovered.map((s) => '`' + s.name + '`').join(' · ')}\n` : ''}
## المصفوفة الكاملة

| السطح | التصنيف | المخزون | استدعاءات البوابات | استدعاءات الاختبارات | التغطية |
|---|---|---|---|---|---|
${rows.join('\n')}
`
writeFileSync(join(appRoot, '..', 'docs', 'تغطية_الأسطح.md'), doc)

// ── ⑥ الحكم ─────────────────────────────────────────────────────────────────
console.log('🔎 حصر أسطح المتجر')
console.log(`   أعضاء الواجهة: ${ifaceMembers.length} · أسطح مُنفَّذة: ${surfaces.length} · مالية: ${moneySurfaces.length} · مخزون: ${stockSurfaces.length}`)
if (uncovered.length) {
  console.log(`\n❌ أسطح بلا أي استدعاء في التحقق أو الاختبار (${uncovered.length}):`)
  for (const s of uncovered) console.log(`   - ${s.name}${s.money ? ' (مالي!)' : ''}`)
  console.log('\n   القاعدة: كل سطح يُنفَّذ في المتجر يجب أن يظهر في بوابة تحقق أو اختبار.')
  process.exit(1)
}
if (!moneySurfaces.length) {
  console.log('❌ التصنيف المالي لم يلتقط أي سطح — تغيّر شكل الكود وأصبحت البوابة عمياء')
  process.exit(1)
}
console.log(`\n✅ تغطية الأسطح: ${surfaces.length}/${surfaces.length} سطحاً · منها ${moneySurfaces.length} مالياً و${stockSurfaces.length} مخزونياً — لا سطح خارج الفحص`)
console.log('   وثيقة التغطية: docs/تغطية_الأسطح.md')
