/**
 * تاريخ المستند يُثبَّت **لحظة التقديم** لا لحظة الاعتماد.
 *
 * الحادثة التي يمنعها هذا الاختبار: كاشير يقدّم فاتورة قبل منتصف الليل،
 * يعتمدها المدير في اليوم التالي ⇒ كانت تُقيَّد بتايخ الاعتماد فتذهب
 * الإيراد إلى فترة محاسبية أخرى وتتغيّر تقارير اليومين.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from '../src/data/repo.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { todayLocalIso } from '../src/core/time.ts'
import { computeTotals, type CartLine } from '../src/core/pos.ts'

const original = useDataStore.getState()
const item = { id: 930, nameAr: 'صنف الاعتماد', sku: 'APR-930', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], costMinor: 1_000, stockQty: 50, priceMinor: 2_000, minQty: 0, trackExpiry: false, active: true }
const line: CartLine = { itemId: item.id, nameAr: item.nameAr, qty: 2, unitPriceMinor: 2_000, unitCostMinor: 1_000, discountPercent: 0, soldByWeight: false }
const total = computeTotals([line], 0, 0, false).totalMinor

const cashier = { id: 5, nameAr: 'كاشير الاعتماد', roleId: 'cashier', pinHash: '0'.repeat(64), active: true, branchId: null }

beforeEach(() => {
  localStorage.setItem('shopsys-app', JSON.stringify({ state: { allowNegativeTreasury: true, setup: { requireOpenShiftForSales: false, allowNegativeTreasury: true } } }))
  useAppStore.setState({ approvals: { enabled: true, scope: ['sale'], thresholdMinor: 0, approverUserIds: [], autoApprovedUserIds: [] } })
  useDataStore.setState({
    ...original,
    items: [item] as never,
    customers: [],
    sales: [],
    journal: [],
    docApprovals: [],
    branches: [],
    appUsers: [cashier] as never,
    currentUserId: cashier.id,
    warehouses: [],
    treasuries: [{ code: '1101', nameAr: 'الخزينة الرئيسية', kind: 'cash', openingBalanceMinor: 1_000_000, isDefault: true }] as never,
    shifts: [],
  })
})

describe('اعتماد المستندات: التاريخ والترحيل', () => {
  it('تقديم فاتورة بيع ⇒ تُحفظ كطلب مع تاريخ المستند نفسه ولا تُقيَّد', () => {
    expect(() => useDataStore.getState().postSale({
      lines: [line], customerId: null, payment: 'cash',
      invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })).toThrow(/الاعتماد/)
    const state = useDataStore.getState()
    expect(state.sales).toHaveLength(0)
    expect(state.docApprovals).toHaveLength(1)
    const payload = JSON.parse(state.docApprovals[0].payload) as { documentDate?: string }
    expect(payload.documentDate).toBe(todayLocalIso())
  })

  it('الاعتماد لاحقاً يُرحّل بتاريخ التقديم لا بتاريخ الاعتماد', () => {
    expect(() => useDataStore.getState().postSale({
      lines: [line], customerId: null, payment: 'cash',
      invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
    })).toThrow()
    const request = useDataStore.getState().docApprovals[0]
    // المعتمِد: المالك (null) — لا يعتمد مستنده بنفسه إلا بصلاحية
    useDataStore.setState({ currentUserId: null })
    useDataStore.getState().decideDocApproval(request.id, { status: 'approved', by: null, byName: 'المالك' })
    const sale = useDataStore.getState().sales[0]
    expect(sale).toBeTruthy()
    expect(sale.totals.totalMinor).toBe(total)
    expect(sale.date.slice(0, 10)).toBe(todayLocalIso())
  })
})
