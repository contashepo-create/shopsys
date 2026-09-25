/**
 * التحقق من دفعة المالك الثامنة (8 نقاط) على مستوى كل الأنشطة الحالية:
 * ① باج إجبار تغيير الرقم أول دخول: login يرجع mustChangePin وبوابة App تحتجزه حتى التغيير
 * ② الدخول الموحد: لا زر مالك — matchesOwnerIdentity بالهوية الافتراضية والمخصصة + منع التصادم
 * ③ «حسابي»: changeMyPin (مالك وموظف) بتحقق الرقم الحالي + updateMyProfile بمنع التصادم
 * ⑤ تصفية الإشعارات بالصلاحيات: الكاشير لا يرى أقساطاً/شيكات/بلاغات — المحاسب يرى ماليّاته
 * ⑥ طباعة الشراء ومرتجعه بالقوالب الثلاثة (buildSimpleDocModel) — لكل نشاط
 * ⑦ سياسة الوردية بحسب الدور: المالك تلميح فقط، والكاشير حسب الإعداد، وبقية الأدوار الملزمة — لكل نشاط
 * (④ نقل شريط الطباعة و⑧ مراجعة قسم الأدوار: تحقق بصري/قرائي — الأدوار مغطاة في batch_18)
 * تشغيل: node --experimental-strip-types scripts/verify_owner_batch8_points.mjs
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { webcrypto } from 'node:crypto'
if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, v),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size },
}
globalThis.window = { localStorage: globalThis.localStorage, addEventListener: () => {}, dispatchEvent: () => true }

const { ACTIVITY_TEMPLATES } = await import(join(root, 'src/core/activities.ts'))
const { assertBalanced } = await import(join(root, 'src/core/ledger.ts'))
const { hashPin, matchesOwnerIdentity, DEFAULT_OWNER_PROFILE } = await import(join(root, 'src/core/audit.ts'))
const { collectNotifications, visibleNotifications } = await import(join(root, 'src/core/notifications.ts'))
const { rolesWithOverrides, effectivePermissionsFor } = await import(join(root, 'src/core/permissions.ts'))
const { buildSimpleDocModel, DEFAULT_RECEIPT_SETTINGS } = await import(join(root, 'src/core/receipt.ts'))
const { renderInvoiceA4Html } = await import(join(root, 'src/ui/print/printInvoiceA4.ts'))
const { renderReceiptHtml } = await import(join(root, 'src/ui/print/printReceipt.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 29, `المتوقع 29 نشاطاً — الموجود ${ACTIVITIES.length}`)
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: '' }

const appState = (activityId, requireShift) => JSON.stringify({
  state: { setup: { done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: true, requireOpenShiftForSales: requireShift }, license: { plan: 'pro' } },
  version: 0,
})

// ═══════════ الجزء العام (لا يعتمد على النشاط) — نقاط ①②③⑤ ═══════════
mem.clear()
mem.set('shopsys-app', appState('grocery', false))
{
  const { useDataStore } = await import(`${repoUrl}?b8=global`)
  const st = () => useDataStore.getState()

  // ── ① باج إجبار تغيير الرقم أول دخول ──
  st().setOwnerPin(await hashPin('1111'))
  st().addEmployee({ nameAr: 'كاشير الاختبار', phone: '01000000001', jobTitle: 'كاشير', hireDate: '2026-01-01', baseSalaryMinor: 400000, allowancesMinor: 0, active: true, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const emp = st().employees.at(-1)
  st().addAppUser({ nameAr: emp.nameAr, roleId: 'cashier', pinHash: await hashPin('2222'), employeeId: emp.id, phone: emp.phone, email: '', initialPin: '2222', mustChangePin: true })
  const u = st().appUsers.at(-1)
  const r1 = await st().login(u.id, '2222')
  assert.equal(r1.mustChangePin, true, '① login يرجع mustChangePin=true للرقم المبدئي')
  // بوابة App: activeUser.mustChangePin يبقيه محتجزاً في LoginScreen حتى بعد login
  const gateUser = st().appUsers.find((x) => x.id === st().currentUserId)
  assert.equal(!!(st().loggedOut || gateUser?.mustChangePin), true, '① البوابة تحتجزه: mustChangePin يبقي LoginScreen ظاهرة')
  // تغيير الرقم من المودال الإجباري
  st().changeOwnPin(u.id, await hashPin('7777'))
  const after = st().appUsers.find((x) => x.id === u.id)
  assert.equal(after.mustChangePin, false, '① mustChangePin يُمسح بعد التغيير')
  assert.equal(after.initialPin, null, '① الرقم المبدئي يُمسح — لا يعرفه أحد بعدها')
  assert.equal(!!(st().loggedOut || after.mustChangePin), false, '① البوابة تفتح بعد التعيين')
  const r2 = await st().login(u.id, '7777')
  assert.equal(r2.mustChangePin, false, '① الدخول التالي بالرقم الجديد — بلا إجبار')
  await assert.rejects(() => st().login(u.id, '2222'), /خاطئ/, '① الرقم المبدئي القديم لم يعد يعمل')

  // ── ② الدخول الموحد بهوية المالك ──
  assert.ok(matchesOwnerIdentity(DEFAULT_OWNER_PROFILE, 'المالك'), '② الهوية الافتراضية «المالك» تعمل قبل التخصيص')
  assert.ok(!matchesOwnerIdentity(DEFAULT_OWNER_PROFILE, 'كاشير الاختبار'), '② اسم موظف لا يطابق هوية المالك')
  await st().login(null, '1111') // دخول المالك
  st().updateOwnerProfile({ nameAr: 'أبو أحمد', phone: '01099999999', email: 'owner@shop.com' })
  const op = st().ownerProfile
  assert.ok(matchesOwnerIdentity(op, 'أبو أحمد') && matchesOwnerIdentity(op, '01099999999') && matchesOwnerIdentity(op, 'OWNER@shop.com'), '② الاسم/الهاتف/البريد (غير حساس لحالة الأحرف) معرفات دخول')
  assert.ok(!matchesOwnerIdentity(op, 'المالك'), '② الهوية القديمة تسقط بعد التخصيص')
  // منع تصادم هوية المالك مع معرف موظف
  assert.throws(() => st().updateOwnerProfile({ nameAr: 'كاشير الاختبار' }), /يتصادم/, '② تصادم الاسم مع موظف مرفوض')
  assert.throws(() => st().updateOwnerProfile({ phone: '01000000001' }), /يتصادم/, '② تصادم الهاتف مع موظف مرفوض')
  // موظف لا يعدل هوية المالك
  await st().login(u.id, '7777')
  assert.throws(() => st().updateOwnerProfile({ nameAr: 'مخترق' }), /المالك فقط/, '② هوية المالك محمية من الموظفين')

  // ── ③ «حسابي»: تغيير الرقم ذاتياً + بيانات التواصل ──
  const h8888 = await hashPin('8888')
  const h7777 = await hashPin('7777')
  await assert.rejects(() => st().changeMyPin('0000', h8888), /غير صحيح/, '③ رقم حالي خاطئ مرفوض')
  await assert.rejects(() => st().changeMyPin('7777', h7777), /يطابق/, '③ الرقم الجديد المطابق مرفوض')
  await st().changeMyPin('7777', h8888)
  const r3 = await st().login(u.id, '8888')
  assert.equal(r3.mustChangePin, false, '③ الموظف غيّر رقمه بنفسه ودخل به')
  st().updateMyProfile({ phone: '01011111111', email: 'cashier@shop.com' })
  assert.equal(st().appUsers.find((x) => x.id === u.id).phone, '01011111111', '③ تحديث الهاتف من البروفايل')
  assert.throws(() => st().updateMyProfile({ phone: '01099999999' }), /محجوزة/, '③ تصادم مع هاتف المالك مرفوض')
  st().updateMyProfile({ avatarDataUrl: 'data:image/jpeg;base64,TEST' })
  assert.equal(st().appUsers.find((x) => x.id === u.id).avatarDataUrl, 'data:image/jpeg;base64,TEST', '③ الصورة الشخصية تُحفظ')
  // المالك يغير رقمه من نفس الصفحة
  await st().login(null, '1111')
  await st().changeMyPin('1111', await hashPin('5555'))
  await assert.rejects(() => st().login(null, '1111'), /خاطئ/, '③ رقم المالك القديم سقط')
  await st().login(null, '5555')

  // ── ⑤ تصفية الإشعارات بالصلاحيات ──
  const roles = rolesWithOverrides(st().roleOverrides, st().customRoles)
  const all = collectNotifications({
    batches: [{ id: 1, itemId: 1, qty: 2, expiryDate: '2026-01-01', purchasedAt: '2025-06-01' }],
    itemName: () => 'صنف', todayIso: '2026-09-18', fmt: (m) => String(m),
    installmentPlans: [{ id: 1, planNumber: 'INS-1', customerId: 1, items: [{ seq: 1, dueDate: '2026-01-05', amountMinor: 1000, paidMinor: 0 }] }],
    customerName: () => 'عميل',
    openIssues: [{ id: 1, title: 'مشكلة', reportedBy: 'كاشير' }],
    openPinResets: [{ id: 1, nameAr: 'ناسي الرقم' }],
    items: [], suppliers: [], purchases: [], vouchers: [],
    cheques: [{ chequeNumber: 'CH1', dueDate: '2026-09-19', status: 'held', direction: 'incoming', partyName: 'عميل', amountMinor: 5000 }],
  })
  assert.ok(all.length >= 4, `⑤ عيّنة كاملة من الإشعارات — الموجود ${all.length}`)
  assert.ok(all.every((n) => n.perm !== undefined), '⑤ كل إشعار يحمل حقل perm')
  const cashierUser = st().appUsers.find((x) => x.id === u.id)
  const cashierPerms = effectivePermissionsFor(cashierUser, roles)
  const forCashier = visibleNotifications(all, cashierPerms)
  assert.ok(!forCashier.some((n) => n.id.startsWith('ins:')), '⑤ الكاشير لا يرى الأقساط')
  assert.ok(!forCashier.some((n) => n.id.startsWith('chq:')), '⑤ الكاشير لا يرى الشيكات')
  assert.ok(!forCashier.some((n) => n.id.startsWith('pinreset:')), '⑤ الكاشير لا يرى طلبات استعادة الأرقام')
  assert.ok(!forCashier.some((n) => n.id.startsWith('issue:')), '⑤ الكاشير لا يرى البلاغات الإدارية')
  const ownerPerms = effectivePermissionsFor(null, roles)
  const forOwner = visibleNotifications(all, ownerPerms)
  assert.equal(forOwner.length, all.length, '⑤ المالك يرى كل الإشعارات')
  const acc = roles.find((r) => r.id === 'accountant')
  if (acc) {
    const accPerms = new Set(acc.permissions)
    const forAcc = visibleNotifications(all, accPerms)
    assert.ok(forAcc.some((n) => n.id.startsWith('chq:')) === accPerms.has('acc.vouchers'), '⑤ شيكات المحاسب حسب صلاحيته')
  }
  console.log('  ✔ الجزء العام: ①②③⑤ — الدخول الموحد والبروفايل والإشعارات')
}

// ═══════════ لكل نشاط: ⑥ طباعة الشراء ومرتجعه + ⑦ سياسة الورديات ═══════════
let pass = 0
for (const activityId of ACTIVITIES) {
  const tpl = ACTIVITY_TEMPLATES.find((a) => a.id === activityId)

  // ── ⑦ المالك الرئيسي: تلميح فقط؛ البيع بلا وردية يمر ثم يُربط عند فتحها ──
  mem.clear()
  mem.set('shopsys-app', appState(activityId, true))
  const { useDataStore } = await import(`${repoUrl}?b8=${activityId}`)
  const st = () => useDataStore.getState()
  st().seed([])

  st().addItem({ nameAr: `صنف ${tpl.nameAr}`, sku: `B8-${activityId}`, barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 100_00, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)
  st().addSupplier({ nameAr: `مورد ${tpl.nameAr}`, phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
  const sup = st().suppliers.at(-1)
  st().postPurchase({ supplierId: sup.id, date: '2026-09-01', lines: [{ itemId: item.id, qty: 10, unitPriceMinor: 60_00 }], expenses: [{ nameAr: 'نولون', amountMinor: 50_00, method: 'value', paidBy: 'supplier' }], paidMinor: 200_00, notes: '' })
  const pur = st().purchases.at(-1)

  const line = { itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 100_00, unitCostMinor: 65_00, discountPercent: 0, soldByWeight: false }
  // أنشطة «الفاتورة أولاً» (تجارة/مصنع/خدمات): شاشة الورديات مخفية عنها —
  // فسياسة «لا بيع بلا وردية» لا تسري عليها (مراجعة عزل الأنشطة)
  const invoiceFirst = ['trading', 'manufacturing', 'services'].includes(activityId)
  if (invoiceFirst) {
    const sale0 = st().postSale({ lines: [line], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
    assert.equal(sale0.shiftId, null, `${activityId}: ⑦ فاتورة أولاً — بيع بلا وردية يمر وبلا ربط`)
    assertBalanced(st().journal.find((e) => e.id === sale0.journalEntryId).lines)
  } else {
    const ownerSale = st().postSale({ lines: [line], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
    assert.equal(ownerSale.shiftId, null, `${activityId}: ⑦ المالك لا يُمنع عند غياب الوردية`)
    assertBalanced(st().journal.find((e) => e.id === ownerSale.journalEntryId).lines)
    const shift = st().openShift('المالك الرئيسي', 100_00)
    const sale = st().postSale({ lines: [line], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
    assert.equal(sale.shiftId, shift.id, `${activityId}: ⑦ عند فتحها تُربط الفاتورة بالوردية`)
    assertBalanced(st().journal.find((e) => e.id === sale.journalEntryId).lines)
  }

  // ── ⑥ طباعة فاتورة الشراء بالقوالب الثلاثة ──
  const settings = { ...DEFAULT_RECEIPT_SETTINGS, shopName: `متجر ${tpl.nameAr}`, defaultTemplate: tpl.defaultInvoiceTemplate }
  const purModel = buildSimpleDocModel({
    docTitle: 'فاتورة شراء',
    invoiceNumber: pur.invoiceNumber, refCode: pur.refCode ?? '', dateIso: pur.date,
    partyLabel: sup.nameAr, paymentLabel: 'مدفوعة جزئياً',
    rows: pur.lines.map((l) => ({ nameAr: item.nameAr, qty: l.qty, unitPriceMinor: l.unitPriceMinor, totalMinor: Math.round(l.unitPriceMinor * l.qty) })),
    totalMinor: pur.grandTotalMinor, paidMinor: pur.paidMinor, settings,
    extraFooter: `بضاعة ${pur.goodsTotalMinor} + مصاريف ${pur.expensesTotalMinor}`,
  })
  assert.equal(purModel.totalMinor, 650_00, `${activityId}: ⑥ إجمالي الشراء 600+50`)
  assert.equal(purModel.remainingMinor, 450_00, `${activityId}: ⑥ المتبقي للمورد`)
  const pThermal = renderReceiptHtml(purModel, cur, settings)
  const pA4 = renderInvoiceA4Html(purModel, cur, settings)
  const pA5 = renderInvoiceA4Html(purModel, cur, settings, 'a5')
  assert.ok(pThermal.includes(pur.invoiceNumber) && pThermal.includes('فاتورة شراء'), `${activityId}: ⑥ حراري الشراء`)
  assert.ok(pA4.includes('size: A4') && pA4.includes('فاتورة شراء') && pA4.includes(sup.nameAr), `${activityId}: ⑥ A4 الشراء`)
  assert.ok(pA5.includes('size: A5') && pA5.includes(pur.invoiceNumber), `${activityId}: ⑥ A5 الشراء`)

  // ── ⑥ مرتجع شراء + طباعة إشعاره ──
  st().setOwnerPin(await hashPin('1111'))
  const pr = await (async () => {
    const ret = st().postPurchaseReturn({ purchaseId: pur.id, refund: 'debt', qtyByItem: new Map([[item.id, 2]]), reason: 'تالف', approvedBy: 'المالك' })
    return ret
  })()
  const prModel = buildSimpleDocModel({
    docTitle: 'مرتجع مشتريات (إشعار مدين)',
    invoiceNumber: pr.returnNumber, refCode: pr.refCode ?? '', dateIso: pr.date,
    partyLabel: sup.nameAr, paymentLabel: 'تخفيض من دين المورد',
    rows: pr.lines.map((l) => ({ nameAr: l.nameAr, qty: l.qty, unitPriceMinor: l.unitPriceMinor ?? l.landedUnitCostMinor, totalMinor: Math.round((l.unitPriceMinor ?? l.landedUnitCostMinor) * l.qty) })),
    totalMinor: pr.supplierValueMinor ?? pr.totalMinor, paidMinor: 0, settings,
    extraFooter: 'السبب: تالف',
  })
  const rThermal = renderReceiptHtml(prModel, cur, settings)
  const rA4 = renderInvoiceA4Html(prModel, cur, settings)
  const rA5 = renderInvoiceA4Html(prModel, cur, settings, 'a5')
  assert.ok(rThermal.includes(pr.returnNumber) && rThermal.includes('مرتجع مشتريات'), `${activityId}: ⑥ حراري المرتجع`)
  assert.ok(rA4.includes('size: A4') && rA4.includes('إشعار مدين'), `${activityId}: ⑥ A4 المرتجع`)
  assert.ok(rA5.includes('size: A5') && rA5.includes(pr.returnNumber), `${activityId}: ⑥ A5 المرتجع`)
  assertBalanced(st().journal.find((e) => e.id === pr.journalEntryId).lines)

  // ── ⑦ التعطيل: البيع بلا وردية يمر وshiftId=null (لغير «الفاتورة أولاً» — هم بلا ورديات أصلاً) ──
  if (!invoiceFirst) {
    mem.set('shopsys-app', appState(activityId, false))
    const openShiftNow = st().shifts.find((s) => s.status === 'open')
    if (openShiftNow) st().closeShift(openShiftNow.openingCashMinor + st().sales.filter((s) => s.shiftId === openShiftNow.id).reduce((a, s) => a + (s.paidMinor ?? s.totals.totalMinor), 0))
    const sale2 = st().postSale({ lines: [line], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true })
    assert.equal(sale2.shiftId, null, `${activityId}: ⑦ التعطيل يسمح والفاتورة «بلا وردية»`)
  }

  pass++
  console.log(`  ✔ ${tpl.nameAr} (${activityId}) — ⑥ طباعة الشراء ومرتجعه ×3 قوالب + ⑦ سياسة الورديات`)
}

assert.equal(pass, 29, 'اكتمال الأنشطة الـ29')
console.log(`\n✅ دفعة النقاط الثماني: الجزء العام (①②③⑤) + ${pass}/29 نشاطاً (⑥⑦) — كله سليم`)
