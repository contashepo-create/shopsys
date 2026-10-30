import { beforeEach, expect, it } from 'vitest'
import { EMPTY_EXTENDED, useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { buildBackup, parseBackup } from '../src/core/backup.ts'
import { flushSecureStorageWrites, secureStorage } from '../src/data/secureStorage.ts'
const original = useDataStore.getState()
const app = useAppStore.getState()
beforeEach(() => {
  useAppStore.setState({ ...app, setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
  useDataStore.setState({ ...original, customers: [], clinicPatients: [], clinicVisits: [], clinicCollections: [], labPatients: [], labTests: [], labOrders: [], insuranceProviders: [], insuranceClaims: [], projects: [], projectExtracts: [], journal: [], vouchers: [], clientSettlements: [], cheques: [], openingBalances: {} })
})
function makeLab() {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'آخر', phone: '', creditLimitMinor: 0, notes: '' })
  const other = useDataStore.getState().customers.at(-1)!
  const patient = s.addLabPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', notes: '', linkedCustomerId: customer.id })
  const test = s.addLabTest({ code: 'TEST', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 10000, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 70 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  const updated = s.refundLabOrder({ orderId: order.id, amountMinor: 4000, mode: 'customer_credit', reason: 'رد' })
  return { s, customer, other, order, insurer, entryId: updated.refunds![0].journalEntryId }
}
it('قيد مرتجع المعمل المفقود يحجب كشف العميل وذممه دون حجب عميل آخر', () => {
  const { s, customer, other, order, entryId } = makeLab()
  expect(s.getCustomerBalance(customer.id)).toBe(-1200)
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== entryId) })
  expect(() => s.getCustomerBalance(customer.id)).toThrow(new RegExp(order.orderNumber))
  expect(() => s.getCustomerStatementRows(customer.id)).toThrow(/مراجعة/)
  expect(() => s.getOpenClientInvoices(customer.id)).toThrow(/مراجعة/)
  expect(s.getCustomerBalance(other.id)).toBe(0)
})
it('قيد مرتجع معمل غير مطابق لا يُعامل كنصيب صفر', () => {
  const { s, customer, entryId } = makeLab()
  useDataStore.setState({ journal: useDataStore.getState().journal.map(e => e.id === entryId ? { ...e, sourceId: 999999 } : e) })
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
})
it('زيارة مؤمّنة قديمة بلا حقل نصيب العميل تستند للقيد لا إجمالي المرتجع', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  const updated = s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'patient_credit', reason: 'رد' })
  const entryId = updated.refunds![0].journalEntryId
  useDataStore.setState({ clinicVisits: useDataStore.getState().clinicVisits.map(v => v.id === visit.id ? { ...v, refunds: v.refunds!.map(r => ({ ...r, customerCreditMinor: undefined })) } : v) })
  expect(s.getPatientBalance(patient.id)).toBe(-1200)
  expect(s.getCustomerBalance(customer.id)).toBe(-1200)
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== entryId) })
  expect(() => s.getPatientBalance(patient.id)).toThrow(/مراجعة/)
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
  expect(() => s.getOpenClientInvoices(customer.id)).toThrow(/مراجعة/)
})
it('حذف القيد الأصلي مع المطالبة لا يحول الطلب المؤمن إلى دين على العميل', () => {
  const { s, customer, order } = makeLab()
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== order.journalEntryId), insuranceClaims: [] })
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
})
it('قيد مرتجع غير متزن لا يسمح بالاعتماد على نصيب العميل', () => {
  const { s, customer, entryId } = makeLab()
  useDataStore.setState({ journal: useDataStore.getState().journal.map(e => e.id === entryId ? { ...e, lines: e.lines.map(l => l.accountCode === '1110' ? { ...l, credit: l.credit - 1 } : l) } : e) })
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
})
it('تغطية كاملة للجهة تحافظ على رصيد عميل صفري عند وجود القيد السليم', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addLabPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', notes: '', linkedCustomerId: customer.id })
  const test = s.addLabTest({ code: 'FULL', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 10000, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 100 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  s.refundLabOrder({ orderId: order.id, amountMinor: 4000, mode: 'customer_credit', reason: 'رد' })
  expect(s.getCustomerBalance(customer.id)).toBe(0)
})
it('لا يُرحّل سند قبض أو تحصيل عميل عند تعذر إثبات رصيد المرتجع', () => {
  const { s, customer, entryId } = makeLab()
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== entryId) })
  const before = useDataStore.getState()
  expect(() => s.postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 1000, description: 'قبض', partyKind: 'customer', partyId: customer.id, __approvalBypass: true })).toThrow(/مراجعة/)
  expect(() => s.receiveClientPayment({ customerId: customer.id, amountMinor: 1000, treasury: '1101' })).toThrow(/مراجعة/)
  expect(useDataStore.getState().vouchers).toEqual(before.vouchers)
  expect(useDataStore.getState().clientSettlements).toEqual(before.clientSettlements)
  expect(useDataStore.getState().journal).toEqual(before.journal)
})
it('حذف قيد رد التأمين يحجب رصيد الجهة ويمنع تحصيل مطالبة غير مطابقة', () => {
  const { s, insurer, entryId } = makeLab()
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== entryId) })
  const before = useDataStore.getState()
  expect(() => s.getClaimBalance(insurer.id)).toThrow(/مراجعة/)
  expect(() => s.settleInsuranceClaims(insurer.id)).toThrow(/مراجعة/)
  expect(useDataStore.getState().insuranceClaims).toEqual(before.insuranceClaims)
  expect(useDataStore.getState().journal).toEqual(before.journal)
})
it('تحصيل الجهة في فرع لا يمس مطالبة فرع آخر بنفس المعرف الإداري للجهة', () => {
  const { s, insurer } = makeLab()
  const snapshot = useRawDataStore.getState()
  const own = snapshot.insuranceClaims[0]
  const foreign = { ...own, id: own.id + 5000, branchId: 2, claimMinor: 9999, sourceId: 9999 }
  useRawDataStore.setState({
    branches: [{ id: 1, nameAr: 'الرئيسي', isMain: true, warehouseId: 1, treasuryCode: '1101', active: true }, { id: 2, nameAr: 'ثان', isMain: false, warehouseId: 2, treasuryCode: '1102', active: true }], activeBranchId: 1,
    insuranceClaims: [{ ...own, branchId: 1 }, foreign],
    insuranceProviders: snapshot.insuranceProviders.map(p => ({ ...p, branchId: 1 })),
    labOrders: snapshot.labOrders.map(o => ({ ...o, branchId: 1 })),
    labPatients: snapshot.labPatients.map(p => ({ ...p, branchId: 1 })),
    customers: snapshot.customers.map(c => ({ ...c, branchId: 1 })),
    journal: snapshot.journal.map(e => ({ ...e, branchId: 1 })),
  })
  try {
    expect(s.getClaimBalance(insurer.id)).toBe(4200)
    const result = s.settleInsuranceClaims(insurer.id)
    expect(result).toEqual({ total: 4200, count: 1 })
    expect(useRawDataStore.getState().insuranceClaims.find(c => c.id === foreign.id)?.settled).toBe(false)
  } finally { useRawDataStore.setState({ activeBranchId: null, branches: [] }) }
})
it('طلب مؤمن فقد قيده الأصلي ومطالبته لا يظهر كدين على العميل حتى بلا مرتجعات', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addLabPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', notes: '', linkedCustomerId: customer.id })
  const test = s.addLabTest({ code: 'NO-CLAIM', nameAr: 'تحليل', category: 'كيمياء', sampleType: 'دم', unit: '', priceMinor: 10000, costMinor: 0, refRanges: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 70 })
  const order = s.registerInsuredLabOrder({ patientId: patient.id, testIds: [test.id], providerId: insurer.id, referrerId: null, vatPercent: 0 })
  useDataStore.setState({ insuranceClaims: [], journal: useDataStore.getState().journal.filter(e => e.id !== order.journalEntryId) })
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
})
it('إجمالي رد مؤمّن بلا سجلاته لا يُعرض كأنه صفر', () => {
  const { s, customer, order, insurer } = makeLab()
  useDataStore.setState({ labOrders: useDataStore.getState().labOrders.map(o => o.id === order.id ? { ...o, refunds: [] } : o) })
  expect(() => s.getCustomerBalance(customer.id)).toThrow(/مراجعة/)
  expect(() => s.getClaimBalance(insurer.id)).toThrow(/مراجعة/)
})
it('لا ينشئ مرتجعاً مؤمّناً جديداً فوق تاريخ مفقود القيد', () => {
  const { s, order, entryId } = makeLab()
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== entryId) })
  const before = useDataStore.getState()
  expect(() => s.refundLabOrder({ orderId: order.id, amountMinor: 1000, mode: 'cash', reason: 'رد إضافي' })).toThrow(/مراجعة/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().labOrders).toEqual(before.labOrders)
})
it('يمنع عكس قيد طلب معمل مؤمن مباشرة وترك طلبه ومطالبته مفتوحين', () => {
  const { s, order } = makeLab()
  const before = useDataStore.getState()
  expect(() => s.reverseEntry(order.journalEntryId, 'تصحيح')).toThrow(/طلب معمل/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().insuranceClaims).toEqual(before.insuranceClaims)
})
it('يستعيد عكس البيع المؤمّن الكمية إلى دفعة الصلاحية نفسها', () => {
  const s = useDataStore.getState()
  const item = { id: 5, nameAr: 'دواء', sku: 'DRUG', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockValueMinor: 10000, stockQty: 10, priceMinor: 2000, minQty: 0, trackExpiry: true, active: true }
  useDataStore.setState({ items: [item] as never, batches: [{ id: 1, itemId: 5, expiryDate: '2099-01-01', qty: 10, purchaseId: null, receivedAt: '2026-01-01' }] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة دواء', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 5, nameAr: 'دواء', qty: 2, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false, treasury: '1101' })
  const entry = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!
  const before = useDataStore.getState()
  expect(before.batches[0].qty).toBe(8)
  s.reverseEntry(entry.id, 'إلغاء')
  expect(useDataStore.getState().items[0].stockQty).toBe(10)
  expect(useDataStore.getState().batches[0].qty).toBe(10)
  expect(useDataStore.getState().batches[0].expiryDate).toBe('2099-01-01')
  expect(useDataStore.getState().insuranceClaims[0].claimMinor).toBe(0)
})
it('بيع مؤمّن يرد القيمة الدقيقة لمخزون استنفد مع باقي التقريب', () => {
  const s = useDataStore.getState()
  const item = { id: 7, nameAr: 'مخزون', sku: 'STK', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 3, stockValueMinor: 10, stockQty: 3, priceMinor: 20, minQty: 0, trackExpiry: false, active: true }
  useDataStore.setState({ items: [item] as never, batches: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 7, nameAr: 'مخزون', qty: 3, unitPriceMinor: 20, unitCostMinor: 3, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const state = useDataStore.getState()
  const entry = state.journal.find(e => e.sourceType === 'insured_sale')!
  expect(entry.lines.find(l => l.accountCode === '5101')?.debit).toBe(10)
  expect(state.items[0].stockValueMinor).toBe(0)
  s.reverseEntry(entry.id, 'إلغاء')
  expect(useDataStore.getState().items[0].stockValueMinor).toBe(10)
})
it('تكرار سطور كسرية لا يزيد القيمة عند عكس البيع المؤمّن', () => {
  const s = useDataStore.getState()
  const item = { id: 8, nameAr: 'موزون', sku: 'WT', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 1, stockValueMinor: 2, stockQty: 2, priceMinor: 20, minQty: 0, trackExpiry: false, active: true }
  useDataStore.setState({ items: [item] as never, batches: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة وزن', coveragePercent: 50 })
  const line = { itemId: 8, nameAr: 'موزون', qty: 0.5, unitPriceMinor: 20, unitCostMinor: 1, discountPercent: 0, soldByWeight: true }
  s.postInsuredSale({ lines: [line, line], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const entry = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!
  expect(entry.lines.find(l => l.accountCode === '5101')?.debit).toBe(1)
  s.reverseEntry(entry.id, 'إلغاء')
  expect(useDataStore.getState().items[0].stockValueMinor).toBe(2)
})
it('يرفض إلغاء بيع مؤمّن قديم لا يحدد دفعات الصلاحية المصروفة', () => {
  const s = useDataStore.getState()
  const item = { id: 9, nameAr: 'دواء قديم', sku: 'LEG', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 10, priceMinor: 2000, minQty: 0, trackExpiry: true, active: true }
  useDataStore.setState({ items: [item] as never, batches: [{ id: 1, itemId: 9, expiryDate: '2099-01-01', qty: 10, purchaseId: null, receivedAt: '2026-01-01' }] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة قديمة', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 9, nameAr: item.nameAr, qty: 2, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const entry = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!
  useDataStore.setState({ insuranceClaims: useDataStore.getState().insuranceClaims.map(c => ({ ...c, expiryBatches: undefined })) })
  const before = useDataStore.getState()
  expect(() => s.reverseEntry(entry.id, 'إلغاء')).toThrow(/دفعات الصلاحية/)
  expect(useDataStore.getState().journal).toEqual(before.journal)
  expect(useDataStore.getState().batches).toEqual(before.batches)
  expect(useDataStore.getState().items).toEqual(before.items)
})
it('بيع خدمة مؤمنة لا يخصم مخزوناً ولا يتطلبه عند العكس', () => {
  const s = useDataStore.getState()
  const item = { id: 10, nameAr: 'خدمة', sku: 'SRV', barcodes: [], categoryId: 1, baseUnit: 'خدمة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 2000, minQty: 0, trackExpiry: false, isService: true, active: true }
  useDataStore.setState({ items: [item] as never, batches: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة خدمة', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 10, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const entry = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!
  expect(useDataStore.getState().items[0].stockQty).toBe(0)
  s.reverseEntry(entry.id, 'إلغاء')
  expect(useDataStore.getState().items[0].stockQty).toBe(0)
})
it('إعادة ترقيم دفعة لاحقة لا يخلطها مع الدفعة المباعة عند العكس', () => {
  const s = useDataStore.getState()
  const item = { id: 11, nameAr: 'دواء', sku: 'LOT', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 2, priceMinor: 2000, minQty: 0, trackExpiry: true, active: true }
  const oldBatch = { id: 1, itemId: 11, lotNumber: 'OLD', expiryDate: '2099-01-01', qty: 2, purchaseId: null, receivedAt: '2026-01-01' }
  useDataStore.setState({ items: [item] as never, batches: [oldBatch] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة دفعات', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 11, nameAr: item.nameAr, qty: 2, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const entry = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!
  expect(useDataStore.getState().batches).toHaveLength(0)
  useDataStore.setState({ items: useDataStore.getState().items.map(i => ({ ...i, stockQty: 4, stockValueMinor: 4000 })), batches: [{ ...oldBatch, lotNumber: 'NEW', qty: 4 }] })
  s.reverseEntry(entry.id, 'إلغاء')
  const batches = useDataStore.getState().batches
  expect(batches.find(b => b.lotNumber === 'NEW')?.qty).toBe(4)
  expect(batches.find(b => b.lotNumber === 'OLD')?.qty).toBe(2)
  expect(new Set(batches.map(b => b.id)).size).toBe(2)
  expect(useDataStore.getState().items[0].stockQty).toBe(6)
})
it('لا تُحصّل مطالبة بيع مؤمّن فقد قيده الأصلي', () => {
  const s = useDataStore.getState()
  const item = { id: 12, nameAr: 'صنف', sku: 'SALE', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 10, priceMinor: 2000, minQty: 0, trackExpiry: false, active: true }
  useDataStore.setState({ items: [item] as never, batches: [] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة بيع', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 12, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const entry = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!
  useDataStore.setState({ journal: useDataStore.getState().journal.filter(e => e.id !== entry.id) })
  const before = useDataStore.getState()
  expect(() => s.getClaimBalance(insurer.id)).toThrow(/مراجعة/)
  expect(() => s.settleInsuranceClaims(insurer.id)).toThrow(/مراجعة/)
  expect(useDataStore.getState().insuranceClaims).toEqual(before.insuranceClaims)
  expect(useDataStore.getState().journal).toEqual(before.journal)
})
it('يكتشف تأمين زيارة من قيد 1110 حتى عند فقد الربط القديم بالجهة والمطالبة', () => {
  const s = useDataStore.getState()
  s.addCustomer({ ...EMPTY_EXTENDED, nameAr: 'عميل', phone: '', creditLimitMinor: 0, notes: '' })
  const customer = useDataStore.getState().customers.at(-1)!
  const patient = s.addClinicPatient({ nameAr: 'مريض', phone: '', gender: 'male', birthDate: '', medicalHistory: '', notes: '', linkedCustomerId: customer.id })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة', coveragePercent: 70 })
  const visit = s.registerInsuredVisit({ patientId: patient.id, providerId: insurer.id, kind: 'checkup', complaint: '', diagnosis: '', treatment: '', feeMinor: 10000, vatPercent: 0 })
  s.refundClinicVisit({ visitId: visit.id, amountMinor: 4000, mode: 'patient_credit', reason: 'رد' })
  useDataStore.setState({ insuranceClaims: [], clinicVisits: useDataStore.getState().clinicVisits.map(v => v.id === visit.id ? { ...v, insuranceProviderId: null, refunds: v.refunds!.map(r => ({ ...r, customerCreditMinor: undefined })) } : v) })
  expect(s.getPatientBalance(patient.id)).toBe(-1200)
  expect(s.getCustomerBalance(customer.id)).toBe(-1200)
  const before = useDataStore.getState().journal
  expect(() => s.refundClinicVisit({ visitId: visit.id, amountMinor: 1000, mode: 'cash', reason: 'رد' })).toThrow(/مطالبة.*مفقودة/)
  expect(useDataStore.getState().journal).toEqual(before)
})
it('تستمر لقطة دفعات البيع المؤمّن بعد تخزين مشفر ونسخة واستعادة المخزن', async () => {
  const s = useDataStore.getState()
  const item = { id: 13, nameAr: 'دواء', sku: 'BACKUP', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 4, priceMinor: 2000, minQty: 0, trackExpiry: true, active: true }
  useDataStore.setState({ items: [item] as never, batches: [{ id: 1, itemId: 13, lotNumber: 'B', expiryDate: '2099-01-01', qty: 4, purchaseId: null, receivedAt: '2026-01-01' }] })
  const insurer = s.addInsuranceProvider({ nameAr: 'جهة حفظ', coveragePercent: 70 })
  s.postInsuredSale({ lines: [{ itemId: 13, nameAr: item.nameAr, qty: 2, unitPriceMinor: 2000, unitCostMinor: 1000, discountPercent: 0, soldByWeight: false }], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
  const entryId = useDataStore.getState().journal.find(e => e.sourceType === 'insured_sale')!.id
  await flushSecureStorageWrites('shopsys-data')
  const stored = await secureStorage.getItem('shopsys-data')
  expect(stored).toBeTruthy()
  const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 1, shopName: 'اختبار' })
  const restored = parseBackup(JSON.stringify(backup))
  useRawDataStore.setState({ items: [], batches: [], insuranceClaims: [], journal: [] })
  await flushSecureStorageWrites('shopsys-data')
  await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
  await useRawDataStore.persist.rehydrate()
  expect(useDataStore.getState().insuranceClaims[0].expiryBatches?.[0].lotNumber).toBe('B')
  useDataStore.getState().reverseEntry(entryId, 'إلغاء بعد الاستعادة')
  expect(useDataStore.getState().batches[0].qty).toBe(4)
})
