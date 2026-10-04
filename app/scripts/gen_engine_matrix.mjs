/**
 * gen_engine_matrix.mjs — يولّد `docs/مصفوفة_المحرك_المحاسبي.md` من الكود مباشرة.
 *
 * المرحلة 0 من خطة التدقيق: لا يمكن تدقيق ما لا نراه مجتمعاً. يستخرج هذا المولّد
 * لكل مسار ترحيل: الدالة · المستند · نوع المصدر · الحسابات المدينة · الحسابات الدائنة ·
 * الوحدة المطلوبة · الأنشطة التي تصله · الملف والسطر.
 *
 * التشغيل: node --experimental-strip-types scripts/gen_engine_matrix.mjs
 * بوابة المطابقة: scripts/verify_engine_matrix.mjs (تفشل إن تغيّر الكود ولم تُحدَّث الوثيقة)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { argv } from 'node:process'

const APP = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(APP, 'src')
const OUT = join(APP, '..', 'docs', 'مصفوفة_المحرك_المحاسبي.md')

const { STANDARD_COA } = await import(new URL('../src/core/ledger.ts', import.meta.url).href)
const { ACCOUNT_MODULE_MAP } = await import(new URL('../src/core/coaVisibility.ts', import.meta.url).href)
const { ACTIVITY_TEMPLATES, effectiveModules } = await import(new URL('../src/core/activities.ts', import.meta.url).href)

const ACC_NAME = new Map(STANDARD_COA.map((a) => [a.code, a.nameAr]))
const nameOf = (code) => ACC_NAME.get(code) ?? (code.startsWith('11') ? 'خزينة/بنك' : code)

export function buildMatrix() {
// ————————————————————————————————————————————————
// 1) جمع كل ملفات النواة والبيانات
// ————————————————————————————————————————————————
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (!/ui|assets/.test(e.name)) walk(p, acc) }
    else if (/\.ts$/.test(e.name)) acc.push(p)
  }
  return acc
}
const files = [...walk(join(SRC, 'core')), join(SRC, 'data', 'repo.ts')]

// ————————————————————————————————————————————————
// 2) استخراج الدوال وأسطر الحسابات داخلها
// ————————————————————————————————————————————————
/** يحدد اسم الدالة الحاضنة لسطر معين (أقرب تعريف دالة قبله) */
function enclosingFn(lines, idx) {
  for (let i = idx; i >= 0; i--) {
    const l = lines[i]
    let m = l.match(/^export (?:async )?function ([A-Za-z0-9_]+)/)
    if (m) return m[1]
    m = l.match(/^\s{6}([a-zA-Z][A-Za-z0-9_]*): (?:\(|async \()/) // إجراء zustand داخل repo
    if (m) return m[1]
    m = l.match(/^(?:export )?(?:const|function) ([A-Za-z0-9_]+)\s*[=(]/)
    if (m) return m[1]
  }
  return '(مستوى الوحدة)'
}

const paths = new Map() // key: file#fn → { file, fn, debits:Set, credits:Set, sources:Set, docs:Set, line }

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const rel = file.replace(APP, 'app/').replaceAll('\\', '/')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // أ) أسطر الحسابات: accountCode: '1103', debit: X, credit: Y  (قد تكون على سطر واحد أو ثلاثة)
    const re = /accountCode:\s*'(\d{4})'/g
    let m
    while ((m = re.exec(line))) {
      const code = m[1]
      const window = (line.slice(m.index) + ' ' + (lines[i + 1] ?? '') + ' ' + (lines[i + 2] ?? '')).slice(0, 220)
      const dm = window.match(/debit:\s*([^,}\n]+)/)
      const cm = window.match(/credit:\s*([^,}\n]+)/)
      const isZero = (v) => v != null && v.trim() === '0'
      const fn = enclosingFn(lines, i)
      const key = `${rel}#${fn}`
      if (!paths.has(key)) paths.set(key, { file: rel, fn, debits: new Set(), credits: new Set(), sources: new Set(), docs: new Set(), calls: new Set(), line: i + 1 })
      const p = paths.get(key)
      if (dm && !isZero(dm[1])) p.debits.add(code)
      if (cm && !isZero(cm[1])) p.credits.add(code)
      if (!dm && !cm) { p.debits.add(code); p.credits.add(code) } // شكل غير معتاد — سجّله على الجانبين
    }
    // ب) حساب ديناميكي (خزينة/بنك أو حساب يختاره المستخدم) — نلتقط اسم المتغير
    const dynRe = /accountCode:\s*([A-Za-z_][A-Za-z0-9_.?]*)/g
    let dm3
    while ((dm3 = dynRe.exec(line))) {
      const ident = dm3[1]
      if (/^(String|Number|code)$/.test(ident)) continue
      const fn = enclosingFn(lines, i)
      const key = `${rel}#${fn}`
      if (!paths.has(key)) paths.set(key, { file: rel, fn, debits: new Set(), credits: new Set(), sources: new Set(), docs: new Set(), calls: new Set(), line: i + 1 })
      const w = (line.slice(dm3.index) + ' ' + (lines[i + 1] ?? '')).slice(0, 200)
      const label = /treasury|Treasury|from|to|^t$|pay|account|Account|acc$/.test(ident) ? 'خزينة*' : `«${ident}»`
      const dd = w.match(/debit:\s*([^,}\n]+)/)
      const cc = w.match(/credit:\s*([^,}\n]+)/)
      if (dd && dd[1].trim() !== '0') paths.get(key).debits.add(label)
      if (cc && cc[1].trim() !== '0') paths.get(key).credits.add(label)
      if (!dd && !cc) { paths.get(key).debits.add(label); paths.get(key).credits.add(label) }
    }
    // ب2) استدعاء بُناة القيود (المسار يفوّض بناء سطوره)
    for (const cm2 of line.matchAll(/\b(build[A-Z][A-Za-z0-9_]*)\(/g)) {
      const fn = enclosingFn(lines, i)
      if (fn === cm2[1]) continue
      const key = `${rel}#${fn}`
      if (!paths.has(key)) paths.set(key, { file: rel, fn, debits: new Set(), credits: new Set(), sources: new Set(), docs: new Set(), calls: new Set(), line: i + 1 })
      paths.get(key).calls.add(cm2[1])
    }
    // ج) نوع المصدر (sourceType: 'x' أو src: 'x' as const للمسارات المفهرسة)
    const sm = line.match(/sourceType:\s*'([a-z_]+)'/) || line.match(/\bsrc:\s*'([a-z_]+)' as const/)
    if (sm) {
      const fn = enclosingFn(lines, i)
      const key = `${rel}#${fn}`
      if (!paths.has(key)) paths.set(key, { file: rel, fn, debits: new Set(), credits: new Set(), sources: new Set(), docs: new Set(), calls: new Set(), line: i + 1 })
      for (const one of line.matchAll(/(?:sourceType:\s*|\bsrc:\s*)'([a-z_]+)'/g)) paths.get(key).sources.add(one[1])
    }
    // د) بادئة المستند (رقم مرقّم)
    const dm2 = [...line.matchAll(/`([A-Z]{2,4})-\$\{/g)]
    for (const d of dm2) {
      const fn = enclosingFn(lines, i)
      const key = `${rel}#${fn}`
      if (!paths.has(key)) paths.set(key, { file: rel, fn, debits: new Set(), credits: new Set(), sources: new Set(), docs: new Set(), calls: new Set(), line: i + 1 })
      paths.get(key).docs.add(`${d[1]}-####`)
    }
  }
}

