/**
 * الفحص التقاطعي الشامل بعد مراجعات الأقسام الخمسة (طلب المالك):
 * «نراجع عمل جميع الأقسام بعد التعديلات الأخيرة بحيث تكون متوافقة ونفحص القيود أنها سليمة»
 *
 * لكل نشاط من الـ16 متجر نظيف تمر عليه دورة واحدة متصلة تلمس كل الأقسام المراجعة:
 *   م1) افتتاحيات: خزينة + بنك + عميل + مورد (قيود فعلية)
 *   م2) مخزون/مشتريات: شراء آجل بمصروف نقل landed cost ⇒ متوسط مرجح
 *   م3) مبيعات: نقدي + آجل بحد ائتمان + مرتجع بيع نقدي معتمد
 *   م4) خزينة: سند قبض من العميل + سند صرف للمورد + تحويل برسوم + شيك وارد يُحصل + شيك صادر يُصرف
 *   م5) أطراف: كشوف مطابقة + أعمار FIFO + حمايات الحذف والتكرار
 *   م6) وحدة النشاط الخاصة (عيادة/معمل/نقلات/صيانة/مقاولات) حيث وُجدت — تدخل ذمة العميل
 *   م7) تسوية جرد خزينة بعجز ⇒ 5112
 *
 * وبعد كل مرحلة: فحص سلامة القيود الكامل —
 *   ك1) كل قيد متوازن سطرياً (assertBalanced)
 *   ك2) ميزان المراجعة متزن (Σ مدين = Σ دائن)
 *   ك3) الميزانية العمومية متزنة (أصول = خصوم + حقوق + أرباح محتجزة)
 *   ك4) 1103 = Σ كمية×متوسط، 1104 = Σ أرصدة العملاء، 2101 = Σ الموردين
 *   ك5) لا قيد بلا أسطر، لا سطر بحساب فارغ، لا قيمة سالبة/كسرية في debit/credit
 *   ك6) تسلسل أرقام القيود بلا تكرار
 */
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

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
const { trialBalance, balanceSheet } = await import(join(root, 'src/core/financialReports.ts'))
const { agingFromStatement, supplierRowsForAging, statementBalance } = await import(join(root, 'src/core/statements.ts'))

const ACTIVITIES = ACTIVITY_TEMPLATES.map((a) => a.id)
assert.equal(ACTIVITIES.length, 18)
const repoUrl = pathToFileURL(join(root, 'src/data/repo.ts')).href
const today = new Date().toISOString().slice(0, 10)

let pass = 0

