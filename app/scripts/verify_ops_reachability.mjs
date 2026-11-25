/**
 * بوابة «لا عملية بلا مستدعٍ في التطبيق» — رسم بياني حقيقي للاستيراد.
 *
 * السؤال الذي تجيب عنه: هل يمكن لمستخدم التطبيق أن يصل إلى هذه العملية فعلاً؟
 * الطريقة: نبني شجرة استيراد انطلاقاً من نقاط الدخول الحقيقية
 * (`src/main.tsx` للواجهة، `desktop/main.ts` و`hostServerMain.ts` و`preload.ts`
 * لسطح المكتب)، ثم نسأل عن كل عملية في `interface DataState`: هل ورد اسمها في أي
 * ملف **قابل للوصول** من نقطة دخول؟ ملف غير مستورد = شاشة لا تُفتح.
 *
 * لا نعتمد على فحص نصي على مجلد `src/ui` كاملاً: ملفات كثيرة هناك لا يستوردها
 * أحد، فكان الفحص النصي يعدّها «واجهة» وهي ميتة. هنا يُحسب الوصول فعلياً.
 *
 * كل عملية غير موصولة تُدرج في `UNWIRED` بسببها، وبذلك تمنع البوابة أي زيادة
 * صامتة في سطح ميت وتعطي قائمة عمل مقروءة بدل تقدير يدوي.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'

const R = reporter('وصول عمليات المتجر إلى مستخدم حقيقي')
const root = fileURLToPath(new URL('..', import.meta.url))

const ENTRIES = ['src/main.tsx', 'src/App.tsx', 'desktop/main.ts', 'desktop/hostServerMain.ts', 'desktop/preload.ts']
  .filter((file) => existsSync(join(root, file)))
assert.ok(ENTRIES.includes('src/main.tsx') && ENTRIES.includes('src/App.tsx'), 'نقاط دخول الواجهة مفقودة')

const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { if (entry !== 'node_modules') walk(full); continue }
    if (/\.(ts|tsx)$/.test(entry)) files.push(full)
  }
}
walk(join(root, 'src'))
walk(join(root, 'desktop'))

const resolveSpec = (spec, from) => {
  if (!spec.startsWith('.')) return null
  const base = normalize(join(dirname(from), spec))
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

const reachable = new Set()
const queue = ENTRIES.map((file) => join(root, file))
while (queue.length) {
  const file = queue.pop()
  if (reachable.has(file)) continue
  reachable.add(file)
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
    const target = resolveSpec(match[1], file)
    if (target && !reachable.has(target)) queue.push(target)
  }
}
R.ok(`شجرة الاستيراد من ${ENTRIES.length} نقطة دخول: ${reachable.size} ملفاً قابلاً للوصول من ${files.length}`)

/* ——— العمليات: هل ورد اسمها في ملف قابل للوصول (عدا مستودع البيانات نفسه)؟ ——— */
const repoSource = readFileSync(join(root, 'src/data/repo.ts'), 'utf8')
const interfaceStart = repoSource.indexOf('interface DataState {')
const interfaceEnd = repoSource.indexOf('\n}\n', interfaceStart)
const operations = [...new Set([...repoSource.slice(interfaceStart, interfaceEnd).matchAll(/^ {2}([A-Za-z_$][\w$]*): \(/gm)].map((m) => m[1]))]

const productionCorpus = [...reachable]
  .filter((file) => !file.endsWith(join('src', 'data', 'repo.ts')))
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

/**
 * عمليات غير موصولة بأي شاشة — كل واحدة بسببها القابل للتحقق.
 * وجودها هنا **إفصاح لا تبرئة**: البوابة تفشل إن ظهرت عملية غير موصولة غير مذكورة،
 * أو إن صارت عملية مذكورة موصولة (توثيق قديم) — فتبقى القائمة صادقة دائماً.
 */
const UNWIRED = new Map([
  // ── مسارات مالية جاهزة ومختبرة لكن لا شاشة تناديها (فجوات واجهة موثقة) ──
  ['payPayrollSlip', 'صرف قسيمة راتب واحدة (كلياً/جزئياً) — المسير يُصرف كاملاً بـpostPayroll، ولا شاشة للصرف الجزئي'],
  ['postInsuredSale', 'بيع كاشير بتغطية تأمين (عيادة/صيدلية) — العيادة تستخدم registerInsuredVisit والمختبر registerInsuredLabOrder، ولا مسار POS مؤمَّن'],
  ['recordPaymentTerminalTransaction', 'تسجيل عملية ماكينة يدوية (رد/إلغاء خارجي) — العمليات تُنشأ آلياً من البيع والسندات فقط'],
  ['sellPropertyUnit', 'غلاف لعقار واحد فوق sellPropertyUnits — الشاشة تنادي الدالة المتعددة مباشرة'],
  ['receivePurchaseOrder', 'استلام أمر شراء — الشاشة تُنشئ الفاتورة وتستلم ضمنياً، ولا زر استلام مستقل'],
  // ── تحرير بيانات مرجعية: الشاشات تضيف/تحذف بلا تحرير ──
  ['addColdChainReading', 'قراءة سلسلة تبريد — لا واجهة'],
  ['deleteColdChainReading', 'حذف قراءة سلسلة تبريد — لا واجهة'],
  ['deleteControlledDispense', 'حذف صرف دواء مراقب — لا واجهة'],
  ['reverseFxTransfer', 'عكس تحويل عملة — لا واجهة (التصحيح عبر قيود يدوية)'],
  ['getCustodySummary', 'ملخص عهدة مشروع — تُحسب داخل الشاشة من المستندات'],
  ['setLetterDefaultDesign', 'واجهة بديلة مختبرة لتصميم افتراضي محفوظ خاص؛ الشاشة تستخدم حفظ القالب المسمى وتثبيته في عملية واحدة'],
  // رابط wa.me لا يؤكد الفتح أو الإرسال؛ الاحتفاظ بالعمليتين للتوافق فقط بلا استدعاء من الواجهة.
  ['logTicketNotificationSent', 'تسجيل قديم لا يثبت الإرسال؛ واجهة الصيانة لا تناديه عند محاولة فتح واتساب'],
  ['logLaundryNotificationSent', 'تسجيل قديم لا يثبت الإرسال؛ واجهة المغسلة لا تناديه عند محاولة فتح واتساب'],
  // ── خطّافات اعتماد المستندات: داخلية بطبيعتها ──
  ['markDocApprovalPosted', 'يُضبط postedDocumentId آلياً داخل decideDocApproval عند الترحيل؛ الخطّاف متاح لإصلاح سجل قديم بلا شاشة مستقلة'],
  ['assertApproved', 'حارس داخلي يُستدعى ضمن مسار الترحيل نفسه عبر planApprovalConsumption (تحويل عرض، مستخلص، شهادة، إذن صرف) لا من شاشة'],
])

const orphan = operations.filter((op) => !new RegExp(`\\b${op}\\b`).test(productionCorpus))
const undocumented = orphan.filter((op) => !UNWIRED.has(op))
const stale = [...UNWIRED.keys()].filter((op) => !operations.includes(op) || !orphan.includes(op))

console.log(`  العمليات: ${operations.length} · موصولة بمستخدم: ${operations.length - orphan.length} · غير موصولة: ${orphan.length}`)
assert.deepEqual(undocumented, [], `عمليات غير موصولة بأي شاشة وبلا توثيق: ${undocumented.join('، ')}`)
assert.deepEqual(stale, [], `توثيق غير مطابق للواقع (العملية صارت موصولة أو حُذفت): ${stale.join('، ')}`)
R.ok(`${orphan.length} عملية غير موصولة — كل واحدة موثقة بسببها`)

/* ——— ملفات لا يستوردها أحد: إما موت أو مدخل خلفي مقصود ——— */
const DOCUMENTED_DEAD_FILES = new Map([
  ['src/vite-env.d.ts', 'بيان أنواع لـVite لا يُستورد وقت التشغيل'],
  ['src/core/commercialDocument.ts', 'محرك مستند تجاري موازٍ — يستورده commercialDocumentRepository وحده'],
  ['src/data/commercialDocumentRepository.ts', 'مستودع المستند التجاري الموازي — لا مستورد له (السطح ميت كاملاً)'],
  ['src/core/documentAddress.ts', 'تحقق عنوان مستند — مختبر بلا مستهلك في الإنتاج'],
  ['src/core/documentApproval.ts', 'تحقق اعتماد مستند — مختبر بلا مستهلك'],
  ['src/core/documentAttachments.ts', 'تحقق مرفقات — مختبر بلا مستهلك'],
  ['src/core/documentCurrency.ts', 'تحقق عملة مستند — مختبر بلا مستهلك'],
  ['src/core/documentLifecycle.ts', 'دورة حياة المستند — يستورده commercialDocument وحده'],
  ['src/core/documentNumbering.ts', 'ترقيم مستند — مختبر بلا مستهلك (الترقيم الفعلي في repo)'],
  ['src/core/documentReferences.ts', 'مراجع مستند — مختبر بلا مستهلك'],
  ['src/core/documentSettlement.ts', 'تسوية مستند — مختبر بلا مستهلك'],
  ['src/core/documentTax.ts', 'ضريبة المستند — يستورده taxResolution وحده'],
  ['src/core/documentTotals.ts', 'إجماليات مستند — مختبر بلا مستهلك (الإجماليات الفعلية في repo)'],
  ['src/core/paymentTerms.ts', 'جدول سداد آجل — مختبر بلا مستهلك'],
  ['src/core/projectAdvanceCreditEntry.ts', 'قيد دفعة مقدمة مشروع — مختبر بلا مستهلك'],
  ['src/core/releaseReadiness.ts', 'قائمة جاهزية إصدار — بلا مستورد وبلا اختبار'],
  ['src/core/taxDocumentGuard.ts', 'حارس ضريبة المستند — مختبر بلا مستهلك'],
  ['src/core/taxPricing.ts', 'تسعير ضريبي — مختبر بلا مستهلك'],
  ['src/core/taxResolution.ts', 'تحديد المعالجة الضريبية — مختبر بلا مستهلك'],
  ['src/core/taxTreatment.ts', 'معالجة ضريبية — يستورده taxResolution وحده'],
  ['src/data/localDatabase.ts', 'مخطط قاعدة محلية بديل — مختبر؛ التنفيذ الفعلي في desktop/sqlite'],
  ['src/data/sqliteSchema.ts', 'مخطط SQLite موازٍ (نسخة 2) — مختبر؛ المخطط التنفيذي هو desktop/sqlite/schema.ts (نسخة 1)'],
])
const unreachableFiles = files
  .filter((file) => !reachable.has(file))
  .map((file) => relative(root, file).split('\\').join('/'))
const undocumentedFiles = unreachableFiles.filter((file) => !DOCUMENTED_DEAD_FILES.has(file))
const staleFiles = [...DOCUMENTED_DEAD_FILES.keys()].filter((file) => !unreachableFiles.includes(file))
assert.deepEqual(undocumentedFiles, [], `ملفات لا يستوردها أحد وبلا توثيق: ${undocumentedFiles.join('، ')}`)
assert.deepEqual(staleFiles, [], `توثيق ملفات ميتة غير مطابق: ${staleFiles.join('، ')}`)
R.ok(`${unreachableFiles.length} ملفاً غير مستورد — كلها موثقة (منها محرك مستندات موازٍ كامل)`)

/* ——— اختبارات تغطّي كوداً غير موصول: تُحسب وتُثبّت، فلا تنمو بصمت ——— */
const DEAD_CODE_TESTS = new Set([
  'commercial_document_meta.test.ts', 'document_address.test.ts', 'document_approval.test.ts',
  'document_attachments.test.ts', 'document_currency.test.ts', 'document_lifecycle.test.ts',
  'document_numbering.test.ts', 'document_references.test.ts', 'document_settlement.test.ts',
  'document_tax.test.ts', 'document_totals.test.ts', 'local_database.test.ts',
  'payment_terms.test.ts', 'sqlite_schema.test.ts', 'tax_document_guard.test.ts',
  'tax_pricing.test.ts', 'tax_resolution.test.ts', 'tax_treatment.test.ts',
])
const testsDir = join(root, 'tests')
const deadCodeTests = []
for (const entry of readdirSync(testsDir)) {
  if (!/\.(ts|tsx)$/.test(entry)) continue
  const file = join(testsDir, entry)
  const source = readFileSync(file, 'utf8')
  const imported = [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)]
    .map((match) => resolveSpec(match[1], file))
    .filter((target) => target && target.includes(`${join(root, 'src')}`))
  if (imported.length && imported.every((target) => !reachable.has(target))) deadCodeTests.push(entry)
}
const newDeadTests = deadCodeTests.filter((entry) => !DEAD_CODE_TESTS.has(entry))
const staleDeadTests = [...DEAD_CODE_TESTS].filter((entry) => !deadCodeTests.includes(entry))
assert.deepEqual(newDeadTests, [], `اختبارات جديدة تغطّي كوداً غير موصول: ${newDeadTests.join('، ')}`)
assert.deepEqual(staleDeadTests, [], `قائمة اختبارات الكود غير الموصول لا تطابق الواقع: ${staleDeadTests.join('، ')}`)
R.ok(`${deadCodeTests.length} ملف اختبار يغطّي كوداً غير موصول (محرك المستندات الموازي) — موثق ومحصي`)

R.done()
