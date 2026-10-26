/**
 * اختبارات سد فجوات النشاط #7 (قطع غيار) — مرحلة ب:
 *  1) تطابق الملاءمة بنطاق سنوات مكتوب في حقل fitment (سد فجوة فورية #4)
 *  2) تقرير الربح حسب درجة القطعة: أصلي/بديل تجاري/مستعمل (سد فجوة فورية #3)
 *  3) طلبات العملاء المعلّقة: تسجيل + تحول تلقائي إلى «وصلت» عند اكتمال
 *     استلام أمر الشراء المرتبط (سد فجوة فورية #2)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { itemMatchesPartQuery, type Item } from '../src/core/items.ts'
import { gradeProfitReport } from '../src/core/reports.ts'
import { buildPartArrivedMessage } from '../src/core/partOrders.ts'
import { waChatLink } from '../src/core/whatsapp.ts'

const baseItem = (over: Partial<Item>): Item => ({
  id: 1, nameAr: 'صنف', sku: 'SKU-1', barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [],
  costMinor: 1000, stockQty: 5, priceMinor: 1500, minQty: 1, trackExpiry: false, trackSerial: false,
  warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
  ...over,
})

describe('سد فجوة فورية #4 — النشاط #7 (قطع غيار): تطابق نطاق السنوات بالملاءمة', () => {
  it('يطابق سنة مفردة ضمن نطاق مكتوب في fitment (مع اسم موديل)', () => {
    const it1 = baseItem({ fitment: 'تويوتا كورولا 2013-2017، هيونداي 2010-2012' })
    expect(itemMatchesPartQuery(it1, 'كورولا 2015')).toBe(true)
    expect(itemMatchesPartQuery(it1, 'كورولا 2018')).toBe(false) // خارج النطاق
    expect(itemMatchesPartQuery(it1, 'هيونداي 2011')).toBe(true)
    expect(itemMatchesPartQuery(it1, 'كورولا 2011')).toBe(false) // سنة ضمن نطاق آخر لا يخص الموديل المطلوب
  })

  it('يطابق سنة مفردة بلا اسم موديل إن وُجدت ضمن أي نطاق مذكور', () => {
    const it1 = baseItem({ fitment: 'كيا سيراتو 2016-2020' })
    expect(itemMatchesPartQuery(it1, '2018')).toBe(true)
    expect(itemMatchesPartQuery(it1, '2021')).toBe(false)
  })

  it('يحافظ على التطابق الحرفي السابق كخط رجوع (fallback) حين لا نطاق سنوات', () => {
    const it1 = baseItem({ fitment: 'كمبروسر تكييف عام' })
    expect(itemMatchesPartQuery(it1, 'تكييف')).toBe(true)
  })

  it('يحافظ على تطابق الاسم/الباركود/رقم OEM المعياري كما هو', () => {
    const it1 = baseItem({ nameAr: 'فلتر زيت', oemNumbers: ['OEM-123-A'] })
    expect(itemMatchesPartQuery(it1, 'فلتر زيت')).toBe(true)
    expect(itemMatchesPartQuery(it1, 'oem123a')).toBe(true)
  })
})

describe('سد فجوة فورية #3 — النشاط #7 (قطع غيار): الربح حسب درجة القطعة', () => {
  const line = (itemId: number, qty: number, unitPriceMinor: number, unitCostMinor: number) =>
    ({ itemId, nameAr: `صنف ${itemId}`, qty, unitPriceMinor, unitCostMinor, discountPercent: 0 }) as unknown as import('../src/core/pos.ts').CartLine
  const totalsOf = (lines: ReturnType<typeof line>[]) => {
    const gross = lines.reduce((a, l: any) => a + l.unitPriceMinor * l.qty, 0)
    return { grossMinor: gross, discountMinor: 0, netMinor: gross, taxBaseMinor: gross, taxMinor: 0, totalMinor: gross, cogsMinor: 0 }
  }

  it('يجمع الإيراد/الربح لكل درجة على حدة ويرتب تنازلياً بالإيراد', () => {
    const lines = [line(1, 2, 1000, 600), line(2, 1, 2000, 1500), line(3, 1, 500, 400)]
    const sale = { id: 1, invoiceNumber: 'S-1', date: '2026-09-10', customerId: null, payment: 'cash' as const, lines, totals: totalsOf(lines) }
    const items = [
      { id: 1, grade: 'original' as const },
      { id: 2, grade: 'aftermarket' as const },
      { id: 3, grade: 'original' as const },
    ]
    const rows = gradeProfitReport([sale], [], items, { from: '2026-09-01', to: '2026-09-30' })
    const original = rows.find((r) => r.grade === 'original')!
    const aftermarket = rows.find((r) => r.grade === 'aftermarket')!
    expect(original.qty).toBe(3) // صنف 1 (2) + صنف 3 (1)
    expect(original.revenueMinor).toBe(2000 + 500)
    expect(original.profitMinor).toBe((1000 - 600) * 2 + (500 - 400))
    expect(aftermarket.revenueMinor).toBe(2000)
    expect(aftermarket.marginPercent).toBe(25) // (2000-1500)/2000*100
    // الأعلى إيراداً أولاً
    expect(rows[0].revenueMinor).toBeGreaterThanOrEqual(rows[1]?.revenueMinor ?? 0)
  })

  it('صنف بلا درجة مسجّلة يُجمَّع تحت unspecified', () => {
    const lines = [line(9, 1, 1000, 500)]
    const sale = { id: 1, invoiceNumber: 'S-1', date: '2026-09-10', customerId: null, payment: 'cash' as const, lines, totals: totalsOf(lines) }
    const rows = gradeProfitReport([sale], [], [{ id: 9 }], { from: '2026-09-01', to: '2026-09-30' })
    expect(rows).toHaveLength(1)
    expect(rows[0].grade).toBe('unspecified')
  })

  it('مصفوفة فارغة بلا مبيعات في الفترة', () => {
    expect(gradeProfitReport([], [], [{ id: 1, grade: 'original' as const }], { from: '2026-09-01', to: '2026-09-30' })).toEqual([])
  })
})

describe('سد فجوة فورية #2 — النشاط #7 (قطع غيار): طلبات العملاء المعلّقة', () => {
  let useDataStore: typeof import('../src/data/repo.ts').useDataStore
  let itemId = 0
  let supplierId = 0

  beforeAll(async () => {
    localStorage.clear()
    ;({ useDataStore } = await import('../src/data/repo.ts'))
    const { useAppStore } = await import('../src/stores/app.store.ts')
    const app = useAppStore.getState()
    useAppStore.setState({
      ...app,
      setup: {
        ...app.setup, completed: true, countryCode: 'EG', activityId: 'spare_parts', shopName: 'محل قطع غيار الاختبار',
        ownerName: 'المالك', features: [], modules: ['pos', 'inventory', 'purchases'], accountingMode: 'full',
        vatPercent: 0, taxRegistrationStatus: 'not_registered' as never,
      },
    })
    const s = useDataStore.getState()
    s.addCategory('قطع غيار', [])
    const categoryId = useDataStore.getState().categories[0]?.id ?? 0
    s.addItem({
      nameAr: 'طرمبة بنزين', sku: 'PUMP-1', barcodes: [], categoryId, baseUnit: 'قطعة', extraUnits: [],
      costMinor: 20000, stockQty: 0, priceMinor: 30000, minQty: 1, trackExpiry: false, trackSerial: false,
      warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isActive: true,
    })
    itemId = useDataStore.getState().items.find((it) => it.sku === 'PUMP-1')!.id
    s.addSupplier({ nameAr: 'مورد القطع', phone: '0100', notes: '', taxNumber: '', commercialReg: '', email: '', address: '', city: '', postalCode: '', buildingNo: '', nationalId: '' })
    supplierId = useDataStore.getState().suppliers[0].id
  })

  it('تسجيل طلب عميل جديد يولد رقم أمر CPO ويبدأ بحالة pending', () => {
    const s = useDataStore.getState()
    const order = s.addPendingPartOrder({
      itemId, itemNameAr: 'طرمبة بنزين', customerId: null, customerName: 'أحمد', customerPhone: '01012345678',
      qty: 2, orderedAt: '2026-09-10T00:00:00.000Z',
    })
    expect(order.orderNumber).toMatch(/^CPO-\d{4}$/)
    expect(order.status).toBe('pending')
    expect(useDataStore.getState().pendingPartOrders).toHaveLength(1)
  })

  it('يرفض تسجيل طلب بلا صنف أو بكمية صفر أو بلا اسم عميل', () => {
    const s = useDataStore.getState()
    expect(() => s.addPendingPartOrder({ itemId: 0, itemNameAr: '', customerId: null, customerName: 'أحمد', customerPhone: '', qty: 1, orderedAt: '2026-09-10' })).toThrow()
    expect(() => s.addPendingPartOrder({ itemId, itemNameAr: 'طرمبة', customerId: null, customerName: 'أحمد', customerPhone: '', qty: 0, orderedAt: '2026-09-10' })).toThrow()
    expect(() => s.addPendingPartOrder({ itemId, itemNameAr: 'طرمبة', customerId: null, customerName: '', customerPhone: '', qty: 1, orderedAt: '2026-09-10' })).toThrow()
  })

  it('اكتمال استلام أمر الشراء المرتبط يحوّل الطلب تلقائياً من pending إلى arrived', () => {
    let s = useDataStore.getState()
    const po = s.addPurchaseOrder({
      supplierId, supplierName: 'مورد القطع', date: '2026-09-01', expectedDate: '2026-09-05', warehouseId: null,
      lines: [{ itemId, nameAr: 'طرمبة بنزين', qty: 2, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 20000, vatPercent: 0, notes: '' }],
      notes: '',
    })
    s.setPurchaseOrderStatus(po.id, 'sent')
    const order = s.addPendingPartOrder({
      itemId, itemNameAr: 'طرمبة بنزين', customerId: null, customerName: 'سعيد', customerPhone: '01098765432',
      qty: 2, orderedAt: '2026-09-02T00:00:00.000Z', linkedPurchaseOrderId: po.id,
    })
    // استلام جزئي أولاً — لا يُفترض أن يتحول الطلب بعد
    s.receivePurchaseOrder(po.id, [{ itemId, qty: 1 }])
    expect(useDataStore.getState().pendingPartOrders.find((o) => o.id === order.id)!.status).toBe('pending')
    // استلام الباقي يكمل الأمر إلى closed، فيتحول الطلب تلقائياً
    s.receivePurchaseOrder(po.id, [{ itemId, qty: 1 }])
    s = useDataStore.getState()
    expect(s.purchaseOrders.find((o) => o.id === po.id)!.status).toBe('closed')
    const updatedOrder = s.pendingPartOrders.find((o) => o.id === order.id)!
    expect(updatedOrder.status).toBe('arrived')
    expect(updatedOrder.arrivedAt).toBeTruthy()
  })

  it('لا يحوّل طلباً غير مرتبط بأمر الشراء المكتمل', () => {
    let s = useDataStore.getState()
    const po = s.addPurchaseOrder({
      supplierId, supplierName: 'مورد القطع', date: '2026-09-01', expectedDate: '2026-09-05', warehouseId: null,
      lines: [{ itemId, nameAr: 'طرمبة بنزين', qty: 1, receivedQty: 0, unitAr: 'قطعة', unitPriceMinor: 20000, vatPercent: 0, notes: '' }],
      notes: '',
    })
    const order = s.addPendingPartOrder({
      itemId, itemNameAr: 'طرمبة بنزين', customerId: null, customerName: 'منى', customerPhone: '',
      qty: 1, orderedAt: '2026-09-02T00:00:00.000Z', linkedPurchaseOrderId: null, // بلا ربط
    })
    s.receivePurchaseOrder(po.id, [{ itemId, qty: 1 }])
    s = useDataStore.getState()
    expect(s.purchaseOrders.find((o) => o.id === po.id)!.status).toBe('closed')
    expect(s.pendingPartOrders.find((o) => o.id === order.id)!.status).toBe('pending')
  })

  it('يغيّر الحالة يدوياً (وصلت/سُلّمت/ملغى) ويحذف الطلب', () => {
    let s = useDataStore.getState()
    const order = s.addPendingPartOrder({
      itemId, itemNameAr: 'طرمبة بنزين', customerId: null, customerName: 'كريم', customerPhone: '',
      qty: 1, orderedAt: '2026-09-02T00:00:00.000Z',
    })
    s.setPendingPartOrderStatus(order.id, 'arrived')
    s = useDataStore.getState()
    expect(s.pendingPartOrders.find((o) => o.id === order.id)!.status).toBe('arrived')
    s.setPendingPartOrderStatus(order.id, 'delivered')
    s = useDataStore.getState()
    const delivered = s.pendingPartOrders.find((o) => o.id === order.id)!
    expect(delivered.status).toBe('delivered')
    expect(delivered.deliveredAt).toBeTruthy()
    s.deletePendingPartOrder(order.id)
    expect(useDataStore.getState().pendingPartOrders.find((o) => o.id === order.id)).toBeUndefined()
  })
})

describe('سد فجوة مستقبلية #3 — النشاط #7 (قطع غيار): إخطار واتساب بوصول القطعة', () => {
  it('يبني رسالة عربية صحيحة وتُفعّل في رابط wa.me برقم العميل', () => {
    const msg = buildPartArrivedMessage({ orderNumber: 'CPO-0001', customerName: 'سامي', itemNameAr: 'طرمبة بنزين', qty: 2 }, 'محل تجريبي')
    expect(msg).toContain('سامي')
    expect(msg).toContain('طرمبة بنزين')
    expect(msg).toContain('CPO-0001')
    const link = waChatLink('01012345678', msg)
    expect(link).toMatch(/^https:\/\/wa\.me\/201012345678\?text=/)
  })
})