for (const activityId of ACTIVITIES) {
  const nameAr = ACTIVITY_TEMPLATES.find((a) => a.id === activityId).nameAr
  mem.clear()
  mem.set('shopsys-app', JSON.stringify({ state: { setup: { requireOpenShiftForSales: false,  done: true, countryCode: 'EG', activityId, vatPercent: 0, taxInclusive: true, allowNegativeTreasury: false }, license: { plan: 'pro' } }, version: 0 }))
  const { useDataStore } = await import(`${repoUrl}?cross16=${activityId}`)
  const st = () => useDataStore.getState()
  const bal = (code) => { let v = 0; for (const e of st().journal) for (const l of e.lines) if (l.accountCode === code) v += l.debit - l.credit; return v }

  /** فحص سلامة القيود الكامل — يُستدعى بعد كل مرحلة */
  let checks = 0
  const auditLedger = (stage) => {
    const j = st().journal
    const seen = new Set()
    for (const e of j) {
      assertBalanced(e.lines) // ك1
      assert.ok(e.lines.length >= 2, `${activityId}/${stage}: قيد ${e.id} بأقل من سطرين`)
      assert.ok(!seen.has(e.entryNumber), `${activityId}/${stage}: رقم قيد مكرر ${e.entryNumber}`)
      seen.add(e.entryNumber)
      for (const l of e.lines) { // ك5
        assert.ok(l.accountCode && typeof l.accountCode === 'string', `${activityId}/${stage}: سطر بحساب فارغ`)
        assert.ok(Number.isInteger(l.debit) && Number.isInteger(l.credit), `${activityId}/${stage}: قيمة كسرية`)
        assert.ok(l.debit >= 0 && l.credit >= 0, `${activityId}/${stage}: قيمة سالبة`)
        assert.ok(!(l.debit > 0 && l.credit > 0), `${activityId}/${stage}: سطر مدين ودائن معاً`)
      }
    }
    const tb = trialBalance(j, { from: '0000-01-01', to: '9999-12-31' }) // ك2
    assert.ok(tb.balanced, `${activityId}/${stage}: ميزان المراجعة غير متزن`)
    const bs = balanceSheet(j, '9999-12-31') // ك3
    assert.ok(bs.balanced, `${activityId}/${stage}: الميزانية غير متزنة (أصول ${bs.totalAssetsMinor} ≠ ${bs.totalLiabilitiesEquityMinor})`)
    // ك4
    const inv = st().items.reduce((a, it) => a + Math.round((it.stockQty ?? 0) * it.costMinor), 0)
    assert.equal(bal('1103'), inv, `${activityId}/${stage}: 1103 ≠ Σ كمية×متوسط`)
    const sumCust = st().customers.reduce((s, c) => s + st().getCustomerBalance(c.id), 0)
    assert.equal(bal('1104'), sumCust, `${activityId}/${stage}: 1104 ≠ Σ العملاء`)
    const sumSupp = st().suppliers.reduce((s, x) => s + st().getSupplierBalance(x.id), 0)
    assert.equal(-bal('2101'), sumSupp, `${activityId}/${stage}: 2101 ≠ Σ الموردين`)
    checks++
  }

  st().seed([])

  // ═══ م1) الافتتاحيات ═══
  st().setOpeningBalance({ kind: 'treasury', refId: '1101', amountMinor: 1000000, label: 'خزينة' })
  st().setOpeningBalance({ kind: 'treasury', refId: '1102', amountMinor: 500000, label: 'بنك' })
  st().addCustomer({ nameAr: `عميل ${nameAr}`, phone: '0111', address: '', notes: '', openingMinor: 0, creditLimitMinor: 500000 })
  const cust = st().customers.at(-1)
  st().setOpeningBalance({ kind: 'customer', refId: cust.id, amountMinor: 40000, label: cust.nameAr })
  st().addSupplier({ nameAr: `مورد ${nameAr}`, phone: '0100', notes: '' })
  const sup = st().suppliers.at(-1)
  st().setOpeningBalance({ kind: 'supplier', refId: sup.id, amountMinor: 30000, label: sup.nameAr })
  auditLedger('م1-افتتاحيات')

  // ═══ م2) مشتريات بمصروف landed cost ═══
  st().addItem({ nameAr: `صنف ${nameAr}`, sku: 'X16-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, priceMinor: 30000, minQty: 0, stockQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true })
  const item = st().items.at(-1)
  // 20 قطعة × 100 + نقل 200 نقدي ⇒ متوسط 110
  st().postPurchase({ supplierId: sup.id, date: today, lines: [{ itemId: item.id, qty: 20, unitPriceMinor: 10000 }], expenses: [{ nameAr: 'نقل', amountMinor: 20000, method: 'qty', paidBy: 'treasury', payAccount: '1101' }], paidMinor: 0, notes: '' })
  assert.equal(st().items.find((i) => i.id === item.id).costMinor, 11000, `${activityId}: المتوسط المحمل 110`)
  assert.equal(st().getSupplierBalance(sup.id), 230000, `${activityId}: مستحق المورد 2000 بضاعة + 300 افتتاحي`)
  auditLedger('م2-مشتريات')

  // ═══ م3) مبيعات: نقدي + آجل + مرتجع معتمد ═══
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 30000, unitCostMinor: 11000, discountPercent: 0, soldByWeight: false }], customerId: null, payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  st().postSale({ lines: [{ itemId: item.id, nameAr: item.nameAr, qty: 4, unitPriceMinor: 30000, unitCostMinor: 11000, discountPercent: 0, soldByWeight: false }], customerId: cust.id, payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: true, treasury: '1101' })
  const creditSale = st().sales.at(-1)
  assert.equal(st().getCustomerBalance(cust.id), 160000, `${activityId}: ذمة العميل 400 افتتاحي + 1200 آجل`)
  // مرتجع قطعة من الآجلة على الحساب (يخفض ذمته) — الحالة resellable ترجع للمخزون
  st().postSaleReturn({ saleId: creditSale.id, lineSpecs: [{ lineIndex: 0, qty: 1, condition: 'resellable' }], refund: 'credit', reason: 'مقاس غير مناسب', approvedBy: 'المشرف' })
  assert.equal(st().getCustomerBalance(cust.id), 130000, `${activityId}: المرتجع 300 خفض ذمته`)
  assert.equal(st().items.find((i) => i.id === item.id).stockQty, 14, `${activityId}: 20−7+1`)
  auditLedger('م3-مبيعات')

  // ═══ م4) خزينة كاملة ═══
  st().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 50000, description: 'دفعة', partyKind: 'customer', partyId: cust.id })
  st().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 80000, description: 'سداد', partyKind: 'supplier', partyId: sup.id })
  st().postVoucher({ kind: 'transfer', treasury: '1101', counterAccountCode: '1102', amountMinor: 100000, description: 'إيداع', feeMinor: 500 })
  const chqIn = st().receiveCheque({ chequeNumber: `X16-IN-${activityId}`, partyId: cust.id, bankName: 'الأهلي', amountMinor: 40000, dueDate: today, notes: '' })
  st().setChequeStatus(chqIn.id, 'deposited')
  st().setChequeStatus(chqIn.id, 'collected', '1102')
  const chqOut = st().issueCheque({ chequeNumber: `X16-OUT-${activityId}`, partyId: sup.id, bankName: 'CIB', amountMinor: 60000, dueDate: today, notes: '' })
  st().setChequeStatus(chqOut.id, 'cleared', '1102')
  assert.equal(st().getCustomerBalance(cust.id), 40000, `${activityId}: العميل بعد السند والشيك`)
  assert.equal(st().getSupplierBalance(sup.id), 90000, `${activityId}: المورد بعد السند والشيك`)
  assert.equal(bal('1106'), 0)
  assert.equal(bal('2106'), 0)
  auditLedger('م4-خزينة')

  // ═══ م5) أطراف: كشوف + أعمار + حمايات ═══
  assert.equal(statementBalance(st().getCustomerStatementRows(cust.id)), st().getCustomerBalance(cust.id))
  const ca = agingFromStatement(st().getCustomerStatementRows(cust.id), today)
  assert.equal(ca.totalMinor, st().getCustomerBalance(cust.id), `${activityId}: Σ أعمار = الرصيد`)
  const sa = agingFromStatement(supplierRowsForAging(st().getSupplierStatementRows(sup.id)), today)
  assert.equal(sa.totalMinor, st().getSupplierBalance(sup.id), `${activityId}: Σ أعمار المورد`)
  assert.throws(() => st().removeCustomer(cust.id), /رصيد قائم/)
  assert.throws(() => st().removeSupplier(sup.id), /رصيد قائم/)
  assert.throws(() => st().addCustomer({ nameAr: cust.nameAr, phone: '', address: '', notes: '', openingMinor: 0, creditLimitMinor: 0 }), /بنفس الاسم/)
  auditLedger('م5-أطراف')

  // ═══ م6) وحدة النشاط الخاصة — تدخل ذمة نفس العميل وتُفحص القيود بعدها ═══
  let unitLabel = '—'
  if (activityId === 'clinic') {
    st().addClinicPatient({ nameAr: 'مريض التقاطع', phone: '0102', gender: 'male', birthDate: '', medicalHistory: '', linkedCustomerId: cust.id, notes: '' })
    const patient = st().clinicPatients.at(-1)
    const before = st().getCustomerBalance(cust.id)
    st().addClinicVisit({ patientId: patient.id, kind: 'checkup', complaint: 'صداع', diagnosis: '', treatment: '', rxLines: [], feeMinor: 20000, paidMinor: 5000, vatPercent: 0, planId: null, treasury: '1101' })
    assert.equal(st().getCustomerBalance(cust.id), before + 15000, `${activityId}: زيارة آجلة 150 دخلت ذمة العميل المربوط`)
    unitLabel = 'زيارة عيادة آجلة → ذمة العميل'
  } else if (activityId === 'lab') {
    st().addLabTest({ code: 'CBC', nameAr: 'صورة دم', category: 'دم', sampleType: 'وريدي', unit: '', priceMinor: 30000, costMinor: 5000, refRanges: [] })
    const test = st().labTests.at(-1)
    st().addLabPatient({ nameAr: 'مريض معمل التقاطع', phone: '0103', gender: 'male', birthDate: '', linkedCustomerId: cust.id, notes: '' })
    const patient = st().labPatients.at(-1)
    const before = st().getCustomerBalance(cust.id)
    st().registerLabOrder({ patientId: patient.id, referrerId: null, testIds: [test.id], payment: 'credit', discountPercent: 0, vatPercent: 0, notes: '' })
    assert.equal(st().getCustomerBalance(cust.id), before + 30000, `${activityId}: طلب معمل آجل دخل الذمة`)
    unitLabel = 'طلب معمل آجل → ذمة العميل'
  } else if (activityId === 'logistics') {
    const before = st().getCustomerBalance(cust.id)
    st().postTrip({ customerId: cust.id, vehicleId: null, driverId: null, input: { fromLoc: 'دمياط', toLoc: 'القاهرة', qty: 1, unitPriceMinor: 50000, expenses: [], payment: 'credit', vatPercent: 0, containerNumbers: [] }, notes: '', treasury: '1101' })
    assert.equal(st().getCustomerBalance(cust.id), before + 50000, `${activityId}: نقلة آجلة دخلت الذمة`)
    unitLabel = 'نقلة آجلة → ذمة العميل'
  } else if (activityId === 'mobile') {
    const tk = st().openTicket({ customerId: cust.id, customerName: '', customerPhone: '', deviceName: 'iPhone', issue: 'شاشة', estimateMinor: 0, notes: '' })
    st().setTicketStatus(tk.id, 'ready')
    const before = st().getCustomerBalance(cust.id)
    st().deliverTicket(tk.id, { laborMinor: 25000, parts: [], payment: 'credit', paidMinor: 0, vatPercent: 0, treasury: '1101' })
    assert.equal(st().getCustomerBalance(cust.id), before + 25000, `${activityId}: صيانة آجلة دخلت الذمة`)
    unitLabel = 'صيانة آجلة → ذمة العميل'
  }
  auditLedger('م6-وحدة النشاط')

  // ═══ م7) تسوية جرد خزينة بعجز ═══
  const cashBook = bal('1101')
  st().applySettlement({ section: 'treasury', refId: '1101', actualMinor: cashBook - 1500, reason: 'جرد تقاطعي', approvedBy: 'المشرف' })
  assert.equal(bal('5112'), 1500, `${activityId}: عجز الجرد في 5112`)
  auditLedger('م7-تسوية')

  pass++
  console.log(`  ✓ ${nameAr} (${activityId}): ${st().journal.length} قيداً عبر ${checks} فحوص دفترية — ميزان+ميزانية متزنان بعد كل مرحلة${unitLabel !== '—' ? ` · ${unitLabel}` : ''}`)
}

assert.equal(pass, 18)
console.log(`\n✅ verify_cross_sections_16: كل الأقسام متوافقة بعد التعديلات والقيود سليمة على الأنشطة الـ16`)