// ————————————————————————————————————————————————
// 3) الوحدة المطلوبة والأنشطة التي تصل المسار
// ————————————————————————————————————————————————
const ACTIVITY_MODULES = new Map(ACTIVITY_TEMPLATES.map((a) => [a.id, effectiveModules(a.id, [])]))

function modulesOf(p) {
  const mods = new Set()
  for (const code of [...p.debits, ...p.credits]) {
    const m = ACCOUNT_MODULE_MAP[code]
    if (m) for (const x of m) mods.add(x)
  }
  // تلميح من اسم الدالة (postTrip → logistics …)
  const byFn = { postTrip: 'logistics', postProduction: 'recipes', postProcessing: 'processing', postGoldTradeIn: 'jewelry', postWalletService: 'wallet_services', postInsuredSale: 'lab', postSale: 'pos', postSaleReturn: 'pos', postExchange: 'pos', postPurchase: 'purchases', postPurchaseReturn: 'purchases', postStocktake: 'inventory', postWastage: 'inventory', postConsumption: 'inventory' }
  if (byFn[p.fn]) mods.add(byFn[p.fn])
  // تلميح من اسم الملف (contracting.ts → contracting …)
  const base = p.file.split('/').pop().replace('.ts', '')
  const byFile = { contracting: 'contracting', realestate: 'realestate', lab: 'lab', cars: 'cars', laundry: 'laundry', logistics: 'logistics', rental: 'equipment_rental', rentalMeter: 'equipment_rental', maintenance: 'maintenance', processing: 'processing', prescription: 'pharmacy', pos: 'pos', purchases: 'purchases', installments: 'installments' }
  if (byFile[base]) mods.add(byFile[base])
  return [...mods]
}

function activitiesOf(mods) {
  if (!mods.length) return { count: ACTIVITY_TEMPLATES.length, label: 'كل الأنشطة (مسار عام)' }
  const hit = [...ACTIVITY_MODULES.entries()].filter(([, ms]) => mods.some((m) => ms.includes(m))).map(([id]) => id)
  return { count: hit.length, label: hit.length === ACTIVITY_TEMPLATES.length ? 'كل الأنشطة' : `${hit.length}: ${hit.join('، ')}` }
}

