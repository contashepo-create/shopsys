import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const item = { id: 902, nameAr: 'صنف بيع اختبار', sku: 'SALE-902', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1000, stockQty: 10, priceMinor: 2000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false }

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { allowNegativeTreasury: true, setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))
  useDataStore.setState({
    ...original,
    items: [item] as never,
    sales: [],
    journal: [],
    warehouses: [],
    treasuries: [
      { code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 1_000_000, isDefault: true },
      { code: '1102', nameAr: 'البنك', kind: 'bank', openingBalanceMinor: 1_000_000 },
    ] as never,
    shifts: [],
  })
})

const saleWithExpense = (expense: { settlement: 'paid_now' | 'payable_later'; treasury?: string; payableAccountCode?: string; beneficiaryName?: string }) => useDataStore.getState().postSale({
  lines: [{ key: 'line-1', itemId: item.id, nameAr: item.nameAr, qty: 1, unitPriceMinor: 2_000, unitCostMinor: 1_000, discountPercent: 0, soldByWeight: false }],
  customerId: null,
  payment: 'cash',
  invoiceDiscountPercent: 0,
  taxPercent: 0,
  taxInclusive: false,
  treasury: '1101',
  paidMinor: 2_000,
  internalExpenses: [{ id: 'expense-1', label: 'نقل السيارة', amountMinor: 1_000, accountCode: '5108', settlement: expense.settlement, treasury: expense.treasury, payableAccountCode: expense.payableAccountCode, beneficiaryName: expense.beneficiaryName, taxTreatment: 'exempt', taxPercent: 0, affectsProfit: true, landedCostAllocation: 'none' }],
})

describe('ترحيل المصروف الداخلي مع فاتورة البيع', () => {
  it.each([
    ['مدفوع من خزينة مختلفة', { settlement: 'paid_now' as const, treasury: '1102' }],
    ['مستحق لجهة أخرى', { settlement: 'payable_later' as const, payableAccountCode: '2117', beneficiaryName: 'شركة نقل' }],
  ])('ينتج قيداً متوازناً لمصدر %s ولا يستخدم حساب المورد', (_label, source) => {
    const sale = saleWithExpense(source)
    const entry = useDataStore.getState().journal.find((row) => row.id === sale.journalEntryId)!
    expect(entry.lines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0)
    expect(entry.lines.find((line) => line.accountCode === '5108')?.debit).toBe(1_000)
    expect(entry.lines.some((line) => line.accountCode === '2101')).toBe(false)
    expect(entry.lines.find((line) => line.accountCode === (source.settlement === 'paid_now' ? '1102' : '2117'))?.credit).toBe(1_000)
  })
})
