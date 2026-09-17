/**
 * تحقق آلية موافقة المشرف على المرتجعات والعمليات الحساسة (نمط POS العالمي):
 * ─────────────────────────────────────────────────────────────────────────
 * 1) refundNeedsSupervisorPin: مالك/مخول يمر — كاشير يُطالَب بالرقم
 * 2) approveByPin: رقم المالك يعتمد، رقم مشرف مخول يعتمد، رقم كاشير يُرفض،
 *    والرقم الخاطئ يسجل محاولة فاشلة (قفل بعد 5)
 * 3) postSaleReturn يختم approvedBy/requestedBy ويوثق الوردية العابرة
 *    (وردية مغلقة/كاشير آخر ⇒ crossShiftNote + احتساب في الوردية الحالية)
 * 4) صلاحيات الأدوار: cashier فيها sales.return.create بلا approve؛
 *    branch_manager فيها الاثنتان؛ مسار /sales/returns على create
 * 5) التعميم: كل توقيعات refund* تقبل approvedBy وكل ServiceRefundRecord يختم
 */
import assert from 'node:assert/strict'

/* ─── stubs بيئة المتصفح ─── */
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}
globalThis.window = globalThis
mem.set('shopsys-app', JSON.stringify({ state: { setup: { done: true, countryId: 'EG', activityId: 'grocery', vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true, allowNegativeStock: false } }, version: 0 }))

const { refundNeedsSupervisorPin, needsSupervisorPin, isEligibleApprover, describeShiftContext, REFUND_APPROVE_PERM, REFUND_CREATE_PERM } =
  await import('../src/core/refundApproval.ts')
const { DEFAULT_ROLES, effectivePermissionsFor, permissionForPath, PERMISSIONS } = await import('../src/core/permissions.ts')
const { hashPin } = await import('../src/core/audit.ts')
const { useDataStore } = await import('../src/data/repo.ts')

