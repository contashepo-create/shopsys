import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'

const original = useDataStore.getState()
const customer = { id: 701, nameAr: 'عميل توزيع', phone: '', creditLimitMinor: 0, notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }
const supplier = { id: 702, nameAr: 'مورد توزيع', phone: '', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' }

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { setup: { allowNegativeTreasury: true } } }))
  useDataStore.setState({
    ...original,
    customers: [customer] as never,
    suppliers: [supplier] as never,
    sales: [
      { id: 1, invoiceNumber: 'SAL-0001', date: '2026-09-20', customerId: customer.id, payment: 'credit', paidMinor: 0, totals: { totalMinor: 1_000 } },
      { id: 2, invoiceNumber: 'SAL-0002', date: '2026-09-21', customerId: customer.id, payment: 'credit', paidMinor: 0, totals: { totalMinor: 800 } },
    ] as never,
    purchases: [
      { id: 11, invoiceNumber: 'PUR-0011', date: '2026-09-20', supplierId: supplier.id, grandTotalMinor: 1_200, supplierDueMinor: 1_200, paidMinor: 0 },
      { id: 12, invoiceNumber: 'PUR-0012', date: '2026-09-21', supplierId: supplier.id, grandTotalMinor: 900, supplierDueMinor: 900, paidMinor: 0 },
    ] as never,
    saleReturns: [],
    purchaseReturns: [],
    projectExtracts: [],
    projects: [],
    vouchers: [],
    clientSettlements: [],
    journal: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 5_000, isDefault: true }] as never,
  })
})

describe('توزيع سندات القبض والصرف على فواتير الأطراف', () => {
  it('يوزع قبض العميل FIFO على أكثر من فاتورة ويترك الفائض تحت الحساب', () => {
    const voucher = useDataStore.getState().postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 2_000,
      description: 'تحصيل متعدد الفواتير', partyKind: 'customer', partyId: customer.id,
    })
    expect(voucher.allocations).toEqual([
      { docKey: 'sale:1', docLabel: 'فاتورة SAL-0001', appliedMinor: 1_000 },
      { docKey: 'sale:2', docLabel: 'فاتورة SAL-0002', appliedMinor: 800 },
    ])
    expect(voucher.unallocatedMinor).toBe(200)
    expect(useDataStore.getState().getOpenClientInvoices(customer.id)).toEqual([])
  })

  it('يقبل توزيعاً يدوياً جزئياً ويرفض تجاوز متبقي الفاتورة', () => {
    const store = useDataStore.getState()
    const voucher = store.postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 500,
      description: 'مطابقة جزئية', partyKind: 'customer', partyId: customer.id,
      allocations: [{ docKey: 'sale:2', docLabel: 'تجاهل من الواجهة', appliedMinor: 500 }],
    })
    expect(voucher.allocations).toEqual([{ docKey: 'sale:2', docLabel: 'فاتورة SAL-0002', appliedMinor: 500 }])
    expect(useDataStore.getState().getOpenClientInvoices(customer.id)[0]).toMatchObject({ docKey: 'sale:1', settledMinor: 0 })
    expect(() => useDataStore.getState().postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 400,
      description: 'تجاوز', partyKind: 'customer', partyId: customer.id,
      allocations: [{ docKey: 'sale:2', docLabel: 'غير موثوق', appliedMinor: 400 }],
    })).toThrow(/أكبر من المتبقي/)
  })

  it('يبني قائمة فواتير المورد ويطابق سداداً جزئياً على فاتورته', () => {
    const store = useDataStore.getState()
    expect(store.getOpenSupplierInvoices(supplier.id)).toHaveLength(2)
    const voucher = store.postVoucher({
      kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 1_500,
      description: 'سداد مورد على فاتورتين', partyKind: 'supplier', partyId: supplier.id,
    })
    expect(voucher.allocations).toEqual([
      { docKey: 'purchase:11', docLabel: 'فاتورة شراء PUR-0011', appliedMinor: 1_200 },
      { docKey: 'purchase:12', docLabel: 'فاتورة شراء PUR-0012', appliedMinor: 300 },
    ])
    expect(useDataStore.getState().getOpenSupplierInvoices(supplier.id)[0]).toMatchObject({ docKey: 'purchase:12', settledMinor: 300 })
  })

  it('يعكس السند من مساره ويعيد الفاتورة إلى قائمة المفتوح', () => {
    const store = useDataStore.getState()
    const voucher = store.postVoucher({
      kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 500,
      description: 'سند سيُعكس', partyKind: 'customer', partyId: customer.id,
      allocations: [{ docKey: 'sale:1', docLabel: 'فاتورة SAL-0001', appliedMinor: 500 }],
    })
    const reversed = useDataStore.getState().reverseVoucher(voucher.id, 'إدخال على العميل الخطأ')
    expect(reversed.reversalEntryId).toBeTypeOf('number')
    expect(useDataStore.getState().getOpenClientInvoices(customer.id)[0]).toMatchObject({ docKey: 'sale:1', settledMinor: 0 })
    expect(() => useDataStore.getState().reverseVoucher(voucher.id, 'محاولة ثانية')).toThrow(/معكوس بالفعل/)
  })

  it('يمنع قيد العملاء أو الموردين بلا طرف مسجل', () => {
    expect(() => useDataStore.getState().postVoucher({ kind: 'receipt', treasury: '1101', counterAccountCode: '1104', amountMinor: 100, description: 'بدون عميل' })).toThrow(/يتطلب اختيار عميل/)
    expect(() => useDataStore.getState().postVoucher({ kind: 'payment', treasury: '1101', counterAccountCode: '2101', amountMinor: 100, description: 'بدون مورد' })).toThrow(/يتطلب اختيار مورد/)
  })
})
