/**
 * verify_whole_tree_review.mjs — ⑧ مراجعة الشجرة بأكملها.
 *
 * البوابات السابقة تفحص **سلوكاً على مدخلات مصنوعة** (مستند، قيد، تقرير، حملة أنشطة).
 * هذه البوابة تفحص **الشجرة نفسها**: كل ملف مصدري (460 ملفاً) مقابل ثوابت بنيوية،
 * لأن الفجوة التي لا يراها أي اختبار سلوكي هي أن الكود **موجود ولا يُستدعى**، أو
 * يُستدعى بأداة لا تعمل في بيئة التوزيع، أو يعتمد على مفتاح تخزين بلا مساحة اسم،
 * أو صفحة لا يرسمها أي فحص إطلاقاً.
 *
 * الثوابت (12):
 *   R1  كل صفحة في `src/ui/pages` تُصدِّر مكوّناً `*Page` موصولاً بشجرة `App` (وصول عبر الاستيراد).
 *   R2  لا `window.prompt` في الشجرة — Electron لا يدعمه أصلاً فيتعطل الزر عند المالك.
 *   R3  لا `confirm/prompt/alert` نظامية خارج المسموح الموثَّق (يفضّل Modal التطبيق).
 *   R4  لا `console.*` خارج المسموح الموثَّق (سجل تشخيص مقصود).
 *   R5  لا `dangerouslySetInnerHTML` ولا `eval` ولا `new Function` (تنقية العرض أولاً).
 *   R6  لا كتلة `catch` فارغة: كل فشل يُعالج أو يُرفع، لا يُبتلع.
 *   R7  لا `TODO/FIXME/HACK` معلّقة في الشجرة (العمل يُسجَّل في وثيقة أو يُنجز).
 *   R8  كل مفاتيح `localStorage` بمساحة اسم (`shopsys`/`tahakam`) — لا تصادم مع مضيف.
 *   R9  كل `fetch(` للشبكة يمرّ عبر المسوّغ (تلغرام فقط) ولا استدعاء خام من صفحة.
 *   R10 لا تصادم أسماء ملفات بحالة أحرف مختلفة (كسور على ويندوز).
 *   R11 كل تصدير في `src/core` له مستهلك، أو مسوَّغ بسبب مكتوب في `DEAD_EXPORTS`.
 *   R12 كل صفحة يشير إليها اختبار، أو مسوَّغة بسبب مكتوب في `UNTESTED_PAGES`.
 *
 * لا استثناء بلا سبب مكتوب: كل قائمة مسوَّغة هنا تحتوي السبب، ويزداد عددُ فحوصها
 * لا يقل. أي فجوة جديدة = فشل البوابة، وأي تسويف قديم = فشل البوابة أيضاً (تسويف
 * لا يطابق الواقع يُحذف).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'
import { DEAD_EXPORT_BASELINE, DEAD_EXPORT_CEILING } from './dead_export_baseline.mjs'

const R = reporter('مراجعة الشجرة')
/**
 * R.check صار في `auditKit.reporter` نفسه: يجمع المخالفات ويُفشل البوابة في
 * `done()` بدل أن تعرّف كل بوابة نسختها. الفحص هنا يمرّر المخالفين في تفصيل
 * الرسالة حتى يعرف المطوّر الموضع بلا إعادة تشغيل.
 */
const check = (condition, message, offenders = []) =>
  R.check(condition, message, offenders.length ? `المخالف: ${offenders.slice(0, 8).join(' · ')}` : '')
const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const SRC = join(appRoot, 'src')

/** ⑧ — يمشي على كل ملفات src ويعيد محتواها */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const files = walk(SRC)
const source = new Map(files.map((file) => [relative(appRoot, file), readFileSync(file, 'utf8')]))
const allText = [...source.values()].join('\n')
const lineOf = (text, index) => text.slice(0, index).split('\n').length

/* ─── تسويفات موثقة: السبب مكتوب، والواقع يُتحقق منه ─── */
const CONSOLE_ALLOWED = new Map([
  ['src/App.tsx', 'سجل تشخيص عند فشل تدقيق الترخيص عند الإقلاع — لا واجهة تُظهره للمستخدم'],
  ['src/data/lan/hostSession.ts', 'تحذير أمني عند محاولة اقتران برمز خاطئ — يُسجَّل للمشرف'],
])
/* لا تسويف: نافذة تأكيد النظام ممنوعة في الشجرة كلها — البديل الداخلي
   `<ConfirmHost/>` + `confirmDialog()` (نافذة تتبع لغة التطبيق وتعمل في Electron). */
