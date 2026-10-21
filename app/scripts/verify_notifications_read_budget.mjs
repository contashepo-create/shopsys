/**
 * بوابة التحقق — بلاغ المالك 2026-10-21:
 *   ١) «إشعار ضبط الموازنة لا يختفي عند تعليمه كمقروء»
 *      السبب: علامات القراءة تُخزَّن مبدوءة بنطاق المستخدم/الفرع
 *      (`notification-read:v1:owner:branch-all:...`) بينما الجرس يقارن بمعرّف التنبيه
 *      المجرَّد. عرض «كل الفروع» للمالك كان يُرجع الحالة الخام بلا تعرية البادئة،
 *      فتفشل المقارنة ولا يُزال أي تنبيه. البوابة تفحص:
 *      - `useDataStore.getState().readNotificationIds` مجرَّد بعد التعليم (لا بادئة)
 *      - منطق الجرس نفسه (`new Set(readNotificationIds).has(id)`) يعدّ التنبيه مقروءاً
 *      - `restoreNotifications` يعيده إلى غير المقروء
 *      - التخزين الخام يحتفظ بالبادئة (عزل المستخدم/الفرع لم يُكسر)
 *   ٢) «لماذا لا يُلغى إشعار الموازنة إذا كتبتُ صفراً؟ إذا كتبتُ أي رقم ابدأ المقارنة،
 *      أما إذا كان صفراً فلا أريد أي إشعارات للموازنة»
 *      - فئة بموازنة صفر (أو غير مُدخلة) ⇒ حالة `no-budget` ولا تنبيه في الجرس إطلاقاً
 *      - أي رقم موجب ⇒ تبدأ المقارنة: تجاوز ⇒ 'over' وتنبيه، 85٪+ ⇒ 'warning' بلا تنبيه
 *      - تكامل عبر المتجر الحقيقي: حفظ موازنة صفرية ثم موجبة ثم تعليم التنبيه كمقروء
 * تشغيل: node --experimental-strip-types scripts/verify_notifications_read_budget.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({
  state: {
    setup: { done: true, requireOpenShiftForSales: false, allowNegativeTreasury: true, vatPercent: 14, taxInclusive: true, activityId: 'contracting', countryCode: 'EG' },
    license: { plan: 'pro' },
  },
}))
if (!globalThis.crypto?.subtle) { const { webcrypto } = await import('node:crypto'); globalThis.crypto = webcrypto }

let pass = 0
const ok = (msg) => { pass++; console.log(`  ✅ ${msg}`) }
const eq = (actual, expected, msg) => {
  assert.equal(actual, expected, `${msg} — الفعلي ${JSON.stringify(actual)} والمتوقع ${JSON.stringify(expected)}`)
  ok(msg)
}

const core = await import(pathToFileURL(join(root, 'src/core/contracting.ts')).href)
const { collectNotifications } = await import(pathToFileURL(join(root, 'src/core/notifications.ts')).href)
const { useDataStore, useRawDataStore, getBranchScopedDataState } = await import(pathToFileURL(join(root, 'src/data/repo.ts')).href)
const S = () => useDataStore.getState()
const NOTIFICATION_READ_KEY_PREFIX = 'notification-read:v1:'

/* ═══════════════════ ١) نواة تقرير الانحراف: صفر = بلا مقارنة ═══════════════════ */
console.log('\n═══ ١) نواة الموازنة: «صفر = لا مقارنة ولا تنبيه» ═══')
{
  const noBudget = core.budgetVarianceReport([], [{ kind: 'materials', amountMinor: 500_000 }])
  eq(noBudget.rows.length, 1, 'التكلفة تظل ظاهرة في التقرير حتى بلا موازنة')
  eq(noBudget.rows[0].status, 'no-budget', 'فئة بلا موازنة (صفر) ⇒ الحالة «no-budget» لا «تجاوز»')
  eq(noBudget.rows[0].usagePercent, 0, 'بلا موازنة: لا نسبة استهلاك (لا قسمة على صفر)')
  eq(noBudget.totalBudgetMinor, 0, 'إجمالي الموازنة صفر')

  const zeroExplicit = core.budgetVarianceReport(
    [{ kind: 'labor', amountMinor: 0 }],
    [{ kind: 'labor', amountMinor: 900_000 }],
  )
  eq(zeroExplicit.rows[0].status, 'no-budget', 'موازنة مُدخلة صراحةً بصفر = لا مقارنة أيضاً')

  const within = core.budgetVarianceReport(
    [{ kind: 'materials', amountMinor: 1_000_000 }],
    [{ kind: 'materials', amountMinor: 500_000 }],
  )
  eq(within.rows[0].status, 'ok', 'موازنة 10,000 وفعلي 5,000 ⇒ ضمن الموازنة')

  const warn = core.budgetVarianceReport(
    [{ kind: 'materials', amountMinor: 1_000_000 }],
    [{ kind: 'materials', amountMinor: 900_000 }],
  )
  eq(warn.rows[0].status, 'warning', 'كتابة رقم يبدأ المقارنة: استهلاك 90٪ ⇒ تحذير')
  eq(warn.rows[0].usagePercent, 90, 'نسبة الاستهلاك 90٪ محسوبة بدقة')

  const over = core.budgetVarianceReport(
    [{ kind: 'materials', amountMinor: 1_000_000 }],
    [{ kind: 'materials', amountMinor: 1_400_000 }],
  )
  eq(over.rows[0].status, 'over', 'استهلاك 140٪ ⇒ تجاوز')
  eq(over.rows[0].varianceMinor, -400_000, 'الانحراف سالب بمقدار التجاوز')
}

