import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const item = { id: 901, nameAr: 'صنف اختبار', sku: 'TAX-901', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 0, stockQty: 0, priceMinor: 20000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false }
function seed() {
  useDataStore.setState({ ...original, items: [item] as never, suppliers: [{ id: 801, nameAr: 'مورد اختبار', phone: '', notes: '', openingBalanceMinor: 0 }] as never, purchases: [], batches: [], journal: [], warehouses: [{ id: 1, nameAr: 'الرئيسي', code: 'MAIN', isMain: true }] as never, treasuries: [{ code: '1101', nameAr: 'الخزينة', kind: 'cash', openingBalanceMinor: 1000000, isDefault: true }] as never })
}
beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  seed()
  if (useDataStore.getState().custodyFiles) useDataStore.setState({
    custodyFiles: [{ id: 1, fileNumber: 'C-1', employeeId: 1, projectId: null, reason: 'اختبار', notes: '', openedAt: '2026-09-01', status: 'open', settledAt: null, returnedMinor: 0, shortageMinor: 0, settleTreasury: null }] as never,
    custodyTxs: [{ id: 1, fileId: 1, type: 'fund', date: '2026-09-01', amountMinor: 5000, excessMinor: 0, description: 'تمويل', treasury: '1101', projectId: null, purchaseId: null, journalEntryId: null }] as never,
  })
})

const post = (recoverable: boolean) => useDataStore.getState().postPurchase({ supplierId: 801, date: '2026-09-24', lines: [{ itemId: 901, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }], expenses: [{ nameAr: 'شحن', amountMinor: 10000, method: 'value', paidBy: 'supplier', costTreatment: 'inventory', taxTreatment: 'exclusive', taxPercent: 14 }], paidMinor: 0, treasury: '1101', warehouseId: 1, inputVatMinor: 0, purchaseExpenseTaxRecoverable: recoverable, notes: '' })

const postDirectExpense = (paidBy: 'treasury' | 'payable' | 'custody') => useDataStore.getState().postPurchase({
  supplierId: 801, date: '2026-09-24',
  lines: [{ itemId: 901, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }],
  expenses: [{ nameAr: 'شحن', amountMinor: 1000, method: 'value', paidBy, costTreatment: 'inventory', taxTreatment: 'exclusive', taxPercent: 14, payAccount: '1101', beneficiaryName: paidBy === 'payable' ? 'شركة الشحن' : undefined, payableAccountCode: '2117', custodyFileId: paidBy === 'custody' ? 1 : undefined }],
  // مصروف الشحن يُدفع مباشرة؛ المدفوع هنا يخص المورد وحده.
  paidMinor: 10000, treasury: '1101', warehouseId: 1, inputVatMinor: 0, purchaseExpenseTaxRecoverable: true, notes: '',
})

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

  it.each(['treasury', 'payable', 'custody'] as const)('يبني قيداً متوازناً عندما يدفع مصدر %s مصروف الشحن', (paidBy) => {
    const purchase = postDirectExpense(paidBy)
    const state = useDataStore.getState()
    const entry = state.journal.find(row => row.id === purchase.journalEntryId)!
    expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0)
    expect(purchase.grandTotalMinor).toBe(11000)
    expect(purchase.supplierDueMinor).toBe(10000)
    expect(entry.lines.find(line => line.accountCode === '1103')?.debit).toBe(11000)
    expect(entry.lines.find(line => line.accountCode === '2102')?.debit).toBe(140)
    const directAccount = paidBy === 'treasury' ? '1101' : paidBy === 'payable' ? '2117' : '1108'
    expect(entry.lines.filter(line => line.accountCode === directAccount).reduce((sum, line) => sum + line.credit, 0)).toBe(paidBy === 'treasury' ? 11140 : 1140)
  })

  it('لا يكرر ضريبة مصروف الفترة: تظهر مرة في قيد المصروف ومرة واحدة في المدين', () => {
    const purchase = useDataStore.getState().postPurchase({
      supplierId: 801, date: '2026-09-24',
      lines: [{ itemId: 901, qty: 1, unitPriceMinor: 10000, warehouseId: 1 }],
      expenses: [{ nameAr: 'نقل داخلي', amountMinor: 1000, method: 'value', paidBy: 'treasury', costTreatment: 'period', taxTreatment: 'exclusive', taxPercent: 14, payAccount: '1101' }],
      paidMinor: 10000, treasury: '1101', warehouseId: 1, inputVatMinor: 0, purchaseExpenseTaxRecoverable: true, notes: '',
    })
    const entry = useDataStore.getState().journal.find(row => row.id === purchase.journalEntryId)!
    expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0)
    expect(entry.lines.filter(line => line.accountCode === '2102').reduce((sum, line) => sum + line.debit, 0)).toBe(140)
    expect(entry.lines.find(line => line.accountCode === '5108')?.debit).toBe(1000)
    expect(purchase.supplierDueMinor).toBe(10000)
  })
})