const FETCH_ALLOWED = new Map([
  ['src/ui/LoginScreen.tsx', 'إرسال رمز دخول عبر بوت تلغرام — العميل نفسه'],
  ['src/ui/pages/TelegramPage.tsx', 'لوحة إعداد البوت: استدعاء getMe/sendMessage'],
  ['src/ui/telegramSender.ts', 'العميل الوحيد لتلغرام — يُعيد الاستخدام'],
])
const UNTESTED_PAGES = new Map([
  ['ActivityInvoicesHubs.tsx', 'مكوّنات تبويب لفواتير لوجستية/إيجار/عقار — تُركّب من صفحات الفواتير المفحوصة بـprops مشروع'],
  ['FxConversionDateRepair.tsx', 'أداة إصلاح تُركّب داخل شاشة إصلاح العملة بـprops عملة الدفتر'],
  ['FxExternalHistoryRepair.tsx', 'أداة إصلاح تُركّب داخل شاشة إصلاح العملة بـprops عملة الدفتر'],
])

/* ─── R1: وصول الصفحات عبر شجرة الاستيراد من App.tsx ─── */
const importPattern = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g
function resolveImport(fromRel, spec) {
  const base = resolve(dirname(join(appRoot, fromRel)), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return relative(appRoot, candidate)
  }
  return null
}
const reachable = new Set()
const queue = ['src/App.tsx']
while (queue.length) {
  const file = queue.pop()
  if (reachable.has(file) || !source.has(file)) continue
  reachable.add(file)
  for (const match of source.get(file).matchAll(importPattern)) {
    const target = resolveImport(file, match[1])
    if (target && source.has(target)) queue.push(target)
  }
}
/* الشاشات وحدها: ملفات .tsx في مجلد الصفحات (ملفات المساعدة .ts ليست شاشات) */
const pageFiles = [...source.keys()].filter((file) => file.startsWith('src/ui/pages/') && file.endsWith('.tsx'))
const exportedPageComponents = (text) => [...text.matchAll(/export function (\w+)/g)].map((hit) => hit[1])
const unreachable = pageFiles.filter((file) => {
  const components = exportedPageComponents(source.get(file))
  const looksLikeScreen = components.some((name) => /Page$/.test(name))
  return looksLikeScreen && !reachable.has(file)
})
check(unreachable.length === 0, `R1 كل شاشة موصولة بشجرة App (${pageFiles.length} ملف صفحة)`, unreachable)

/* ─── R2/R3: النوافذ النظامية ─── */
const promptHits = []
const dialogHits = []
for (const [file, text] of source) {
  if (file === 'src/ui/components/TextPrompt.tsx') continue // الشرح لا الاستدعاء
  for (const match of text.matchAll(/window\.prompt\s*\(/g)) promptHits.push(`${file}:${lineOf(text, match.index)}`)
  if (/window\.(alert|confirm)\s*\(/.test(text)) dialogHits.push(file)
}
check(promptHits.length === 0, 'R2 لا window.prompt في الشجرة (غير مدعوم في Electron)', promptHits)
check(dialogHits.length === 0, 'R3 لا confirm/alert نظامية في الشجرة كلها (البديل ConfirmHost الداخلي)', dialogHits)

/* ─── R4: console ─── */
const consoleHits = []
for (const [file, text] of source) {
  const hits = [...text.matchAll(/console\.(log|debug|warn|error|info)\s*\(/g)]
  if (hits.length && !CONSOLE_ALLOWED.has(file)) consoleHits.push(`${file}:${hits.length}`)
}
check(consoleHits.length === 0, `R4 console مقصور على ${CONSOLE_ALLOWED.size} موضع تشخيص موثّق`, consoleHits)

/* ─── R5: حقن HTML ─── */
const injection = []
for (const [file, text] of source) {
  if (/dangerouslySetInnerHTML/.test(text)) injection.push(`${file}: dangerouslySetInnerHTML`)
  if (/\beval\s*\(|new Function\s*\(/.test(text)) injection.push(`${file}: eval/Function`)
}
check(injection.length === 0, 'R5 لا حقن HTML ولا تنفيذ نصي ديناميكي', injection)

/* ─── R6: catch فارغ ─── */
const emptyCatch = []
let documentedSilence = 0
for (const [file, text] of source) {
  for (const match of text.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([^}]*)\}/g)) {
    const raw = match[1]
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').trim()
    if (code !== '') continue
    /* الصمت لا يُقبل مجرداً: يُشترط تعليق يشرح لماذا لا يُعالج الخطأ هنا */
    const reason = [...raw.matchAll(/\/\*([\s\S]*?)\*\/|\/\/([^\n]*)/g)].map((hit) => (hit[1] ?? hit[2]).trim()).join(' ')
    if (reason.length >= 3) documentedSilence++
    else emptyCatch.push(`${file}:${lineOf(text, match.index)} — بلا سبب`)
  }
}
check(emptyCatch.length === 0, `R6 لا catch صامت بلا سبب (${documentedSilence} صمتاً موثّقاً بتعليق)`, emptyCatch)

/* ─── R7: معلقات ─── */
const todoHits = []
for (const [file, text] of source) {
  if (/\b(TODO|FIXME|HACK)\b/.test(text)) todoHits.push(file)
}
check(todoHits.length === 0, 'R7 لا TODO/FIXME/HACK معلّقة', todoHits)

/* ─── R8: مساحات أسماء التخزين ─── */
const badKeys = []
const keys = new Set()
for (const [file, text] of source) {
  for (const match of text.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*'([^']+)'/g)) {
    keys.add(match[1])
    if (!/^(shopsys|tahakam)/.test(match[1])) badKeys.push(`${file}: ${match[1]}`)
  }
}
check(badKeys.length === 0, `R8 كل مفاتيح التخزين (${keys.size}) بمساحة اسم`, badKeys)

