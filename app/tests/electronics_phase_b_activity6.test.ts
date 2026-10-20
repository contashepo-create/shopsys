import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useDataStore, type SaleInvoice, type MaintenanceTicket, type DeliveryJob } from '../src/data/repo.ts'
import { markSold, warrantyLookup, type SerialUnit } from '../src/core/serials.ts'
import { warrantyAttachRate, warrantyClaimRateByItem } from '../src/core/warrantyReports.ts'
import { deliveryOnTimeRate } from '../src/core/deliveryReports.ts'

const original = useDataStore.getState()
const S = () => useDataStore.getState()

beforeEach(() => useDataStore.setState({ ...original, items: [], serials: [], sales: [], deliveryJobs: [], journal: [] }))
afterEach(() => useDataStore.setState(original))

const addTrackedItem = (nameAr = 'تلفاز سامسونج', sku = 'TV1', warrantyMonths = 12) =>
  S().addItem({ nameAr, sku, barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 100000, stockQty: 50, priceMinor: 200000, minQty: 0, trackSerial: true, warrantyMonths } as never)

describe('سد فجوة فورية #1 — النشاط #6 (أجهزة كهربائية): ربط الضمان بالعميل الأصلي عبر saleId', () => {
  it('warrantyLookup يرجع saleId الفاتورة التي بِيعت بها القطعة', () => {
    addTrackedItem()
    const item = S().items[0]
    useDataStore.setState({
      serials: [{ id: 1, itemId: item.id, serial: 'SN-001', status: 'in_stock', purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' }],
    })
    const sale = S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 200000, unitCostMinor: 100000, discountPercent: 0, serials: ['SN-001'] }],
      payment: 'cash', paidMinor: 200000, treasury: '1101', taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: false,
    } as never)
    const info = warrantyLookup(S().serials, 'SN-001', '2026-06-01')
    expect(info?.saleId).toBe(sale.id)
    expect(info?.active).toBe(true)
  })

  it('سيريال غير مباع (in_stock) لا يُرجع معلومات ضمان', () => {
    addTrackedItem()
    const item = S().items[0]
    useDataStore.setState({
      serials: [{ id: 1, itemId: item.id, serial: 'SN-002', status: 'in_stock', purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' }],
    })
    expect(warrantyLookup(S().serials, 'SN-002', '2026-06-01')).toBeUndefined()
  })
})

