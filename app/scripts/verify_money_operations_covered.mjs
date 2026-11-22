/**
 * بوابة «لا عملية مالية بلا دليل» — سقف تغطية لا يهبط.
 *
 * المنهج: تُستخرج كل عمليات المتجر من واجهة `DataStore` في repo.ts، ثم تُصنَّف
 * العمليات المالية (ترحيل/بيع/شراء/تحصيل/صرف/تسوية/إقفال/تعديل/إهلاك/اعتماد…)،
 * ويُشترط لكل واحدة أن يظهر اسمها كنداء فعلي في اختبار أو بوابة تحقق أو رحلة.
 * الغرض: منع إضافة عملية مالية جديدة بلا أي دليل تشغيلي (وهو ما حدث فعلياً في
 * الماضي: 6 عمليات في الواجهة بلا أي مرجع).
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'

const R = reporter('تغطية العمليات المالية بدليل تشغيلي')
const root = fileURLToPath(new URL('..', import.meta.url))

const repoSource = readFileSync(join(root, 'src/data/repo.ts'), 'utf8')
// واجهة المتجر فقط: كل ما قبلها/بعدها قد يحتوي خصائص كائنات بنفس الإزاحة (كان يُعدّ خطأً «عملية»)
const interfaceStart = repoSource.indexOf('interface DataState {')
assert.ok(interfaceStart > 0, 'لم تُوجد واجهة DataState')
const interfaceEnd = repoSource.indexOf('\n}\n', interfaceStart)
const interfaceSource = repoSource.slice(interfaceStart, interfaceEnd)
const operations = [...new Set([...interfaceSource.matchAll(/^ {2}([A-Za-z_$][\w$]*): \(/gm)].map((m) => m[1]))]

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (/\.(ts|tsx|mjs)$/.test(entry)) files.push(full)
  }
}
walk(join(root, 'tests'))
walk(join(root, 'scripts'))

const corpus = files.filter((file) => !file.endsWith('verify_money_operations_covered.mjs'))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

/* تصنيف سلوكي لا اسمي: العملية «مالية» إن كتبت في الدفتر (`journal: [`)، أو إن
   فوّضت الترحيل إلى عملية كذلك (`get().op(`). التصنيف بالاسم وحده كان يترك 36 عملية
   تُرحّل قيوداً خارج حساب «المالية» لأن أسماءها تبدأ بـadd أو register أو open أو fund أو cancel. */
const repoLines = repoSource.split('\n')
const storeStart = repoLines.findIndex((line) => line.includes('useRawDataStore = create<DataState>()'))
const heads = []
repoLines.forEach((line, index) => {
  const match = /^ {6}([A-Za-z_$][\w$]*)\s*:/.exec(line)
  if (match && index > storeStart) heads.push({ index, name: match[1] })
})
heads.push({ index: repoLines.length, name: '__END__' })
const segments = new Map()
for (let i = 0; i < heads.length - 1; i += 1) {
  const segment = repoLines.slice(heads[i].index, heads[i + 1].index).join('\n')
  if (!segments.has(heads[i].name)) segments.set(heads[i].name, segment)
}