/* ═══════════════════ ٢) الجرس: لا إشعار لموازنة صفرية ═══════════════════ */
console.log('\n═══ ٢) جرس التنبيهات: تصفية التجاوزات على الموازنات الموجبة فقط ═══')
{
  const fmt = (m) => `${(m / 100).toFixed(2)} ج.م`
  const base = { batches: [], itemName: () => '', installmentPlans: [], customerName: () => '', cheques: [], fmt, todayIso: '2026-10-21T00:00:00Z' }
  const withBudget = collectNotifications({
    ...base,
    projectBudgetOverruns: [{ projectId: 1, projectNameAr: 'برج النيل', kindAr: 'مواد', overrunMinor: 400_000 }],
  })
  eq(withBudget.filter((n) => n.id.startsWith('prjbudget:')).length, 1, 'موازنة موجبة متجاوزة ⇒ تنبيه واحد')

  const withoutBudget = collectNotifications({ ...base, projectBudgetOverruns: [] })
  eq(withoutBudget.filter((n) => n.id.startsWith('prjbudget:')).length, 0, 'بلا تجاوزات ⇒ لا تنبيهات موازنة')
}

/* ═══════════════════ ٣) تعليم الإشعار كمقروء يزيله فعلاً ═══════════════════ */
console.log('\n═══ ٣) علامات القراءة: البادئة تُعرَّى في العرض فتُطابِق معرّفات الجرس ═══')
{
  const id = 'prjbudget:1:مواد'
  S().markNotificationRead(id)
  const readIds = S().readNotificationIds
  assert.ok(readIds.includes(id), `تعليم كمقروء يجب أن يُظهر المعرّف المجرّد في العرض — الفعلي ${JSON.stringify(readIds)}`)
  ok('العرض يُرجع المعرّف المجرَّد `prjbudget:1:مواد` بعد التعليم')
  eq(readIds.filter((x) => x.startsWith(NOTIFICATION_READ_KEY_PREFIX)).length, 0, 'لا بادئة نطاق في العرض الشامل (كانت سبب عدم اختفاء الإشعار)')
  eq(new Set(readIds).has(id), true, 'منطق الجرس نفسه (readSet.has) يعدّ الإشعار مقروءاً ⇒ يختفي من غير المقروء')

  const rawIds = useRawDataStore.getState().readNotificationIds
  assert.ok(rawIds.includes(`${NOTIFICATION_READ_KEY_PREFIX}owner:branch-all:${id}`),
    `التخزين الخام يجب أن يحتفظ ببادئة النطاق لعزل المستخدم/الفرع — الفعلي ${JSON.stringify(rawIds)}`)
  ok('التخزين الخام يحتفظ ببادئة `notification-read:v1:owner:branch-all:` (العزل لم يُكسر)')

  S().markAllNotificationsRead(['a', 'b', 'c'])
  eq(S().readNotificationIds.length, 4, 'تعليم الكل يضيف الجديد فقط بلا تكرار')
  S().restoreNotifications()
  eq(S().readNotificationIds.length, 0, 'الاسترجاع يعيد الكل إلى غير المقروء')
  eq(useRawDataStore.getState().readNotificationIds.length, 0, 'الاسترجاع نظّف الخام أيضاً')
}

/* ═══════════════════ ٣.٥) ثبات المرجع: لا «رقعة وهمية» في مضيف الشبكة المحلية ═══════════════════ */
console.log('\n═══ ٣.٥) ثبات المرجع — مقارنة الرقع في LAN لا ترى تغييراً وهمياً ═══')
{
  const raw = useRawDataStore.getState()
  eq(getBranchScopedDataState(raw), raw, 'بلا علامات قراءة: تُعاد اللقطة نفسها بلا نسخ (هوية المرجع محفوظة)')
  S().markNotificationRead('prjbudget:1:مواد')
  const rawAfter = useRawDataStore.getState()
  const scopedA = getBranchScopedDataState(rawAfter)
  const scopedB = getBranchScopedDataState(rawAfter)
  eq(scopedA, scopedB, 'مع وجود علامة قراءة: نفس النسخة المخزَّنة لنفس اللقطة (لا مصفوفة جديدة كل قراءة)')
  eq(scopedA.readNotificationIds, scopedB.readNotificationIds, 'مصفوفة المعرّفات المجرَّدة بنفس المرجع — لا رقعة وهمية للمفتاح')
  S().restoreNotifications()
}