let n = 0
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`)

console.log('1️⃣ قرار المطالبة بالرقم السري')
{
  const roles = DEFAULT_ROLES
  const cashierPerms = effectivePermissionsFor({ roleId: 'cashier' }, roles)
  const bmPerms = effectivePermissionsFor({ roleId: 'branch_manager' }, roles)
  assert.equal(refundNeedsSupervisorPin(null, new Set()).needsPin, false)
  ok('المالك الافتراضي (null) لا يُسأل رقماً')
  assert.equal(refundNeedsSupervisorPin({ roleId: 'owner' }, new Set()).needsPin, false)
  ok('دور المالك لا يُسأل رقماً')
  assert.equal(refundNeedsSupervisorPin({ roleId: 'cashier' }, cashierPerms).needsPin, true)
  ok('الكاشير يُطالَب برقم مشرف')
  assert.equal(refundNeedsSupervisorPin({ roleId: 'branch_manager' }, bmPerms).needsPin, false)
  ok('مدير الفرع (يملك sales.return.approve) يمر مباشرة')
  // بائع منحه المالك الصلاحية فردياً (extraPerms) — طلب المالك حرفياً
  const sellerPerms = effectivePermissionsFor({ roleId: 'cashier', extraPerms: [REFUND_APPROVE_PERM] }, roles)
  assert.equal(refundNeedsSupervisorPin({ roleId: 'cashier' }, sellerPerms).needsPin, false)
  ok('بائع ممنوح «مرتجع بدون رقم سري» فردياً يمر مباشرة')
  // التعميم على صلاحيات أخرى
  assert.equal(needsSupervisorPin({ roleId: 'cashier' }, cashierPerms, 'sales.discount.grant').needsPin, true)
  assert.equal(needsSupervisorPin({ roleId: 'cashier' }, cashierPerms, 'acc.journal.reverse').needsPin, true)
  ok('التعميم: الخصم وعكس القيد يطالبان الكاشير بالرقم')
}

console.log('2️⃣ أهلية المعتمدين والصلاحيات الافتراضية')
{
  const roles = DEFAULT_ROLES
  const cashier = { roleId: 'cashier', active: true }
  const bm = { roleId: 'branch_manager', active: true }
  const inactiveBm = { roleId: 'branch_manager', active: false }
  assert.equal(isEligibleApprover(cashier, effectivePermissionsFor(cashier, roles)), false)
  assert.equal(isEligibleApprover(bm, effectivePermissionsFor(bm, roles)), true)
  assert.equal(isEligibleApprover(inactiveBm, effectivePermissionsFor(inactiveBm, roles)), false)
  ok('كاشير غير مؤهل — مدير فرع مؤهل — معطل مرفوض')
  const cashierRole = DEFAULT_ROLES.find((r) => r.id === 'cashier')
  assert.ok(cashierRole.permissions.includes(REFUND_CREATE_PERM))
  assert.ok(!cashierRole.permissions.includes(REFUND_APPROVE_PERM))
  ok('الكاشير الافتراضي: يسجل المرتجع ولا يعتمده')
  assert.equal(permissionForPath('/sales/returns'), REFUND_CREATE_PERM)
  assert.equal(permissionForPath('/sales/exchange'), REFUND_CREATE_PERM)
  ok('مسار المرتجعات/الاستبدال على create — الشاشة تُفتح والتنفيذ بالرقم')
  assert.ok(PERMISSIONS.some((p) => p.id === REFUND_CREATE_PERM))
  assert.ok(PERMISSIONS.find((p) => p.id === REFUND_APPROVE_PERM).sensitive)
  ok('الصلاحيتان معرفتان وapprove حساسة')
}

console.log('3️⃣ approveByPin — التحقق الفعلي بالأرقام')
{
  const store = useDataStore
  const ownerHash = await hashPin('1111')
  const bmHash = await hashPin('2222')
  const cashierHash = await hashPin('3333')
  store.setState({
    ownerPinHash: ownerHash,
    appUsers: [
      { id: 1, nameAr: 'سالم المشرف', roleId: 'branch_manager', pinHash: bmHash, active: true },
      { id: 2, nameAr: 'كريم الكاشير', roleId: 'cashier', pinHash: cashierHash, active: true },
    ],
    currentUserId: 2,
    loginGuard: { failures: 0, lockedUntil: null },
  })
  const r1 = await store.getState().approveByPin('1111')
  assert.equal(r1.approvedBy, 'المالك')
  ok('رقم المالك يعتمد المرتجع')
  const r2 = await store.getState().approveByPin('2222')
  assert.equal(r2.approvedBy, 'سالم المشرف')
  ok('رقم مشرف مخول يعتمد باسمه')
  await assert.rejects(() => store.getState().approveByPin('3333'), /لا يملك صلاحية|غير صحيح/)
  ok('رقم كاشير (بلا صلاحية) يُرفض حتى لو صحيح')
  await assert.rejects(() => store.getState().approveByPin('9999'), /غير صحيح|لا يملك/)
  assert.equal(useDataStore.getState().loginGuard.failures > 0, true)
  ok('الرقم الخاطئ يسجل محاولة فاشلة (حماية التخمين)')
  // التعميم على صلاحية أخرى: المشرف لا يملك acc.fiscal.close مثلاً؟ مدير الفرع لا يملكها
  await assert.rejects(() => store.getState().approveByPin('2222', 'acc.fiscal.close'), /لا يملك|غير صحيح/)
  ok('التعميم: رقم المشرف يُرفض لصلاحية لا يملكها (acc.fiscal.close)')
  const r3 = await store.getState().approveByPin('2222', 'sales.discount.grant')
  assert.equal(r3.approvedBy, 'سالم المشرف')
  ok('التعميم: رقم المشرف يعتمد الخصم (يملك sales.discount.grant)')
  store.setState({ loginGuard: { failures: 0, lockedUntil: null } })
}

console.log('4️⃣ مرتجع وردية مغلقة / كاشير آخر — describeShiftContext')
{
  const same = describeShiftContext({ saleShiftId: 5, saleShiftStatus: 'open', saleShiftOpenedBy: 'كريم', currentShiftId: 5, currentUserName: 'كريم' })
  assert.equal(same.crossShift, false)
  ok('نفس الوردية المفتوحة — لا سياق خاص')
  const closed = describeShiftContext({ saleShiftId: 3, saleShiftStatus: 'closed', saleShiftOpenedBy: 'سالم', currentShiftId: 7, currentUserName: 'كريم' })
  assert.equal(closed.crossShift, true)
  assert.ok(closed.noteAr.includes('وردية مغلقة #3'))
  assert.ok(closed.noteAr.includes('سالم'))
  assert.ok(closed.noteAr.includes('الوردية الحالية #7'))
  ok('وردية مغلقة لمستخدم آخر: يوثق الأصل ويحتسب في الحالية')
  const noShift = describeShiftContext({ saleShiftId: 4, saleShiftStatus: 'closed', saleShiftOpenedBy: 'سالم', currentShiftId: null, currentUserName: 'كريم' })
  assert.ok(noShift.noteAr.includes('لا وردية مفتوحة'))
  ok('لا وردية مفتوحة الآن: يوثق أن المرتجع خارج الورديات')
  const office = describeShiftContext({ saleShiftId: null, saleShiftStatus: null, saleShiftOpenedBy: null, currentShiftId: 7, currentUserName: 'كريم' })
  assert.equal(office.crossShift, false)
  ok('فاتورة مكتبية بلا وردية — لا سياق')
}

console.log('5️⃣ postSaleReturn يختم الاعتماد ويوثق الوردية العابرة')
{
  const store = useDataStore
  // بيع داخل وردية ثم إقفالها ثم مرتجع في وردية جديدة لمستخدم آخر
  store.getState().addItem({
    nameAr: 'صنف الاختبار', sku: '', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
    costMinor: 6000, stockQty: 10, priceMinor: 10000, minQty: 0, trackExpiry: false, trackSerial: false,
    warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  })
  const item = store.getState().items.at(-1)
  store.getState().openShift(0)
  const shift1 = store.getState().shifts.at(-1)
  const sale = store.getState().postSale({
    lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 10000, unitCostMinor: 6000, discountPercent: 0, soldByWeight: false }],
    customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, paidMinor: 20000,
  })
  assert.equal(sale.shiftId, shift1.id)
  store.getState().closeShift(20000)
  store.getState().openShift(0)
  const shift2 = store.getState().shifts.at(-1)
  const ret = store.getState().postSaleReturn({
    saleId: sale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', reason: 'اختبار', approvedBy: 'سالم المشرف',
  })
  assert.equal(ret.approvedBy, 'سالم المشرف')
  assert.equal(ret.requestedBy, 'كريم الكاشير')
  ok('المستند يحمل: نفذه الكاشير واعتمده المشرف')
  assert.equal(ret.shiftId, shift2.id)
  assert.ok(ret.crossShiftNote.includes(`وردية مغلقة #${shift1.id}`))
  ok('مرتجع فاتورة وردية مغلقة: يُحتسب في الوردية الحالية مع توثيق الأصل')
  const audit = store.getState().auditLog.at(-1)
  assert.ok(audit.title.includes('اعتمده «سالم المشرف»'))
  assert.ok(audit.title.includes('وردية مغلقة'))
  assert.equal(audit.user, 'كريم الكاشير')
  ok('سجل التدقيق: الحدث كامل باسم المنفذ والمعتمد والسياق')
  // بلا وردية مفتوحة إطلاقاً
  store.getState().closeShift(0)
  const ret2 = store.getState().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'cash', reason: 'ت2' })
  assert.equal(ret2.shiftId, null)
  assert.ok(ret2.crossShiftNote.includes('لا وردية مفتوحة'))
  assert.equal(ret2.approvedBy, 'كريم الكاشير')
  ok('بلا وردية: shiftId=null والتوثيق واضح — وبلا معتمد يختم المنفذ نفسه')
}