describe('سد فجوة فورية #3 — النشاط #6 (أجهزة كهربائية): ضمان ممتد على قطعة بعينها', () => {
  const pool: SerialUnit[] = [
    { id: 1, itemId: 1, serial: 'SN-100', status: 'in_stock', purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' },
  ]

  it('markSold يثبت extendedWarrantyMonths على القطعة ويُضاف فوق الضمان الأساسي في warrantyLookup', () => {
    const updated = markSold(pool, [{ itemId: 1, serial: 'SN-100', extendedWarrantyMonths: 24 }], 55, '2026-01-10T00:00:00.000Z')
    expect(updated[0].extendedWarrantyMonths).toBe(24)
    const info = warrantyLookup(updated, 'SN-100', '2026-01-10')
    // 12 أساسي + 24 ممتد = 36 شهراً من 2026-01-10
    expect(info?.warrantyMonths).toBe(36)
    expect(info?.warrantyUntil).toBe('2029-01-10')
  })

  it('بلا ضمان ممتد (0/undefined) تبقى المدة كما هي — بلا كسر توافق', () => {
    const updated = markSold(pool, [{ itemId: 1, serial: 'SN-100' }], 55, '2026-01-10T00:00:00.000Z')
    expect(updated[0].extendedWarrantyMonths).toBeUndefined()
    const info = warrantyLookup(updated, 'SN-100', '2026-01-10')
    expect(info?.warrantyMonths).toBe(12)
  })
})

describe('سد فجوة فورية #2 — النشاط #6 (أجهزة كهربائية): طلبات التوصيل/التركيب المجدولة', () => {
  const makeSale = () => {
    addTrackedItem('غسالة', 'WM1', 0)
    const item = S().items[0]
    return S().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 500000, unitCostMinor: 300000, discountPercent: 0 }],
      payment: 'cash', paidMinor: 500000, treasury: '1101', taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: false,
    } as never) as SaleInvoice
  }

  it('ينشئ طلب توصيل جديداً، ويحدّث نفس الطلب عند جدولة الفاتورة مرة أخرى (upsert)', () => {
    const sale = makeSale()
    const job = S().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-20', assignedTo: 'فريق أ' })
    expect(job.status).toBe('scheduled')
    expect(S().deliveryJobs).toHaveLength(1)
    const updated = S().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-25', assignedTo: 'فريق ب' })
    expect(updated.id).toBe(job.id) // نفس الطلب، لا تكرار
    expect(S().deliveryJobs).toHaveLength(1)
    expect(S().deliveryJobs[0].scheduledAt).toBe('2026-10-25')
    expect(S().deliveryJobs[0].assignedTo).toBe('فريق ب')
  })

  it('يرفض فاتورة غير موجودة أو تاريخاً بصيغة غير صالحة', () => {
    expect(() => S().scheduleDelivery({ saleId: 999999, scheduledAt: '2026-10-20' })).toThrow()
    const sale = makeSale()
    expect(() => S().scheduleDelivery({ saleId: sale.id, scheduledAt: '20-10-2026' })).toThrow()
  })

  it('setDeliveryStatus ينقل الحالة ويختم completedAt تلقائياً عند done فقط', () => {
    const sale = makeSale()
    const job = S().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-20' })
    expect(S().deliveryJobs[0].completedAt).toBeFalsy()
    S().setDeliveryStatus(job.id, 'in_progress')
    expect(S().deliveryJobs[0].status).toBe('in_progress')
    expect(S().deliveryJobs[0].completedAt).toBeFalsy()
    S().setDeliveryStatus(job.id, 'done')
    expect(S().deliveryJobs[0].status).toBe('done')
    expect(S().deliveryJobs[0].completedAt).toBeTruthy()
  })

  it('setDeliveryStatus يرفض طلب توصيل غير موجود، وdeleteDeliveryJob يحذف بالمعرّف', () => {
    expect(() => S().setDeliveryStatus(9999, 'done')).toThrow()
    const sale = makeSale()
    const job = S().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-20' })
    S().deleteDeliveryJob(job.id)
    expect(S().deliveryJobs).toHaveLength(0)
  })
})