/* ═══════════════════ ٤) تكامل حقيقي: مشروع + تكلفة + موازنة صفرية ثم موجبة ═══════════════════ */
console.log('\n═══ ٤) تكامل المتجر: موازنة صفر ⇒ لا تنبيه، رقم موجب ⇒ مقارنة وتنبيه قابل للتعليم ═══')
{
  S().addSupplier({
    nameAr: 'مورد مواد المشروع', phone: '', taxNumber: '', commercialReg: '', email: '',
    address: '', city: '', postalCode: '', buildingNo: '', nationalId: '', creditLimitMinor: 0,
  })
  const supplier = S().suppliers.at(-1)
  const project = S().addProject({
    nameAr: 'برج النيل', clientName: 'شركة التعمير', clientId: null,
    contractValueMinor: 100_000_000, retentionPercent: 10, startDate: '2026-10-01', notes: '',
  })
  S().addProjectCost({
    projectId: project.id, kind: 'materials', amountMinor: 500_000,
    payment: 'credit', supplierId: supplier.id, description: 'توريد حديد',
  })

  /** نفس منطق الجرس في Header.tsx مشتقاً من تقرير الانحراف الحقيقي للمتجر. */
  const budgetAlerts = () => S()
    .projects.filter((p) => p.status === 'active')
    .flatMap((p) => S().getProjectBudgetVariance(p.id).rows
      .filter((r) => r.status === 'over' && r.budgetMinor > 0)
      .map((r) => ({ id: `prjbudget:${p.id}:${core.COST_KIND_LABELS[r.kind].nameAr}`, overrunMinor: r.actualMinor - r.budgetMinor })))

  eq(S().getProjectBudgetVariance(project.id).rows[0].status, 'no-budget', 'مشروع بلا موازنة: الحالة no-budget')
  eq(budgetAlerts().length, 0, 'لم أكتب أي رقم في الموازنة ⇒ الصفر لا يُنتج أي إشعار موازنة')

  S().setProjectBudget(project.id, [
    { kind: 'materials', amountMinor: 0 },
    { kind: 'labor', amountMinor: 0 },
    { kind: 'equipment', amountMinor: 0 },
    { kind: 'subcontract', amountMinor: 0 },
    { kind: 'other', amountMinor: 0 },
  ])
  eq(budgetAlerts().length, 0, 'حفظ الموازنة كلها أصفار ⇒ ما زال بلا أي إشعار')

  S().setProjectBudget(project.id, [{ kind: 'materials', amountMinor: 300_000 }])
  const alerts = budgetAlerts()
  eq(alerts.length, 1, 'كتابة رقم للمواد (3,000) أقل من الفعلي (5,000) ⇒ يبدأ التنبيه واحد')
  eq(alerts[0].id, `prjbudget:${project.id}:${core.COST_KIND_LABELS.materials.nameAr}`, 'معرّف التنبيه ثابت مربوط بالمشروع والفئة')

  const unreadBefore = alerts.filter((a) => !new Set(S().readNotificationIds).has(a.id))
  eq(unreadBefore.length, 1, 'الإشعار ظاهر كغير مقروء قبل التعليم')

  S().markNotificationRead(alerts[0].id)
  const readSet = new Set(S().readNotificationIds)
  eq(alerts.filter((a) => !readSet.has(a.id)).length, 0, 'بعد التعليم كمقروء يختفي إشعار الموازنة من قائمة غير المقروء')

  const again = budgetAlerts()
  eq(again.length, 1, 'التنبيه يبقى مشتقاً من البيانات الحقيقية (لا يختفي من الواقع) لكنه مقروء')

  S().setProjectBudget(project.id, [{ kind: 'materials', amountMinor: 0 }])
  eq(budgetAlerts().length, 0, 'إعادة الموازنة إلى صفر تلغي إشعار الموازنة تماماً (قرار المالك)')

  S().restoreNotifications()
  S().setProjectBudget(project.id, [{ kind: 'materials', amountMinor: 300_000 }])
  const unreadAfterRestore = budgetAlerts().filter((a) => !new Set(S().readNotificationIds).has(a.id))
  eq(unreadAfterRestore.length, 1, 'الاسترجاع يعيد إشعار الموازنة إلى غير المقروء')
}

console.log(`\n${'─'.repeat(46)}\n✅ ${pass} فحصاً ناجحاً — بوابة «الإشعار المقروء + موازنة الصفر»`)