console.log('6️⃣ التعميم: توقيعات مرتجع الخدمة كلها تقبل approvedBy')
{
  const fs = await import('node:fs')
  const repoSrc = fs.readFileSync(new URL('../src/data/repo.ts', import.meta.url), 'utf8')
  for (const fn of ['refundLaundryOrder', 'refundMaintenanceTicket', 'refundTrip', 'refundLabOrder', 'refundClinicVisit', 'refundRental', 'refundProjectExtract']) {
    const sig = repoSrc.split(`${fn}: (args: {`)[1]?.split('}) =>')[0] ?? ''
    assert.ok(sig.includes('approvedBy?: string'), `${fn} تقبل approvedBy`)
  }
  ok('7 دوال مرتجع خدمة (مغسلة/صيانة/نقلات/معمل/عيادة/إيجار/مستخلص) تقبل approvedBy')
  assert.ok(repoSrc.includes('returnWalletService: (opId: number, reason: string, approvedBy?: string)'))
  ok('مرتجع خدمة المحافظ يقبل approvedBy')
  assert.ok(repoSrc.split('postExchange: (args: {')[1].split('}) =>')[0].includes('approvedBy?: string'))
  ok('الاستبدال يمرر الاعتماد لمستند المرتجع الداخلي')
  // الواجهات: كل نقاط الإدخال تمر عبر SupervisorPinDialog
  const ui = (p) => fs.readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8')
  assert.ok(ui('components/ServiceRefundBox.tsx').includes('useSupervisorApproval'))
  ok('ServiceRefundBox (6 صفحات أنشطة) يفرض الحوار')
  for (const p of ['pages/SaleReturnsPage.tsx', 'pages/WalletServicesPage.tsx', 'pages/ExchangePage.tsx', 'pages/JournalPage.tsx', 'pages/SettlementsPage.tsx']) {
    assert.ok(ui(p).includes('useSupervisorApproval'), p)
  }
  // المغسلة ترقّت للصندوق الموحد ServiceRefundBox (الذي يفرض الحوار داخلياً)
  assert.ok(ui('pages/LaundryPage.tsx').includes('ServiceRefundBox'))
  ok('صفحات: مرتجع مبيعات/مغسلة/محافظ/استبدال/عكس قيد/تسويات — كلها خلف البوابة')
  const pos = ui('pages/PosPage.tsx')
  assert.ok(pos.includes("useSupervisorApproval('sales.expiry.override')"))
  assert.ok(pos.includes("useSupervisorApproval('sales.discount.grant')"))
  ok('الكاشير: تجاوز الصلاحية والخصومات برقم مشرف موثق (لا مجرد اسم مكتوب)')
}

console.log(`\n✅ ${n}/${n} — آلية موافقة المشرف تعمل: رقم المالك ورقم المشرف يعتمدان، الكاشير لا ينفذ مرتجعاً بنفسه، الوردية المغلقة/العابرة موثقة، والتعميم شامل`)
