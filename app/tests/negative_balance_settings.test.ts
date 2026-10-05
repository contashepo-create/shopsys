/**
 * بلاغ المالك v1.0.4 (سيناريو ميداني): «عندما أردت أن أستخدم الرصيد بالسالب
 * منعني رغم تفعيله — سواء نقود أو مخزن» — هذه الاختبارات تعيد إنتاج السيناريو
 * بالضبط: تفعيل المفتاحين من الإعدادات العامة ثم تنفيذ عمليات سالبة عبر
 * المسارات الحقيقية (الكاشير postSale / الشراء postPurchase).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest'
vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
const { useAppStore } = await import('../src/stores/app.store.ts')
const { useDataStore } = await import('../src/data/repo.ts')

const A = () => useAppStore.getState()
const S = () => useDataStore.getState()
const original = useDataStore.getState()

beforeAll(() => {
  useDataStore.setState(original)
  // إعداد كامل حتى لا يعترض أي حارس آخر (المعالج الأول)
  useAppStore.setState((s) => ({
    setup: { ...s.setup, completed: true, activityId: 'supermarket', countryCode: 'EG', taxRegistrationStatus: 'exempt', vatPercent: 0 },
  }))
})

describe('السماح بالرصيد السالب (بلاغ المالك)', () => {
  it('الخزينة: بتفعيل المفتاح تُقبل عملية تجعل الخزينة سالبة', () => {
    useAppStore.setState((s) => ({ setup: { ...s.setup, allowNegativeTreasury: true } }))
    // التفعيل مكتوب في المتجر (وسيكتبه persist إلى localStorage)
    expect(A().setup.allowNegativeTreasury).toBe(true)
    // فاتورة شراء نقدية مدفوعة أكبر من رصيد الخزينة 1101 (صفر حالياً)
    S().addItem({ nameAr: 'صنف نقدي', sku: 'CASH1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 1000, stockQty: 0, priceMinor: 2000, minQty: 0 } as never)
    const item = S().items.find((it) => it.sku === 'CASH1')!
    const purchase = S().postPurchase({
      supplierId: 0, date: '2026-10-05',
      lines: [{ itemId: item.id, nameAr: 'صنف نقدي', qty: 1, unitPriceMinor: 500000, vatPercent: 0, warehouseId: 1 }],
      paidMinor: 500000, treasury: '1101', warehouseId: 1, expenses: [], notes: '',
    } as never)
    expect(purchase.id).toBeGreaterThan(0) // لم تُرفض
    // رصيد 1101 الآن سالب فعلاً — القيد متوازن والرصيد السالب مسموح به
    let balance = 0
    for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '1101') balance += l.debit - l.credit
    expect(balance).toBe(-500000)
  })

  it('الخزينة: بإيقاف المفتاح تُرفض نفس العملية برسالة واضحة', () => {
    useAppStore.setState((s) => ({ setup: { ...s.setup, allowNegativeTreasury: false } }))
    const item = S().items.find((it) => it.sku === 'CASH1')!
    expect(() => S().postPurchase({
      supplierId: 0, date: '2026-10-05',
      lines: [{ itemId: item.id, nameAr: 'صنف نقدي', qty: 1, unitPriceMinor: 999999, unitCostMinor: 999999, vatPercent: 0, warehouseId: 1 }],
      paidMinor: 999999, treasury: '1101', warehouseId: 1, expenses: [], notes: '',
    } as never)).toThrow('سالب')
  })

  it('المخزون: بتفعيل المفتاح يُقبل بيع صنف رصيده صفر (كما يمرره الكاشير)', () => {
    useAppStore.setState((s) => ({ setup: { ...s.setup, allowNegativeStock: true } }))
    S().addItem({ nameAr: 'صنف متاجرة', sku: 'NEG1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 1000, stockQty: 0, priceMinor: 2000, minQty: 0 } as never)
    const item = S().items.find((it) => it.sku === 'NEG1')!
    // نفس ما يمرره PosPage: allowNegativeStock من الإعدادات العامة
    const sale = S().postSale({
      lines: [{ itemId: item.id, nameAr: 'صنف متاجرة', qty: 5, unitPriceMinor: 2000, unitCostMinor: 1000, vatPercent: 0, discountPercent: 0, warehouseId: 1 }],
      customerId: null, payment: 'cash', paidMinor: 10000, treasury: '1101', warehouseId: 1, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
      allowNegativeStock: true,
    } as never)
    expect(sale.id).toBeGreaterThan(0)
    expect(S().items.find((it) => it.id === item.id)!.stockQty).toBe(-5)
  })

  it('المخزون: بإيقاف المفتاح يُرفض البيع الناقص', () => {
    useAppStore.setState((s) => ({ setup: { ...s.setup, allowNegativeStock: false } }))
    const item = S().items.find((it) => it.sku === 'NEG1')!
    expect(() => S().postSale({
      lines: [{ itemId: item.id, nameAr: 'صنف متاجرة', qty: 1, unitPriceMinor: 2000, unitCostMinor: 1000, vatPercent: 0, discountPercent: 0, warehouseId: 1 }],
      customerId: null, payment: 'cash', paidMinor: 2000, treasury: '1101', warehouseId: 1, invoiceDiscountPercent: 0, taxPercent: 0, taxInclusive: false,
      allowNegativeStock: false,
    } as never)).toThrow('مخزون غير كافٍ')
  })
})

/* ═══ بلاغ المالك ① v1.0.4 المثبتة — محاكاة سطح المكتب حرفياً:
   persist يكتب إلى SQLite (settingsAppStorage) فlocalStorage يبقى فارغاً.
   الحارس القديم كان يقرأ localStorage فقط ⇒ الإعداد «معطل» مهما فُعّل. ═══ */
it('سطح المكتب: تفعيل الخزينة السالبة يعمل رغم أن localStorage فارغ (محاكاة SQLite persist)', async () => {
  localStorage.clear() // سطح المكتب: لا يكتب شيئاً في localStorage
  useAppStore.setState({ setup: { ...useAppStore.getState().setup, allowNegativeTreasury: true } })
  S().addItem({ nameAr: 'صنف سطح المكتب', sku: 'DESK1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 1000, stockQty: 0, priceMinor: 2000, minQty: 0 } as never)
  const item = S().items.find((it) => it.sku === 'DESK1')!
  const purchase = S().postPurchase({
    supplierId: 0, date: '2026-10-05',
    lines: [{ itemId: item.id, nameAr: 'صنف سطح المكتب', qty: 1, unitPriceMinor: 500000, vatPercent: 0, warehouseId: 1 }],
    paidMinor: 500000, treasury: '1101', warehouseId: 1, expenses: [], notes: '',
  } as never)
  expect(purchase.id).toBeGreaterThan(0)
  let balance = 0
  for (const e of S().journal) for (const l of e.lines) if (l.accountCode === '1101') balance += l.debit - l.credit
  expect(balance).toBeLessThanOrEqual(-500000) // القبول يعني الحارس قرأ المتجر الحي لا localStorage الفارغ
})
