import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const original = useRawDataStore.getState(), app = useAppStore.getState(), S = () => useRawDataStore.getState()
const exp = (id: string, fileId: number, amountMinor: number, taxPercent = 0) => ({ id, label: `نقل ${id}`, amountMinor, accountCode: '5108', settlement: 'paid_now' as const, custodyFileId: fileId, taxTreatment: taxPercent ? 'exclusive' as const : 'exempt' as const, taxPercent, affectsProfit: true, landedCostAllocation: 'none' as const })
let fileId = 0, itemId = 0
const line = () => ({ itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 5000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false })
const post = (internalExpenses: ReturnType<typeof exp>[], documentDate?: string) => S().postSale({ lines: [line()], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 5000, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false, internalExpenses, documentDate })
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 15, 12))
 const setup = { ...app.setup, completed: true, countryCode: 'EG', activityId: 'grocery' as const, allowNegativeTreasury: true, allowNegativeStock: true, requireOpenShiftForSales: false }
 useAppStore.setState({ setup, companySetup: setup, fiscalYears: [] })
 useRawDataStore.setState({ ...original, currentUserId: null, activeBranchId: null, branches: [], employees: [{ id: 1, nameAr: 'موظف', active: true }], projects: [], custodyFiles: [], custodyTxs: [], employeeAdvances: [], projectCosts: [], journal: [], sales: [], items: [], treasuries: [{ code: '1101', nameAr: 'خزينة', kind: 'cash', isDefault: true }], shifts: [] } as never)
 fileId = S().openCustodyFile({ employeeId: 1, projectId: null, reason: 'عهدة', notes: '' }).id
 S().fundCustodyFile({ fileId, amountMinor: 1000, treasury: '1101', description: '' })
 itemId = S().ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
})
afterEach(() => { useRawDataStore.setState(original); useAppStore.setState(app); vi.useRealTimers() })
it('يرفض مجموع مصروفات البيع من الملف نفسه إذا تجاوز رصيده، دون فاتورة أو قيد', () => {
 const before = S(); expect(() => post([exp('a', fileId, 600), exp('b', fileId, 600)])).toThrow(/متبقي العهدة/)
 expect(S()).toBe(before)
})
it('يحسب الضريبة ومجموع المصروفات ويقبل ما لا يتجاوز رصيد العهدة', () => {
 const sale = post([exp('a', fileId, 500, 10), exp('b', fileId, 450)])
 expect(S().getCustodySummary(fileId).remainingMinor).toBe(0)
 expect(S().custodyTxs.filter(t => t.journalEntryId === sale.journalEntryId).map(t => t.amountMinor)).toEqual([550, 450])
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 0, treasury: '1101' })).not.toThrow()
})
it('تعديل البيع يعيد حساب مجموع المصروفات المستبدلة دون تجاوز الرصيد', () => {
 const sale = post([exp('old', fileId, 400)])
 const before = S()
 expect(() => S().editSale({ saleId: sale.id, lines: [line()], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 5000, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, internalExpenses: [exp('a', fileId, 600), exp('b', fileId, 600)] })).toThrow(/متبقي العهدة/)
 expect(S()).toBe(before)
})
it('يرفض بيعاً مؤرخاً قبل فتح العهدة ولا يترك مستنداً أو قيداً', () => {
 const before = S(); expect(() => post([exp('a', fileId, 100)], '2026-11-14')).toThrow(/تاريخ حركة العهدة/); expect(S()).toBe(before)
})
it('لا يمحو مصروفاً آخر لمجرد احتواء بيانه على رقم البيع', () => {
 const sale = post([exp('old', fileId, 300)])
 const extra = S().postCustodyExpense({ fileId, amountMinor: 100, description: `[sale:${sale.id}] بيان مستقل` })
 S().editSale({ saleId: sale.id, lines: [line()], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 5000, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, internalExpenses: [exp('new', fileId, 200)] })
 expect(S().custodyTxs.some(tx => tx.id === extra.id && tx.journalEntryId === extra.journalEntryId)).toBe(true)
 expect(S().getCustodySummary(fileId).remainingMinor).toBe(700)
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 700, treasury: '1101' })).not.toThrow()
})
it('لا يعدل الفاتورة إذا اختفت حركة العهدة أو أُغلقت العهدة حتى عند حذف المصروف في التعديل', () => {
 const sale = post([exp('old', fileId, 300)])
 const edit = () => S().editSale({ saleId: sale.id, lines: [line()], customerId: null, payment: 'cash', treasury: '1101', paidMinor: 5000, invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, internalExpenses: [] })
 const txs = S().custodyTxs; useRawDataStore.setState({ custodyTxs: txs.filter(t => t.journalEntryId !== sale.journalEntryId) })
 let before = S(); expect(edit).toThrow(/حركات عهدة الفاتورة/); expect(S()).toBe(before)
 useRawDataStore.setState({ custodyTxs: txs }); S().settleCustodyFile({ fileId, returnedMinor: 700, treasury: '1101' })
 before = S(); expect(edit).toThrow(/مغلق/); expect(S()).toBe(before)
})
it('شراء من العهدة يرفض خلط السداد الموزع أو تاريخاً سابقاً قبل أي أثر', () => {
 const purchase = { supplierId: 0, date: '2026-11-15', lines: [{ itemId, qty: 1, unitPriceMinor: 500 }], expenses: [], paidMinor: 500, custodyFileId: fileId, projectId: null, notes: '' }
 let before = S(); expect(() => S().postPurchase({ ...purchase, paymentAllocations: [{ accountCode: '1101', amountMinor: 500 }] })).toThrow(/توزيع وسائل/); expect(S()).toBe(before)
 before = S(); expect(() => S().postPurchase({ ...purchase, date: '2026-11-14' })).toThrow(/تاريخ حركة العهدة/); expect(S()).toBe(before)
 const invoice = S().postPurchase(purchase)
 expect(S().custodyTxs.find(tx => tx.purchaseId === invoice.id)?.amountMinor).toBe(500)
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 500, treasury: '1101' })).not.toThrow()
})
it('المصروف اللاحق من العهدة يرفض التاريخ السابق لفتحها قبل كتابة القيد', () => {
 const invoice = S().postPurchase({ supplierId: 0, date: '2026-11-15', lines: [{ itemId, qty: 1, unitPriceMinor: 500 }], expenses: [], paidMinor: 500, treasury: '1101', projectId: null, notes: '' })
 const args = { purchaseId: invoice.id, nameAr: 'نقل', amountMinor: 100, method: 'value' as const, paidBy: 'custody' as const, custodyFileId: fileId, date: '2026-11-14' }
 const before = S(); expect(() => S().addLatePurchaseExpense(args)).toThrow(/تاريخ حركة العهدة/); expect(S()).toBe(before)
 S().addLatePurchaseExpense({ ...args, date: '2026-11-15' })
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 900, treasury: '1101' })).not.toThrow()
})
it('مشروع من العهدة يرفض التاريخ السابق، ويقبل الصحيح ويطابق قيد العهدة', () => {
 const project = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: null, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 const args = { projectId: project.id, kind: 'other' as const, amountMinor: 100, payment: 'cash' as const, description: 'تكلفة', custodyFileId: fileId }
 const before = S(); expect(() => S().addProjectCost({ ...args, date: '2026-11-14' })).toThrow(/تاريخ حركة العهدة/); expect(S()).toBe(before)
 S().addProjectCost({ ...args, date: '2026-11-15' })
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 900, treasury: '1101' })).not.toThrow()
})
it('نقلة ومصروف لاحق من العهدة يطابقان القيد، لكن تعديلها وعكسها محجوبان دون أثر', () => {
 const input = { fromLoc: 'أ', toLoc: 'ب', qty: 1, unitPriceMinor: 500, vatPercent: 0, payment: 'cash' as const, containerNumbers: [], expenses: [{ nameAr: 'طريق', qty: 1, unitAmountMinor: 200, source: 'custody' as const }] }
 const args = { customerId: null, vehicleId: null, driverId: null, input, notes: '', custodyFileId: fileId }
 const trip = S().postTrip(args)
 const expense = S().addTripExpense({ tripId: trip.id, nameAr: 'وقود', unitAmountMinor: 100, bearer: 'company', paymentSource: 'custody', custodyFileId: fileId })
 let before = S(); expect(() => S().updateTrip({ ...args, tripId: trip.id })).toThrow(/غير مدعوم/); expect(S()).toBe(before)
 before = S(); expect(() => S().reverseTripExpense(expense.id)).toThrow(/غير مدعوم/); expect(S()).toBe(before)
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 700, treasury: '1101' })).not.toThrow()
 before = S(); expect(() => S().reverseTripExpense(expense.id)).toThrow(/غير مدعوم/); expect(S()).toBe(before)
})
it('المسير المدفوع من عهدة لا يعتمد قيد تمويل مفقود، ويطابق القيد عند سلامته', () => {
 const args = { month: '2026-11', payMode: 'cash' as const, treasury: '1101', notes: '', custodyFileId: fileId, lines: [{ employeeId: 1, baseMinor: 500, allowancesMinor: 0, overtimeMinor: 0, deductionsMinor: 0, advancesMinor: 0 }] }
 const journal = S().journal; useRawDataStore.setState({ journal: [] })
 const before = S(); expect(() => S().postPayroll(args)).toThrow(/قيد العهدة/); expect(S()).toBe(before)
 useRawDataStore.setState({ journal }); S().postPayroll(args)
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 500, treasury: '1101' })).not.toThrow()
})
it('فاتورة شراء تجمع ثمن البضاعة ومصاريف العهدة وتشمل الضريبة قبل فحص الرصيد', () => {
 const purchase = { supplierId: 0, date: '2026-11-15', lines: [{ itemId, qty: 1, unitPriceMinor: 500 }], expenses: [{ nameAr: 'شحن', amountMinor: 500, method: 'value' as const, paidBy: 'custody' as const, custodyFileId: fileId, costTreatment: 'inventory' as const, taxTreatment: 'exclusive' as const, taxPercent: 10 }], paidMinor: 500, custodyFileId: fileId, projectId: null, notes: '', purchaseExpenseTaxRecoverable: true }
 const before = S(); expect(() => S().postPurchase(purchase)).toThrow(/أكبر من متبقي/); expect(S()).toBe(before)
 const inv = S().postPurchase({ ...purchase, expenses: [{ ...purchase.expenses[0], amountMinor: 400 }] })
 expect(S().custodyTxs.filter(t => t.journalEntryId === inv.journalEntryId).map(t => t.amountMinor)).toEqual([500, 440])
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 60, treasury: '1101' })).not.toThrow()
})
it('كل ملف عهدة في البيع متعدد الملفات يفحص مجموع مصروفاته مستقلاً', () => {
 const second = S().openCustodyFile({ employeeId: 1, projectId: null, reason: 'ملف ثان', notes: '' })
 S().fundCustodyFile({ fileId: second.id, amountMinor: 300, treasury: '1101', description: '' })
 const before = S(); expect(() => post([exp('a', fileId, 800), exp('b', second.id, 200), exp('c', second.id, 200)])).toThrow(/متبقي العهدة/); expect(S()).toBe(before)
 post([exp('a', fileId, 800), exp('b', second.id, 300)])
 expect([S().getCustodySummary(fileId).remainingMinor, S().getCustodySummary(second.id).remainingMinor]).toEqual([200, 0])
 expect(() => S().settleCustodyFile({ fileId, returnedMinor: 200, treasury: '1101' })).not.toThrow()
 expect(() => S().settleCustodyFile({ fileId: second.id, returnedMinor: 0, treasury: '1101' })).not.toThrow()
})
it('الشراء والبيع والمشروع لا تستهلك رصيداً غير مدعوم بقيد تمويل', () => {
 const project = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: null, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 useRawDataStore.setState({ journal: [] })
 const actions = [() => post([exp('a', fileId, 100)]), () => S().postPurchase({ supplierId: 0, date: '2026-11-15', lines: [{ itemId, qty: 1, unitPriceMinor: 100 }], expenses: [], paidMinor: 100, custodyFileId: fileId, notes: '' }), () => S().addProjectCost({ projectId: project.id, amountMinor: 100, payment: 'cash', custodyFileId: fileId })]
 for (const action of actions) { const before = S(); expect(action).toThrow(/قيد العهدة/); expect(S()).toBe(before) }
})
it('مستند مؤرخ بعد فتح الملف وقبل حركة عهدة أحدث مرفوض', () => {
 vi.setSystemTime(new Date(2026, 10, 16, 12))
 S().fundCustodyFile({ fileId, amountMinor: 100, treasury: '1101', description: 'تعزيز لاحق' })
 const before = S(); expect(() => post([exp('a', fileId, 100)], '2026-11-15')).toThrow(/حركة أحدث/); expect(S()).toBe(before)
})
it('المستندات المشتركة لا تستعمل ملف عهدة تابعاً لفرع آخر', () => {
 const branches = [{ id: 1, nameAr: 'رئيسي', isMain: true, active: true, warehouseId: 1, treasuryCode: '1101' }, { id: 2, nameAr: 'آخر', isMain: false, active: true, warehouseId: 2, treasuryCode: '1121' }]
 useRawDataStore.setState({ branches: branches as never, activeBranchId: 1, custodyFiles: S().custodyFiles.map(row => ({ ...row, branchId: 2 })), employees: S().employees.map(row => ({ ...row, branchId: 1 })), items: S().items.map(row => ({ ...row, branchId: 1 })) } as never)
 const before = S(); expect(() => post([exp('a', fileId, 100)])).toThrow(/الفرع/); expect(S()).toBe(before)
})
it('المشروع والشراء والبيع من العهدة لا يرحلون في فترة مقفلة', () => {
 const project = S().addProject({ nameAr: 'مشروع', clientName: 'عميل', clientId: null, contractValueMinor: 10000, retentionPercent: 0, startDate: '2026-01-01', notes: '' })
 useAppStore.setState({ fiscalYears: [{ id: 1, nameAr: 'مقفلة', startDate: '2026-01-01', endDate: '2026-12-31', status: 'closed' }] })
 const actions = [() => post([exp('a', fileId, 100)]), () => S().postPurchase({ supplierId: 0, date: '2026-11-15', lines: [{ itemId, qty: 1, unitPriceMinor: 100 }], expenses: [], paidMinor: 100, custodyFileId: fileId, notes: '' }), () => S().addProjectCost({ projectId: project.id, amountMinor: 100, payment: 'cash', custodyFileId: fileId })]
 for (const action of actions) { const before = S(); expect(action).toThrow(/مقفل/); expect(S()).toBe(before) }
})
