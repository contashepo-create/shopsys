/**
 * §91 — فاتورة البيع لأي طرف (عميل أو مورد أو موظف):
 * الآجل يُسجَّل على حساب الطرف الصحيح (1104 عملاء / 2101 موردون / 1107 جاري الموظفين)،
 * والفواتير تظهر في كشوف حساب أطرافها، والتعديل يرث نوع الطرف، والنقدي الكامل لا ذمة فيه.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { buildSaleEntry, buildSaleEntryWithAllocations, computeTotals, SALE_PARTY_RECEIVABLE, type CartLine } from '../src/core/pos.ts'

const original = useDataStore.getState()
const item = { id: 910, nameAr: 'صنف بيع أي طرف', sku: 'SALE-910', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1_000, stockQty: 50, priceMinor: 2_000, minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true, isService: false }
const supplier = { id: 41, code: 'SUP-41', nameAr: 'مورد الحديد', phone: '', active: true }
const employee = { id: 7, code: 'EMP-7', nameAr: 'عبد الرحمن السائق', role: 'driver', phone: '', active: true, hireDate: '2025-01-01', salaryBaseMinor: 0, notes: '' }

const line: CartLine = { key: 'l1', itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 2_000, unitCostMinor: 1_000, discountPercent: 0, soldByWeight: false }
/** 3 × 2,000 = 6,000 إيراد · إيراد صافٍ 6,000 (بلا ضريبة) · تكلفة 3,000 */
const totals = () => computeTotals([line], 0, 0, false)

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { allowNegativeTreasury: true, setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))
  useDataStore.setState({
    ...original,
    items: [item] as never,
    customers: [],
    suppliers: [supplier] as never,
    employees: [employee] as never,
    sales: [],
    journal: [],
    warehouses: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 1_000_000, isDefault: true }] as never,
    shifts: [],
    vouchers: [],
    cheques: [],
    purchaseOrders: [],
  })
})

describe('§91 النواة — حساب الذمة حسب نوع الطرف', () => {
  it('الافتراضي يبقى 1104 ذمم عملاء (توافق كامل مع كل الفواتير التاريخية)', () => {
    const entry = buildSaleEntry(totals(), 'credit', '1101', 0)
    const receivableLine = entry.find((l) => l.debit > 0 && l.note === 'ذمم عملاء')
    expect(receivableLine?.accountCode).toBe('1104')
    expect(receivableLine?.debit).toBe(6_000)
  })

  it('البيع الآجل لمورد ⇒ 2101، ولموظف ⇒ 1107 — بنفس البنية المتوازنة', () => {
    for (const kind of ['supplier', 'employee'] as const) {
      const { accountCode, noteAr } = SALE_PARTY_RECEIVABLE[kind]
      const entry = buildSaleEntry(totals(), 'credit', '1101', 2_000, { receivableAccount: accountCode, receivableNote: noteAr })
      const debt = entry.find((l) => l.debit > 0 && l.accountCode === accountCode)
      expect(debt?.debit).toBe(4_000)
      expect(entry.find((l) => l.accountCode === '1104')).toBeUndefined()
      expect(noteAr).toContain(kind === 'supplier' ? 'المورد' : 'الموظف')
    }
  })

  it('التحصيل المتعدد (allocations) يحترم حساب الطرف أيضاً', () => {
    const entry = buildSaleEntryWithAllocations(totals(), [
      { accountCode: '1101', amountMinor: 2_500, note: 'نقدية' },
    ], { receivableAccount: '2101', receivableNote: 'بيع آجل — حساب المورد' })
    expect(entry.find((l) => l.accountCode === '2101')?.debit).toBe(3_500)
    expect(entry.find((l) => l.accountCode === '1104')).toBeUndefined()
  })
})

describe('§91 المستودع — postSale لأي طرف', () => {
  it('بيع آجل لمورد: القيد على 2101 والفاتورة تحمل الطرف وتظهر بكشفه', () => {
    const sale = useDataStore.getState().postSale({
      lines: [line], customerId: null,
      partyKind: 'supplier', partyId: supplier.id, partyName: supplier.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    expect(sale.customerId).toBeNull()
    expect(sale.partyKind).toBe('supplier')
    expect(sale.partyId).toBe(supplier.id)
    expect(sale.partyName).toBe(supplier.nameAr)
    const entry = useDataStore.getState().journal.find((e) => e.id === sale.journalEntryId)!
    expect(entry.lines.find((l) => l.accountCode === '2101')?.debit).toBe(6_000)
    expect(entry.lines.find((l) => l.accountCode === '1104')).toBeUndefined()
    // كشف المورد يعرض الفاتورة كمديونية تخفض ديننا له
    const rows = useDataStore.getState().getSupplierStatementRows(supplier.id)
    const saleRow = rows.find((r) => r.docLabel.includes(sale.invoiceNumber))
    expect(saleRow?.debitMinor).toBe(6_000)
  })

  it('بيع آجل لموظف: القيد على 1107 — يُسترد من مسير رواتبه', () => {
    const sale = useDataStore.getState().postSale({
      lines: [line], customerId: null,
      partyKind: 'employee', partyId: employee.id, partyName: employee.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    const entry = useDataStore.getState().journal.find((e) => e.id === sale.journalEntryId)!
    expect(entry.lines.find((l) => l.accountCode === '1107')?.debit).toBe(6_000)
    expect(entry.lines.find((l) => l.accountCode === '1104')).toBeUndefined()
  })

  it('بيع نقدي كامل لمورد: لا ذمة أصلاً — النوع محفوظ للتاريخ فقط', () => {
    const sale = useDataStore.getState().postSale({
      lines: [line], customerId: null,
      partyKind: 'supplier', partyId: supplier.id, partyName: supplier.nameAr,
      payment: 'cash', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
      treasury: '1101',
    })
    const entry = useDataStore.getState().journal.find((e) => e.id === sale.journalEntryId)!
    expect(entry.lines.find((l) => l.accountCode === '2101')).toBeUndefined()
    expect(entry.lines.find((l) => l.accountCode === '1104')).toBeUndefined()
    expect(entry.lines.find((l) => l.accountCode === '1101')?.debit).toBe(6_000)
  })

  it('الآجل لموظف غير موجود يُرفض، والآجل بلا طرف يُرفض', () => {
    expect(() => useDataStore.getState().postSale({
      lines: [line], customerId: null,
      partyKind: 'employee', partyId: 999_999, partyName: 'شبح',
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })).toThrow(/الموظف غير موجود/)
    expect(() => useDataStore.getState().postSale({
      lines: [line], customerId: null,
      partyKind: 'supplier', partyId: null,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })).toThrow(/اختيار الطرف/)
  })

  it('تعديل فاتورة مورد يرث طرفه — لا يتحول لعميل ولا يفقد 2101', () => {
    const sale = useDataStore.getState().postSale({
      lines: [line], customerId: null,
      partyKind: 'supplier', partyId: supplier.id, partyName: supplier.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    const edited = useDataStore.getState().editSale({
      saleId: sale.id,
      lines: [{ ...line, qty: 4 }], // 8,000 بدل 6,000
      customerId: null,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
      paidMinor: 0, treasury: '1101', reason: 'تصحيح كمية',
    })
    expect(edited.partyKind).toBe('supplier')
    expect(edited.partyId).toBe(supplier.id)
    expect(edited.customerId).toBeNull()
    const finalEntry = useDataStore.getState().journal.find((e) => e.id === edited.journalEntryId)!
    expect(finalEntry.lines.find((l) => l.accountCode === '2101')?.debit).toBe(8_000)
  })
})