/* ─── R9: الشبكة ─── */
const fetchHits = []
for (const [file, text] of source) {
  if (!/\bfetch\s*\(/.test(text)) continue
  /* طبقة الشبكة المسموغة: core/data (العملاء الشرعيون) وdev (عميل القاعدة التجريبية،
     محروس بـimport.meta.env.DEV فلا يعمل في نسخة المالك) */
  if (file.includes('/core/') || file.includes('/data/') || file.includes('/dev/')) continue
  if (!FETCH_ALLOWED.has(file)) fetchHits.push(file)
}
check(fetchHits.length === 0, `R9 fetch في الواجهة مقصور على ${FETCH_ALLOWED.size} مسوّغ`, fetchHits)

/* ─── R10: تصادم الأسماء ─── */
const byName = new Map()
for (const file of source.keys()) {
  const key = basename(file).toLowerCase()
  byName.set(key, [...(byName.get(key) ?? []), file])
}
const collisions = [...byName.values()].filter((group) => group.length > 1).flat()
check(collisions.length === 0, `R10 لا تصادم أسماء ملفات (${source.size} ملفاً)`, collisions)

/* ─── R11: تصديرات بلا مستهلك ─── */
const identifierCount = new Map()
for (const match of allText.matchAll(/[A-Za-z_$][\w$]*/g)) {
  identifierCount.set(match[0], (identifierCount.get(match[0]) ?? 0) + 1)
}
/** عدد مرات التصريح/إعادة التصدير لكل اسم في النواة */
const declared = new Map()
const coreExports = new Set()
for (const [file, text] of source) {
  if (!file.startsWith('src/core/')) continue
  /* الكود التشغيلي فقط: الأنواع والواجهات تختفي عند البناء فلا وزن لحملها */
  for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|enum)\s+(\w+)/g)) {
    coreExports.add(match[1])
    declared.set(match[1], (declared.get(match[1]) ?? 0) + 1)
  }
}
const dead = []
for (const name of coreExports) {
  /* الاستخدام الحقيقي = كل ذكر للمعرّف ناقص مواضع التصريح/التصدير */
  const uses = (identifierCount.get(name) ?? 0) - (declared.get(name) ?? 0)
  if (uses <= 0 && !DEAD_EXPORT_BASELINE.has(name)) dead.push(name)
}
const staleDispositions = [...DEAD_EXPORT_BASELINE.keys()].filter((name) => {
  const uses = (identifierCount.get(name) ?? 0) - (declared.get(name) ?? 0)
  return !coreExports.has(name) || uses > 0
})
check(dead.length === 0 && staleDispositions.length === 0,
  `R11 كل تصدير تشغيلي في النواة (${coreExports.size}) له مستهلك أو في لقطة الدين (${DEAD_EXPORT_CEILING} سقفاً لا يزيد)`,
  [...dead, ...staleDispositions.map((name) => `${name} — له مستهلك الآن، احذفه من اللقطة`)])

/* سقف الدين لا يزيد: لو زادت أسماء اللقطة عن السقف المكتوب فشل الفحص */
check(DEAD_EXPORT_BASELINE.size <= DEAD_EXPORT_CEILING,
  `R11.1 سقف الدين ثابت: ${DEAD_EXPORT_BASELINE.size} من ${DEAD_EXPORT_CEILING} (لا يزيد)`)

/* ─── R12: كل صفحة مفحوصة ─── */
const testText = readdirSync(join(appRoot, 'tests'))
  .filter((name) => /\.(ts|tsx)$/.test(name))
  .map((name) => readFileSync(join(appRoot, 'tests', name), 'utf8'))
  .join('\n')
const untested = []
for (const file of pageFiles) {
  const name = basename(file, '.tsx')
  const referenced = testText.includes(`${name}.tsx`) || testText.includes(`/${name}'`)
  if (!referenced && !UNTESTED_PAGES.has(`${name}.tsx`)) untested.push(name)
}
const stalePageDispositions = [...UNTESTED_PAGES.keys()].filter((name) => {
  const moduleName = name.replace(/\.tsx$/, '')
  return testText.includes(`${moduleName}.tsx`)
})
check(untested.length === 0 && stalePageDispositions.length === 0,
  `R12 كل صفحة (${pageFiles.length}) يشير إليها اختبار أو تسويف مطابق`,
  [...untested, ...stalePageDispositions.map((name) => `${name} — صار مفحوصاً، احذف التسويف`)])

R.done('مراجعة الشجرة بأكملها')
