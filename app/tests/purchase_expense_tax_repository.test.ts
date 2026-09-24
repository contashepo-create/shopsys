import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const item = { id: 901, nameAr: 'صنف اختبار', sku: 'TAX-901', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 20000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false }
function seed() {
  useDataStore.setState({ ...original, items: [item] as never, suppliers: [{ id: 801, nameAr: 'مورد اختبار', phone: '', notes: '', openingBalanceMinor: 0 }] as never, purchases: [], batches: [], journal: [], warehouses: [{ id: 1, nameAr: 'الرئيسي', code: 'MAIN', isMain: true }] as never, treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 1000000, isDefault: true }] as never })
}
beforeEach(seed)

const post = (recoverable: boolean) => useDataStore.getState().postPurchase({ supplierId: 801, date: '2026-09-24', lines: [{ itemId: 901, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }], expenses: [{ nameAr: 'شحن', amountMinor: 10000, method: 'value', paidBy: 'supplier', costTreatment: 'inventory', taxTreatment: 'exclusive', taxPercent: 14 }], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, purchaseExpenseTaxRecoverable: recoverable, notes: '' })

describe('ترحيل ضريبة مصروف الشراء في المستودع', () => {
  it('يفصل الضريبة القابلة للاسترداد عن تكلفة المخزون', () => {
    const purchase = post(true)
    const entry = useDataStore.getState().journal.find(row => row.id === purchase.journalEntryId)!
    expect(entry.lines.find(line => line.accountCode === '1103')?.debit).toBe(20000)
    expect(entry.lines.find(line => line.accountCode === '2102')?.debit).toBe(1400)
    expect(entry.lines.find(line => line.accountCode === '2101')?.credit).toBe(21400)
  })
  it('يحمل ضريبة المنشأة المعفاة على تكلفة المخزون', () => {
    const purchase = post(false)
    const entry = useDataStore.getState().journal.find(row => row.id === purchase.journalEntryId)!
    expect(entry.lines.find(line => line.accountCode === '1103')?.debit).toBe(21400)
    expect(entry.lines.some(line => line.accountCode === '2102')).toBe(false)
    expect(entry.lines.find(line => line.accountCode === '2101')?.credit).toBe(21400)
  })
})