// ————————————————————————————————————————————————
// 4) بناء الوثيقة
// ————————————————————————————————————————————————
const rows = [...paths.values()]
  .filter((p) => (p.debits.size || p.credits.size || p.sources.size) && p.fn !== '(مستوى الوحدة)')
  .sort((a, b) => (a.file === b.file ? a.fn.localeCompare(b.fn) : a.file.localeCompare(b.file)))

const fmt = (set) => [...set].sort().map((c) => (c === 'خزينة*' ? '**خزينة/بنك**' : `${c} ${nameOf(c)}`)).join(' · ') || '—'

const byFile = new Map()
for (const r of rows) {
  if (!byFile.has(r.file)) byFile.set(r.file, [])
  byFile.get(r.file).push(r)
}

const allSources = new Set(rows.flatMap((r) => [...r.sources]))
const allAccounts = new Set(rows.flatMap((r) => [...r.debits, ...r.credits].filter((c) => /^\d{4}$/.test(c))))

let md = `# مصفوفة المحرك المحاسبي — كل مسار ترحيل في «تَحَكَّم»

> **وثيقة مولَّدة آلياً** بـ\`node --experimental-strip-types app/scripts/gen_engine_matrix.mjs\` — لا تحررها يدوياً.
> تُجدَّد مع كل تغيير في محرك القيود، وتفحصها البوابة \`verify_engine_matrix.mjs\`.
>
> الغرض (المرحلة 0 من \`docs/خطة_التدقيق_المحاسبي_الشامل_2026.md\`): رؤية **كل** مسار يُنشئ قيداً في مكان واحد،
> ليُختبر كل مسار ضد **الثوابت العشرة** (AGENTS.md §3.5) في كل نشاط وكل وحدة مطعَّمة.

**الإجمالي: ${rows.length} مسار ترحيل** في ${byFile.size} ملفاً · ${allSources.size} نوع مصدر (\`SourceType\`) · ${allAccounts.size} حساباً مستعملاً.

**كيف تقرأ الجدول:** «مدين/دائن» مستخرجة من سطور القيد الفعلية في الكود (\`accountCode\` + الطرف غير الصفري).
**خزينة/بنك** تعني حساباً ديناميكياً يختاره المستخدم (\`1101\`/\`1102\`/خزائن مضافة). عمود «الأنشطة» يحسب
الأنشطة التي تُفعَّل لديها الوحدة المطلوبة افتراضياً — وأي نشاط آخر يصل المسار **فقط** بتطعيم الوحدة عبر رخصة موقّعة.

`

for (const [file, list] of byFile) {
  md += `\n## ${file}\n\n| الدالة | المستند | نوع المصدر | مدين | دائن | يفوّض إلى | الوحدة | الأنشطة |\n|---|---|---|---|---|---|---|---|\n`
  for (const r of list) {
    const mods = modulesOf(r)
    const act = activitiesOf(mods)
    md += `| \`${r.fn}\` (:${r.line}) | ${[...r.docs].join('، ') || '—'} | ${[...r.sources].map((s) => `\`${s}\``).join('، ') || '—'} | ${fmt(r.debits)} | ${fmt(r.credits)} | ${[...(r.calls ?? [])].map((x) => `\`${x}\``).join('، ') || '—'} | ${mods.join('، ') || 'عام'} | ${act.count} |\n`
  }
}

md += `\n## تغطية أنواع المصادر\n\n`
md += `أنواع المصدر الظاهرة في مسارات الترحيل (${allSources.size}): ${[...allSources].sort().map((s) => `\`${s}\``).join(' · ')}\n`

md += `\n## تغطية الحسابات\n\n`
const used = [...allAccounts].sort()
const postable = STANDARD_COA.filter((a) => a.isPostable).map((a) => a.code)
const unused = postable.filter((c) => !used.includes(c))
md += `- حسابات قابلة للترحيل: **${postable.length}** · ظاهرة في مسارات الترحيل: **${used.length}**.\n`
md += `- بلا مسار ترحيل ثابت (ديناميكية أو معلّقة — راجع AUDIT-004): ${unused.map((c) => `${c} ${nameOf(c)}`).join(' · ') || 'لا شيء'}.\n`

return { md, rows, sources: allSources, accounts: used, unused }
}

export const MATRIX_PATH = OUT

if (argv[1] && argv[1].endsWith('gen_engine_matrix.mjs')) {
  const { md, rows, sources, accounts } = buildMatrix()
  writeFileSync(OUT, md, 'utf8')
  console.log(`\u2705 تولّدت المصفوفة: ${rows.length} مسار ترحيل \u00b7 ${sources.size} نوع مصدر \u00b7 ${accounts.length} حساباً`)
  console.log(`   ${OUT}`)
}