describe('سد فجوة فورية #4 — النشاط #6 (أجهزة كهربائية): معدل إقران الضمان الممتد', () => {
  const pool: SerialUnit[] = [
    { id: 1, itemId: 1, serial: 'A1', status: 'sold', purchaseId: null, saleId: 1, soldAt: '2026-05-01T00:00:00.000Z', warrantyMonths: 12, extendedWarrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 2, itemId: 1, serial: 'A2', status: 'sold', purchaseId: null, saleId: 2, soldAt: '2026-05-15T00:00:00.000Z', warrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 3, itemId: 2, serial: 'B1', status: 'sold', purchaseId: null, saleId: 3, soldAt: '2026-05-10T00:00:00.000Z', warrantyMonths: 6, receivedAt: '2026-01-01T00:00:00.000Z' },
    { id: 4, itemId: 2, serial: 'B2', status: 'sold', purchaseId: null, saleId: 4, soldAt: '2026-06-10T00:00:00.000Z', warrantyMonths: 6, receivedAt: '2026-01-01T00:00:00.000Z' }, // خارج الفترة
    { id: 5, itemId: 1, serial: 'A3', status: 'in_stock', purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' }, // غير مباعة — تُستبعد
  ]

  it('يحسب معدل الإقران الإجمالي ولكل صنف ضمن الفترة فقط', () => {
    const summary = warrantyAttachRate(pool, '2026-05-01', '2026-05-31')
    expect(summary.totalSold).toBe(3) // A1, A2, B1 فقط (B2 خارج الفترة، A3 غير مباعة)
    expect(summary.totalExtended).toBe(1)
    expect(summary.overallAttachRatePercent).toBeCloseTo(33.3, 1)
    const item1Row = summary.rows.find((r) => r.itemId === 1)!
    expect(item1Row.soldCount).toBe(2)
    expect(item1Row.extendedCount).toBe(1)
    expect(item1Row.attachRatePercent).toBe(50)
  })

  it('فترة بلا أي مبيعات تعطي أصفاراً بلا انهيار', () => {
    const summary = warrantyAttachRate(pool, '2020-01-01', '2020-01-31')
    expect(summary).toEqual({ rows: [], totalSold: 0, totalExtended: 0, overallAttachRatePercent: 0 })
  })
})

describe('سد فجوة فورية #4 — النشاط #6 (أجهزة كهربائية): معدل تكرار مطالبات الضمان', () => {
  const pool: SerialUnit[] = [
    { id: 1, itemId: 10, serial: 'X1', status: 'sold', purchaseId: null, saleId: 1, soldAt: '2026-01-01T00:00:00.000Z', warrantyMonths: 12, receivedAt: '2025-01-01T00:00:00.000Z' },
    { id: 2, itemId: 10, serial: 'X2', status: 'sold', purchaseId: null, saleId: 2, soldAt: '2026-01-01T00:00:00.000Z', warrantyMonths: 12, receivedAt: '2025-01-01T00:00:00.000Z' },
    { id: 3, itemId: 20, serial: 'Y1', status: 'sold', purchaseId: null, saleId: 3, soldAt: '2026-01-01T00:00:00.000Z', warrantyMonths: 6, receivedAt: '2025-01-01T00:00:00.000Z' },
  ]
  const ticket = (id: number, deviceSerial: string, date: string): MaintenanceTicket => ({
    id, ticketNumber: `MT-${id}`, date, customerId: null, customerName: 'عميل', customerPhone: '',
    deviceName: 'جهاز', deviceSerial, issue: 'عطل', estimateMinor: 0, status: 'received', statusHistory: [],
  } as never)

  it('يحتسب قطعة واحدة بمطالبة واحدة فقط حتى لو تكررت تذاكرها، ويتجاهل مطالبة بعد انتهاء الضمان', () => {
    const tickets: MaintenanceTicket[] = [
      ticket(1, 'X1', '2026-03-01'), // ضمن الضمان
      ticket(2, 'X1', '2026-04-01'), // نفس القطعة — لا تُحتسب مرتين
      ticket(3, 'Y1', '2027-01-01'), // بعد انتهاء ضمان Y1 (6 أشهر من 2026-01-01) — تُتجاهل
    ]
    const rows = warrantyClaimRateByItem(pool, tickets)
    const item10 = rows.find((r) => r.itemId === 10)!
    expect(item10.soldUnderWarranty).toBe(2)
    expect(item10.claimsCount).toBe(1)
    expect(item10.claimRatePercent).toBe(50)
    const item20 = rows.find((r) => r.itemId === 20)!
    expect(item20.claimsCount).toBe(0)
  })

  it('تذكرة بسيريال غير مسجل أو بلا سيريال لا تُحتسب ولا تُسبب خطأ', () => {
    const tickets: MaintenanceTicket[] = [ticket(1, 'UNKNOWN', '2026-03-01'), ticket(2, '', '2026-03-01')]
    const rows = warrantyClaimRateByItem(pool, tickets)
    expect(rows.every((r) => r.claimsCount === 0)).toBe(true)
  })
})

describe('سد فجوة مستقبلية #2 — النشاط #6 (أجهزة كهربائية): مزوّد ضمان ممتد خارجي', () => {
  const pool: SerialUnit[] = [
    { id: 1, itemId: 1, serial: 'SN-200', status: 'in_stock', purchaseId: null, saleId: null, soldAt: null, warrantyMonths: 12, receivedAt: '2026-01-01T00:00:00.000Z' },
  ]

  it('markSold يثبت اسم المزوّد الخارجي، وwarrantyLookup يُعيده', () => {
    const updated = markSold(pool, [{ itemId: 1, serial: 'SN-200', extendedWarrantyMonths: 12, extendedWarrantyProvider: 'شركة الأمان للضمانات' }], 1, '2026-01-01T00:00:00.000Z')
    expect(updated[0].extendedWarrantyProvider).toBe('شركة الأمان للضمانات')
    const info = warrantyLookup(updated, 'SN-200', '2026-02-01')
    expect(info?.extendedWarrantyProvider).toBe('شركة الأمان للضمانات')
  })

  it('بلا مزوّد خارجي (ضمان ممتد داخلي فقط) — الحقل يبقى null/فارغاً', () => {
    const updated = markSold(pool, [{ itemId: 1, serial: 'SN-200', extendedWarrantyMonths: 12 }], 1, '2026-01-01T00:00:00.000Z')
    const info = warrantyLookup(updated, 'SN-200', '2026-02-01')
    expect(info?.extendedWarrantyProvider ?? null).toBeNull()
  })
})

describe('سد فجوة مستقبلية #1 — النشاط #6 (أجهزة كهربائية): تأكيد تسليم المندوب بتوقيع رقمي', () => {
  const makeSale = () => {
    useDataStore.getState().addItem({ nameAr: 'مكيف', sku: 'AC1', barcodes: [], categoryId: 0, baseUnit: 'قطعة', costMinor: 400000, stockQty: 20, priceMinor: 700000, minQty: 0 } as never)
    const item = useDataStore.getState().items[0]
    return useDataStore.getState().postSale({
      lines: [{ itemId: item.id, qty: 1, unitPriceMinor: 700000, unitCostMinor: 400000, discountPercent: 0 }],
      payment: 'cash', paidMinor: 700000, treasury: '1101', taxPercent: 0, invoiceDiscountPercent: 0, taxInclusive: false,
    } as never) as SaleInvoice
  }

  it('completeDeliveryWithSignature يضبط الحالة done ويحفظ التوقيع وختم الوقت معاً', () => {
    const sale = makeSale()
    const job = useDataStore.getState().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-20' })
    useDataStore.getState().completeDeliveryWithSignature(job.id, 'data:image/png;base64,AAA')
    const updated = useDataStore.getState().deliveryJobs.find((j) => j.id === job.id)!
    expect(updated.status).toBe('done')
    expect(updated.deliverySignatureDataUrl).toBe('data:image/png;base64,AAA')
    expect(updated.completedAt).toBeTruthy()
  })

  it('يرفض توقيعاً فارغاً أو طلب توصيل غير موجود', () => {
    const sale = makeSale()
    const job = useDataStore.getState().scheduleDelivery({ saleId: sale.id, scheduledAt: '2026-10-20' })
    expect(() => useDataStore.getState().completeDeliveryWithSignature(job.id, '   ')).toThrow()
    expect(() => useDataStore.getState().completeDeliveryWithSignature(999999, 'data:x')).toThrow()
  })
})

describe('سد فجوة مستقبلية #3 — النشاط #6 (أجهزة كهربائية): تقرير التزام مواعيد التوصيل', () => {
  const job = (id: number, scheduledAt: string, status: DeliveryJob['status'], completedAt: string | null): DeliveryJob => ({
    id, saleId: id, scheduledAt, status, completedAt,
  })

  it('يحسب نسبة الالتزام بالموعد — التأخر يُحتسب من تاريخ الإكمال لا الجدولة', () => {
    const jobs: DeliveryJob[] = [
      job(1, '2026-05-01', 'done', '2026-05-01T10:00:00.000Z'), // في الموعد
      job(2, '2026-05-02', 'done', '2026-05-02T15:00:00.000Z'), // في الموعد
      job(3, '2026-05-03', 'done', '2026-05-05T12:00:00.000Z'), // متأخر يومين
      job(4, '2026-05-04', 'scheduled', null), // غير مكتمل — لا يدخل الحساب
    ]
    const report = deliveryOnTimeRate(jobs, '2026-05-01', '2026-05-31')
    expect(report.completedCount).toBe(3)
    expect(report.onTimeCount).toBe(2)
    expect(report.lateCount).toBe(1)
    expect(report.onTimeRatePercent).toBeCloseTo(66.7, 1)
    const lateRow = report.rows.find((r) => r.job.id === 3)!
    expect(lateRow.daysLate).toBe(2)
  })

  it('بلا طلبات مكتملة في الفترة يعطي صفراً بلا انهيار', () => {
    const report = deliveryOnTimeRate([job(1, '2026-01-01', 'scheduled', null)], '2026-01-01', '2026-01-31')
    expect(report).toEqual({ completedCount: 0, onTimeCount: 0, lateCount: 0, onTimeRatePercent: 0, rows: [] })
  })
})
