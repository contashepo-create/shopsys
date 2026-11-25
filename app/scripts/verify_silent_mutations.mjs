/**
 * بوابة «لا فشل صامت جديد» — ترصد العمليات التي تقبل معرّفاً ولا تتحقق من وجوده.
 *
 * الخلل الذي أنشأت هذه البوابة لأجله: `receivePurchaseOrder(9999, …)` كان يبتلع
 * المعرّف المجهول ويُحدّث الحالة بلا أثر، فيظن المستدعي أن الاستلام سُجّل. الفحص
 * يجرد كل عملية أول معاملها `id` ثم يصنّفها:
 *   • محروسة: تبحث عن الكيان (`find`/`some`) وترمي عند غيابه.
 *   • صامتة: تُقبل المعرّف المجهول بلا اعتراض (حذف/تبديل حالة idempotent، أو تحرير يتجاهل).
 *
 * القائمة أدناه **سجل إفصاح** لا تبرئة: البوابة تفشل إن ظهرت عملية صامتة جديدة،
 * أو إن صار عنصر مذكور محروساً (توثيق قديم). كل عملية باقية مرشحة لإضافة حارس
 * صريح عند لمس شاشتها.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { reporter } from './auditKit.mjs'

const R = reporter('سطح الفشل الصامت في عمليات المتجر')
const root = fileURLToPath(new URL('..', import.meta.url))
const repo = readFileSync(`${root}src/data/repo.ts`, 'utf8')
const lines = repo.split('\n')

const storeStart = lines.findIndex((line) => line.includes('useRawDataStore = create<DataState>()'))
const heads = []
lines.forEach((line, index) => {
  const match = /^ {6}([A-Za-z_$][\w$]*)\s*:/.exec(line)
  if (match && index > storeStart) heads.push({ index, name: match[1] })
})
heads.push({ index: lines.length, name: '__END__' })
const segments = new Map()
for (let i = 0; i < heads.length - 1; i += 1) {
  if (!segments.has(heads[i].name)) segments.set(heads[i].name, lines.slice(heads[i].index, heads[i + 1].index).join('\n'))
}

const interfaceStart = repo.indexOf('interface DataState {')
const interfaceEnd = repo.indexOf('\n}\n', interfaceStart)
const operations = [...new Set([...repo.slice(interfaceStart, interfaceEnd).matchAll(/^ {2}([A-Za-z_$][\w$]*): \(/gm)].map((m) => m[1]))]

const idFirst = operations.filter((op) => new RegExp(`^ {6}${op}: \\(\\s*id\\b`).test(segments.get(op) ?? ''))
const looksUp = (body) => /\.find\(|\.some\(/.test(body)
const throws = (body) => body.includes('throw new')
const guarded = idFirst.filter((op) => looksUp(segments.get(op)) && throws(segments.get(op)))
const silent = idFirst.filter((op) => !guarded.includes(op))

/** العمليات التي تقبل معرّفاً مجهولاً بلا اعتراض — مع سبب التصنيف. */
const DOCUMENTED_SILENT = new Map([
  // حذف/تبديل حالة idempotent: تنفيذ العملية مرتين لا يضر، والغياب = لا شيء يُفعل
  ['deletePendingPartOrder', 'حذف idempotent'],
  ['deleteAdvancedInvoiceDraft', 'حذف مسودة idempotent'],
  ['deletePartyNote', 'حذف ملاحظة idempotent'],
  ['deleteBooking', 'حذف حجز idempotent'],
  ['deleteMarketPrice', 'حذف سعر سوق idempotent'],
  ['deleteControlledDispense', 'حذف صرف مراقب idempotent'],
  ['deleteColdChainReading', 'حذف قراءة تبريد idempotent'],
  ['deleteDeliveryJob', 'حذف مهمة توصيل idempotent'],
  ['removePatientAttachment', 'حذف مرفق idempotent'],
  ['removeDocumentFile', 'حذف ملف مستند idempotent'],
  ['removeCategory', 'حذف تصنيف idempotent'],
  ['removeCostCenterBudget', 'حذف موازنة idempotent'],
  ['removeExpenseTemplate', 'حذف قالب مصروف idempotent'],
  ['removeFinancialEntityProfile', 'حذف ملف جهة مالية idempotent'],
  ['toggleInsuranceProvider', 'تبديل تفعيل جهة — معرّف مجهول يترك الحالة كما هي'],
  ['toggleLabReferrer', 'تبديل تفعيل جهة إحالة — idempotent'],
  ['toggleRecipe', 'تبديل تفعيل وصفة — idempotent'],
  ['setBookingStatus', 'تغيير حالة حجز — المطابقة داخل map فلا أثر لمعرّف مجهول'],
  ['setAppointmentStatus', 'تغيير حالة موعد — المطابقة داخل map'],
  // تحرير يتجاهل المعرّف المجهول: مرشح لإضافة حارس عند لمس شاشته
  ['markNotificationRead', 'تعليم إشعار مقروءاً — يُستدعى من الواجهة بكثرة، الغياب لا يضر'],
  ['updatePartyNote', 'تحرير ملاحظة طرف — مرشح للحارس'],
  ['updateCategory', 'تحرير تصنيف — مرشح للحارس'],
  ['updateVehicle', 'تحرير مركبة — مرشح للحارس'],
  ['updateEquipment', 'تحرير معدة — مرشح للحارس'],
  ['updateLabPatient', 'تحرير مريض مختبر — مرشح للحارس'],
  ['updateMaintenanceService', 'تحرير بند صيانة — مرشح للحارس'],
  ['isProjectCloseoutCurrent', 'استعلام (لا تحوير) — الجواب false لمعرّف مجهول'],
])

const newSilent = silent.filter((op) => !DOCUMENTED_SILENT.has(op))
const stale = [...DOCUMENTED_SILENT.keys()].filter((op) => !silent.includes(op))

console.log(`  عمليات أول معاملها id: ${idFirst.length} · محروسة: ${guarded.length} · صامتة: ${silent.length}`)
assert.deepEqual(newSilent, [], `عمليات جديدة تقبل معرّفاً مجهولاً بصمت: ${newSilent.join('، ')}`)
assert.deepEqual(stale, [], `سجل الفشل الصامت لا يطابق الواقع: ${stale.join('، ')}`)
R.ok(`${silent.length} عملية صامتة موثقة — لا زيادة صامتة جديدة (مثبت: receivePurchaseOrder صار محروساً)`)
assert.ok(guarded.includes('receivePurchaseOrder'), 'حارس استلام أمر الشراء يجب أن يبقى')
R.done()
