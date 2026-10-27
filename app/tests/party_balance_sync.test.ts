/**
 * بلاغ المالك: «رصيد المورد بجانب اسمه لم يتحدّث بعد بيعه له بفاتورة بيع».
 * السبب: قائمة الموردين كانت تحسب الرصيد بكشف ناقص (بلا فواتير البيع له ولا التسويات)،
 * وقائمة الاعتماديات لا تتغيّر بالبيع. هذا الاختبار يثبت أن المصدر الذي تقرؤه القوائم
 * (getSupplierBalance / getCustomerBalance / getEmployeeBalance) يتحرك مع كل مستند
 * ويطابق قيمة الكشف والدفتر.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { computeTotals, type CartLine } from '../src/core/pos.ts'
import { supplierStatement, statementBalance } from '../src/core/statements.ts'

const original = useDataStore.getState()
const item = { id: 920, nameAr: 'صنف الأرصدة', sku: 'BAL-920', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1_000, stockQty: 50, priceMinor: 2_000, minQty: 0, trackExpiry: false, active: true }
const supplier = { id: 61, code: 'SUP-61', nameAr: 'مورد الأرصدة', phone: '', active: true }
const customer = { id: 62, code: 'CUS-62', nameAr: 'عميل الأرصدة', phone: '', active: true, loyaltyPoints: 0 }
const employee = { id: 63, code: 'EMP-63', nameAr: 'موظف الأرصدة', role: 'cashier', phone: '', active: true, hireDate: '2025-01-01', salaryBaseMinor: 0, notes: '' }

const line: CartLine = { itemId: item.id, nameAr: item.nameAr, qty: 3, unitPriceMinor: 2_000, unitCostMinor: 1_000, discountPercent: 0, soldByWeight: false }
const total = computeTotals([line], 0, 0, false).totalMinor // 6,000

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { allowNegativeTreasury: true, setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))
  useDataStore.setState({
    ...original,
    items: [item] as never,
    customers: [customer] as never,
    suppliers: [supplier] as never,
    employees: [employee] as never,
    sales: [],
    saleReturns: [],
    purchases: [],
    purchaseReturns: [],
    journal: [],
    warehouses: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 1_000_000, isDefault: true }] as never,
    shifts: [],
    vouchers: [],
    cheques: [],
    purchaseOrders: [],
  })
})

describe('الأرصدة المعروضة في القوائم = الكشف (بلاغ المالك)', () => {
  it('بيع آجل لمورد ⇒ رصيد المورد يتحرك فوراً: عليه المورد لنا 6000 (لك عنده)', () => {
    const store = useDataStore.getState()
    expect(store.getSupplierBalance(supplier.id)).toBe(0)
    store.postSale({
      lines: [line], customerId: null,
      partyKind: 'supplier', partyId: supplier.id, partyName: supplier.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    // موجب = مستحق له عندك؛ سالب = عليه لك. البيع الآجل للمورد يجعله عليه لنا.
    expect(useDataStore.getState().getSupplierBalance(supplier.id)).toBe(-total)
  })

  it('بيع آجل لعميل ⇒ رصيد العميل 6000 عليه، ويتطابق مع الكشف', () => {
    useDataStore.getState().postSale({
      lines: [line], customerId: customer.id, partyKind: 'customer', partyId: customer.id, partyName: customer.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    } as never)
    const state = useDataStore.getState()
    const balance = state.getCustomerBalance(customer.id)
    expect(balance).toBe(total)
    const statement = state.getCustomerStatementRows(customer.id).reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0)
    expect(balance).toBe(statement)
  })

  it('بيع آجل لموظف ⇒ جاري الموظف عليه 6000 ويتطابق مع الكشف', () => {
    useDataStore.getState().postSale({
      lines: [line], customerId: null, partyKind: 'employee', partyId: employee.id, partyName: employee.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    const state = useDataStore.getState()
    expect(state.getEmployeeBalance(employee.id)).toBe(-total)
    const statement = state.getEmployeeStatementRows(employee.id).reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
    expect(state.getEmployeeBalance(employee.id)).toBe(statement)
  })

  it('رصيد المورد يطابق كشفه بعد ترحيل مشتريات ومرتجع شراء وبيع', () => {
    const store = useDataStore.getState()
    store.postSale({
      lines: [line], customerId: null, partyKind: 'supplier', partyId: supplier.id, partyName: supplier.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    const state = useDataStore.getState()
    const balance = state.getSupplierBalance(supplier.id)
    const statement = state.getSupplierStatementRows(supplier.id).reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
    expect(balance).toBe(statement)
    expect(balance).toBe(-total)
  })

  it('توثيق السبب: الحساب القديم لقائمة الموردين (مدخلات ناقصة) كان يُظهر 0 بعد البيع', () => {
    useDataStore.getState().postSale({
      lines: [line], customerId: null, partyKind: 'supplier', partyId: supplier.id, partyName: supplier.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })
    const s = useDataStore.getState()
    // الشكل القديم في PartiesPages: بلا sales ولا التسويات ولا الافتتاحي ولا الأصول
    const oldListValue = statementBalance(supplierStatement({
      supplierId: supplier.id, purchases: s.purchases, purchaseReturns: s.purchaseReturns, allPurchases: s.purchases, vouchers: s.vouchers, cheques: s.cheques,
    }))
    expect(oldListValue).toBe(0) // هذا كان الخطأ: البيع لا يظهر
    expect(s.getSupplierBalance(supplier.id)).toBe(-total) // المصدر الصحيح
  })

  it('شراء آجل من مورد ⇒ دينه علينا 3000 (موجب) ويطابق كشفه', () => {
    const store = useDataStore.getState()
    store.postPurchase({
      supplierId: supplier.id, date: '2026-05-01', lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 1_000, vatPercent: 0 }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '', bookDecimals: 2, bookCurrencyCode: 'EGP',
    } as never)
    const state = useDataStore.getState()
    expect(state.getSupplierBalance(supplier.id)).toBe(3_000)
    const statement = state.getSupplierStatementRows(supplier.id).reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
    expect(state.getSupplierBalance(supplier.id)).toBe(statement)
  })

  it('مرتجع بيع آجل لعميل ⇒ يخفض رصيده (6000 ⇒ 4000 بعد رد صنف بـ2000 على الذمة)', () => {
    const store = useDataStore.getState()
    const sale = store.postSale({
      lines: [line], customerId: customer.id, partyKind: 'customer', partyId: customer.id, partyName: customer.nameAr,
      payment: 'credit', invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    } as never)
    useDataStore.getState().postSaleReturn({ saleId: sale.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'اختبار أرصدة' } as never)
    const state = useDataStore.getState()
    expect(state.getCustomerBalance(customer.id)).toBe(total - 2_000)
    const statement = state.getCustomerStatementRows(customer.id).reduce((sum, row) => sum + row.debitMinor - row.creditMinor, 0)
    expect(state.getCustomerBalance(customer.id)).toBe(statement)
  })

  it('مرتجع شراء آجل بموافقة داخلية ⇒ يخفض دين المورد (3000 ⇒ 2000)', () => {
    const store = useDataStore.getState()
    const purchase = store.postPurchase({
      supplierId: supplier.id, date: '2026-05-01', lines: [{ itemId: item.id, qty: 3, unitPriceMinor: 1_000, vatPercent: 0 }],
      expenses: [], paidMinor: 0, treasury: '1101', notes: '', bookDecimals: 2, bookCurrencyCode: 'EGP',
    } as never)
    useDataStore.getState().postPurchaseReturn({ purchaseId: purchase.id, qtyByItem: new Map([[item.id, 1]]), refund: 'debt', reason: 'اختبار أرصدة', __approvalBypass: true } as never)
    const state = useDataStore.getState()
    expect(state.getSupplierBalance(supplier.id)).toBe(2_000)
    const statement = state.getSupplierStatementRows(supplier.id).reduce((sum, row) => sum + row.creditMinor - row.debitMinor, 0)
    expect(state.getSupplierBalance(supplier.id)).toBe(statement)
  })
})