const known = operations.filter((op) => segments.has(op))
const directPosting = new Set(known.filter((op) => segments.get(op).includes('journal: [')))
const callsOf = new Map(known.map((op) => [op, new Set([...segments.get(op).matchAll(/get\(\)\.(\w+)\(/g)].map((m) => m[1]))]))
const posting = new Set(directPosting)
for (let changed = true; changed;) {
  changed = false
  for (const op of known) {
    if (posting.has(op)) continue
    if ([...callsOf.get(op)].some((callee) => posting.has(callee))) { posting.add(op); changed = true }
  }
}

console.log(`  إجمالي العمليات المستخرجة: ${operations.length}`)
console.log(`  ترحّل قيداً بنصّها: ${directPosting.size} · وبالتفويض (استدعاء عملية ترحّل): ${posting.size}`)

/* ① كل عملية ترحّل قيداً — بالاسم أو بالسلوك — لا بد لها من دليل تشغيلي */
const hasEvidence = (op) => new RegExp(`\\b${op}\\s*\\(`).test(corpus)
const uncoveredPosting = [...posting].filter((op) => !hasEvidence(op)).sort()
assert.deepEqual(uncoveredPosting, [], `عمليات ترحّل قيوداً بلا أي دليل (اختبار/بوابة/رحلة): ${uncoveredPosting.join('، ')}`)
R.ok(`${posting.size} عملية ترحّل قيداً — لكل واحدة دليل تشغيلي`)

/* ①½ مصفوفة الحراس: كل عملية ترحّل قيداً إما تحرس بنفسها (`throw`) أو تفوّض الترحيل
   إلى عملية محروسة — كشف هذا سابقاً أدوات مالية بلا أي حارس. وكل عملية تبني القيد
   بنفسها يجب أن تسمّي نوع المصدر (sourceType) لأن بوابة الدفتر تشترط ربط المصدر. */
const guarded = (op) => segments.get(op)?.includes('throw new') ?? false
const delegatesToGuarded = (op) => [...(callsOf.get(op) ?? [])].some((callee) => guarded(callee))
const unguarded = [...posting].filter((op) => !guarded(op) && !delegatesToGuarded(op)).sort()
assert.deepEqual(unguarded, [], `عمليات ترحّل قيوداً بلا حارس ولا تفويض محروس: ${unguarded.join('، ')}`)
/** بواني القيود المشتركة على مستوى الملف (دوال `function X(...)` تحتوي sourceType):
 *  العملية التي تفوّض بناء القيد إليها تسمّي مصدرها **عبر الباني** لا بنصّها، وهو
 *  التفويض المقصود (إقفال الوردية والتسوية يشتركان في باني واحد بدل منطقين يتفرقان).
 *  لا تسامح: الباني نفسه يجب أن يحمل sourceType وإلا بقيت العملية مخالفة. */
const sharedBuilders = new Set(
  [...repoSource.matchAll(/^function (\w+)\([\s\S]*?\n\}/gm)]
    .filter((match) => match[0].includes('sourceType'))
    .map((match) => match[1]),
)
const namesSourceViaBuilder = (op) => [...sharedBuilders].some((builder) => (segments.get(op) ?? '').includes(`${builder}(`))
const missingSource = [...directPosting]
  .filter((op) => !(segments.get(op) ?? '').includes('sourceType') && !namesSourceViaBuilder(op))
  .sort()
assert.deepEqual(missingSource, [], `عمليات تبني قيداً بلا sourceType: ${missingSource.join('، ')}`)
R.ok(`مصفوفة الحراس: ${posting.size} عملية ترحّل — محروسة مباشرة أو بتفويض إلى عملية محروسة · ${directPosting.size} تبني القيد وتسمّي مصدره`)

/* ② تصنيف إضافي بالاسم: يمسك مسارات مالية لا تكتب في الدفتر (ماكينات، اعتمادات، عهد،
   إهلاك، إلغاء…) فلا يفلت مسار مالي من الدليل لأن اسمه لا يبدأ بـpost. */
const MONEY = /^(post|sell|buy|settle|pay|issue|collect|refund|close|edit|run|remit|release|decide|receive|transfer|withdraw|depreciate|dispose|restore|reprice|redeem|apply|reverse|record)/
const NOT_MONEY = new Set([
  'postTransfer',         // حركة مخزون داخلية بلا قيد (مغطاة باختباراتها)
  'restoreNotifications', // استعادة إعدادات إشعارات لا نقود
])
const moneyOps = operations.filter((op) => MONEY.test(op) && !NOT_MONEY.has(op) && !posting.has(op))
const uncoveredMoney = moneyOps.filter((op) => !hasEvidence(op))
assert.deepEqual(uncoveredMoney, [], `عمليات مالية (بالاسم) بلا دليل: ${uncoveredMoney.join('، ')}`)
R.ok(`${moneyOps.length} عملية مالية بالاسم خارج مسارات الترحيل — لكل واحدة دليل`)

/* ③ نسبة تغطية كلية بسقف لا يهبط */
const coveredAll = operations.filter(hasEvidence)
const ratio = coveredAll.length / operations.length
console.log(`  العمليات الكلية المغطّاة بدليل: ${coveredAll.length}/${operations.length} (${(ratio * 100).toFixed(1)}%)`)
const RATCHET = 1 // 420/420 = 100%: أي عملية جديدة تُضاف بلا دليل تُفشل البوابة فوراً
assert.ok(ratio >= RATCHET, `نسبة تغطية العمليات هبطت إلى ${(ratio * 100).toFixed(1)}% (الحد ${(RATCHET * 100).toFixed(1)}%)`)
R.ok(`نسبة التغطية ${(ratio * 100).toFixed(1)}% ≥ ${(RATCHET * 100).toFixed(1)}% (سقف لا يهبط)`)
const uncoveredAll = operations.filter((op) => !hasEvidence(op))
if (uncoveredAll.length) console.log(`  ⓘ بلا دليل مباشر: ${uncoveredAll.join('، ')}`)

/* ④ لا عملية بلا مستدعٍ في التطبيق: الفحص الكامل في verify_ops_reachability.mjs
   (رسم استيراد من نقاط الدخول) — هنا نضمن فقط ألّا تختفي البوابة من التشغيل. */
assert.ok(existsSync(join(root, 'scripts/verify_ops_reachability.mjs')), 'بوابة وصول العمليات مفقودة')
R.done()
