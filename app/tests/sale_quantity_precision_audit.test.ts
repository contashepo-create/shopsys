import { beforeEach, expect, it } from 'vitest'
import { useDataStore, useRawDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'

const initial = useRawDataStore.getState(), app = useAppStore.getState()
beforeEach(() => {
 useAppStore.getState().setActiveBranchContext(null)
 useAppStore.setState({ setup: { ...app.setup, countryCode: 'EG', allowNegativeTreasury: true } })
 useRawDataStore.setState({ ...initial, branches: [], activeBranchId: null, items: [{ id: 1, nameAr: 'وزني', sku: 'X', barcodes: [], categoryId: 1, baseUnit: 'كجم', extraUnits: [], costMinor: 100, stockValueMinor: 100, stockQty: 1, priceMinor: 1000000, minQty: 0, isActive: true }] as never, warehouses: [], transfers: [], sales: [], saleReturns: [], journal: [], insuranceClaims: [], insuranceProviders: [], batches: [] })
})
const line = (qty: number, unitFactor = 1) => ({ itemId: 1, nameAr: 'وزني', qty, unitFactor, unitPriceMinor: 1000000, unitCostMinor: 100, discountPercent: 0, soldByWeight: true })
const saleArgs = (qty: number, unitFactor = 1) => ({ lines: [line(qty, unitFactor)], customerId: null, payment: 'cash' as const, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false })
it('يرفض بيع كمية غير قابلة لإثبات المخزون بدلاً من قبض ثمن دون إخراجها', () => {
 const s = useDataStore.getState(), before = useRawDataStore.getState()
 expect(() => s.postSale(saleArgs(0.0004))).toThrow(/كمية/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().items[0].stockQty).toBe(1)
})
it('يرفض كمية دقيقة في وحدة البيع ولكن ناتجها بالوحدة الأساسية غير قابل للتمثيل', () => {
 const s = useDataStore.getState()
 expect(() => s.postSale(saleArgs(0.001, 0.5))).toThrow(/كمية/)
 expect(useRawDataStore.getState().sales).toHaveLength(0)
})
it('يقبل ضجيج العمليات الثنائية مع كمية فعلية حتى ثلاثة أجزاء عشرية', () => {
 const s = useDataStore.getState()
 const sale = s.postSale(saleArgs(0.1 + 0.2))
 expect(sale.lines[0].qty).toBe(0.3)
 expect(useRawDataStore.getState().items[0].stockQty).toBeCloseTo(0.7)
})
it('يرفض الكمية غير الممثلة في البيع المؤمن قبل حركة المخزون والقيد', () => {
 const s = useDataStore.getState(), insurer = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 }), before = useRawDataStore.getState()
 expect(() => s.postInsuredSale({ lines: [line(0.0014)], providerId: insurer.id, taxPercent: 0, taxInclusive: false })).toThrow(/كمية/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().insuranceClaims).toBe(before.insuranceClaims)
})
it('يرفض كمية رد أدق من ثلاث خانات بدلاً من تغييرها بصمت', () => {
 const s = useDataStore.getState(), sale = s.postSale(saleArgs(1)), before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[1, 0.0014]]), refund: 'cash', reason: 'رد' })).toThrow(/كمية/)
 expect(useRawDataStore.getState().saleReturns).toBe(before.saleReturns)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('يرفض تعديل الفاتورة إلى كمية غير ممثلة قبل عكس القيد', () => {
 const s = useDataStore.getState(), sale = s.postSale(saleArgs(1)), before = useRawDataStore.getState()
 expect(() => s.editSale({ saleId: sale.id, lines: [line(0.0004)], customerId: null, payment: 'cash', paidMinor: 400, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })).toThrow(/كمية/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 expect(useRawDataStore.getState().sales).toBe(before.sales)
})

it('يسمح بالكمية المثبتة في البيع المؤمن ويخصمها كما حُسبت', () => {
 const s = useDataStore.getState(), insurer = s.addInsuranceProvider({ nameAr: 'تأمين', coveragePercent: 70 })
 s.postInsuredSale({ lines: [line(0.1 + 0.2)], providerId: insurer.id, taxPercent: 0, taxInclusive: false })
 expect(useRawDataStore.getState().insuranceClaims[0].saleLines?.[0].qty).toBe(0.3)
 expect(useRawDataStore.getState().items[0].stockQty).toBe(0.7)
})
it('يفحص مواصفات السطور والناتج بالوحدة الأساسية قبل رد كسر لا يتسع له المخزون', () => {
 const s = useDataStore.getState(), sale = s.postSale(saleArgs(2, 0.5)), before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 0.0014, condition: 'resellable' }], refund: 'cash', reason: 'رد' })).toThrow(/كمية/)
 expect(() => s.postSaleReturn({ saleId: sale.id, lineSpecs: [{ lineIndex: 0, qty: 0.001, condition: 'resellable' }], refund: 'cash', reason: 'رد' })).toThrow(/كمية/)
 expect(useRawDataStore.getState().saleReturns).toBe(before.saleReturns)
 expect(useRawDataStore.getState().items).toBe(before.items)
})
it('يمكن تعديل كمية ممثلة مع بقاء المخزون منضبطاً', () => {
 const s = useDataStore.getState(), sale = s.postSale(saleArgs(0.3))
 const edited = s.editSale({ saleId: sale.id, lines: [line(0.1 + 0.1)], customerId: null, payment: 'cash', paidMinor: 200000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })
 expect(edited.lines[0].qty).toBe(0.2)
 expect(useRawDataStore.getState().items[0].stockQty).toBeCloseTo(0.8)
})
it('يمكن زيادة كمية خدمة عند تعديل فاتورتها دون اشتراط أو اختلاق مخزون للخدمة', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const serviceLine = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const sale = s.postSale({ ...saleArgs(1), lines: [serviceLine] })
 const before = useRawDataStore.getState().items.find(item => item.id === itemId)?.stockQty
 const edited = s.editSale({ saleId: sale.id, lines: [{ ...serviceLine, qty: 2 }], customerId: null, payment: 'cash', paidMinor: 2000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })
 expect(edited.totals.totalMinor).toBe(2000)
 expect(useRawDataStore.getState().items.find(item => item.id === itemId)?.stockQty).toBe(before)
})
it('لا يضيف مرتجع الخدمة كمية إلى المخزون ولا تكلفة بضاعة', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const serviceLine = { itemId, nameAr: 'خدمة', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const sale = s.postSale({ ...saleArgs(1), lines: [serviceLine] })
 const before = useRawDataStore.getState().items.find(item => item.id === itemId)?.stockQty
 const ret = s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })
 expect(ret.totals.cogsMinor).toBe(0)
 expect(useRawDataStore.getState().items.find(item => item.id === itemId)?.stockQty).toBe(before)
})
it('يتحقق من ختم نوع الخدمة قبل تعديل البيع أو ردّه، ولا يخمن الخدمة في السجل القديم', () => {
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const service = { itemId, nameAr: 'خدمة', qty: 1, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const sale = s.postSale({ ...saleArgs(1), lines: [service] })
 const snapshot = useRawDataStore.getState()
 expect(sale.lines[0].isServiceAtSale).toBe(true)
 expect(snapshot.journal.find(e => e.id === sale.journalEntryId)?.saleLineKinds).toEqual([{ itemId, service: true }])
 useRawDataStore.setState({ sales: snapshot.sales.map(row => row.id === sale.id ? { ...row, lines: row.lines.map(l => ({ ...l, isServiceAtSale: false })) } : row) })
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })).toThrow(/مراجعة/)
 useRawDataStore.setState({ sales: snapshot.sales.map(row => row.id === sale.id ? { ...row, saleLineKindVersion: undefined, lines: row.lines.map(l => ({ ...l, isServiceAtSale: undefined })) } : row), journal: snapshot.journal.map(entry => entry.id === sale.journalEntryId ? { ...entry, saleLineKinds: undefined } : entry) })
 const before = useRawDataStore.getState()
 expect(() => s.postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد' })).toThrow(/غير مثبت/)
 expect(() => s.editSale({ saleId: sale.id, lines: [service], customerId: null, payment: 'cash', paidMinor: 1000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false })).toThrow(/غير مثبت/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
})
it('لا يرحل فاتورة أو تعديلاً لصنف غير موجود حتى لو كان المخزون السالب مسموحاً', () => {
 const s = useDataStore.getState(), missing = { ...line(1), itemId: 999 }, before = useRawDataStore.getState()
 expect(() => s.postSale({ ...saleArgs(1), lines: [missing], allowNegativeStock: true })).toThrow(/صنف/)
 expect(useRawDataStore.getState().journal).toBe(before.journal)
 const sale = s.postSale(saleArgs(0.5)), after = useRawDataStore.getState()
 expect(() => s.editSale({ saleId: sale.id, lines: [missing], customerId: null, payment: 'cash', paidMinor: 1000000, treasury: '1101', invoiceDiscountPercent: 0, reason: 'تصحيح', einvoiceActive: false, allowNegativeStock: true })).toThrow(/صنف/)
 expect(useRawDataStore.getState().journal).toBe(after.journal)
})
it('يظل ختم الخدمة قابلًا للمطابقة بعد إنشاء نسخة احتياطية واستعادتها', async () => {
 const { flushSecureStorageWrites, secureStorage } = await import('../src/data/secureStorage.ts')
 const { buildBackup, parseBackup } = await import('../src/core/backup.ts')
 const s = useDataStore.getState(), itemId = s.ensureServiceItemForFreeLine({ nameAr: 'خدمة' })
 const service = { itemId, nameAr: 'خدمة', qty: 2, unitPriceMinor: 1000, unitCostMinor: 0, discountPercent: 0, soldByWeight: false }
 const sale = s.postSale({ ...saleArgs(1), lines: [service] })
 await flushSecureStorageWrites('shopsys-data')
 const stored = await secureStorage.getItem('shopsys-data')
 const backup = buildBackup({ appState: {}, storeState: JSON.parse(stored!), appDataVersion: 1, shopName: 'اختبار' })
 const restored = parseBackup(JSON.stringify(backup))
 useRawDataStore.setState({ items: [], sales: [], journal: [] })
 await flushSecureStorageWrites('shopsys-data')
 await secureStorage.setItem('shopsys-data', JSON.stringify(restored.data.store))
 await useRawDataStore.persist.rehydrate()
 const state = useRawDataStore.getState()
 expect(state.sales.find(row => row.id === sale.id)?.lines[0].isServiceAtSale).toBe(true)
 expect(state.journal.find(row => row.id === sale.journalEntryId)?.saleLineKinds).toEqual([{ itemId, service: true }])
 useDataStore.getState().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[itemId, 1]]), refund: 'cash', reason: 'رد بعد استعادة' })
 expect(useRawDataStore.getState().items.find(item => item.id === itemId)?.stockQty).toBe(0)
})
