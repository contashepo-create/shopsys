/**
 * البندان المتبقيان من تقرير التدقيق المحاسبي (§8):
 *   ① العملة الثانية داخل السند — الحساب والتحقق والعرض.
 *   ② تخصيص السند على مستندات الأنشطة المتخصصة — قواعد الاستحقاق ومفاتيح المستندات.
 *
 * هذه اختبارات النواة الخالصة؛ الدورة الحيّة على المحرك في البوابة
 * `scripts/verify_voucher_fx_and_specialized.mjs`.
 */
import { describe, it, expect } from 'vitest'
import {
  convertFxToBookMinor, describeFxLeg, formatRate, parseRateToPpm, validateFxLeg, FX_RATE_SCALE, COMMON_FX_CURRENCIES, type FxLeg,
} from '../src/core/foreignCurrency.ts'
import { openCustomerSpecializedDocuments, openSupplierSpecializedDocuments, documentKindLabel } from '../src/core/openPartyDocuments.ts'

const usd: FxLeg = { currencyCode: 'USD', amountMinor: 10000, ratePpm: 48_500_000, decimals: 2 }

describe('العملة الثانية داخل السند', () => {
  it('يحوّل بأعداد صحيحة بتقريب نصفي لأعلى', () => {
    expect(convertFxToBookMinor(usd, 2)).toBe(485000)
    expect(convertFxToBookMinor({ ...usd, amountMinor: 1 }, 2)).toBe(49) // 0.485 ⇒ 0.49
    expect(convertFxToBookMinor({ ...usd, amountMinor: 3, ratePpm: 3_333_333 }, 2)).toBe(10) // 0.0999… ⇒ 0.10
  })

  it('يدعم عملة بثلاث خانات ودفتراً بخانتين والعكس', () => {
    expect(convertFxToBookMinor({ currencyCode: 'KWD', amountMinor: 1000, ratePpm: 157_300_000, decimals: 3 }, 2)).toBe(15730)
    expect(convertFxToBookMinor({ currencyCode: 'USD', amountMinor: 10000, ratePpm: 3_670_000, decimals: 2 }, 3)).toBe(367000)
  })

  it('لا يفقد دقة في المبالغ الضخمة (BigInt داخلياً)', () => {
    expect(convertFxToBookMinor({ ...usd, amountMinor: 999_999_999 }, 2)).toBe(48_499_999_952)
    expect(Number.isSafeInteger(convertFxToBookMinor({ ...usd, amountMinor: 999_999_999 }, 2))).toBe(true)
  })

  it('يقرأ سعر الصرف من الأرقام العربية والفواصل ويعيد عرضه مختصراً', () => {
    expect(parseRateToPpm('48.5')).toBe(48_500_000)
    expect(parseRateToPpm('٤٨٫٧٥')).toBe(48_750_000)
    expect(parseRateToPpm('48,25')).toBe(48_250_000)
    expect(parseRateToPpm('')).toBe(0)
    expect(parseRateToPpm('1.1234567')).toBe(1 * FX_RATE_SCALE + 123456) // يُقطع عند ست خانات
    expect(formatRate(48_500_000)).toBe('48.5')
    expect(formatRate(49_000_000)).toBe('49')
  })

  it('يرفض العملة غير الصالحة وعملة الدفتر نفسها والمبالغ غير الموجبة', () => {
    expect(validateFxLeg(usd, 'EGP')).toEqual([])
    expect(validateFxLeg({ ...usd, currencyCode: 'EGP' }, 'EGP').join()).toContain('عملة الدفتر')
    expect(validateFxLeg({ ...usd, currencyCode: 'دولار' }, 'EGP').join()).toContain('ثلاثة حروف')
    expect(validateFxLeg({ ...usd, amountMinor: 0 }, 'EGP').join()).toContain('أكبر من صفر')
    expect(validateFxLeg({ ...usd, ratePpm: -1 }, 'EGP').join()).toContain('سعر الصرف')
    expect(validateFxLeg({ ...usd, ratePpm: 2_000_000 * FX_RATE_SCALE }, 'EGP').join()).toContain('غير معقول')
  })

  it('يصف الساق كما تُطبع على السند وفي وصف القيد', () => {
    expect(describeFxLeg(usd, 485000, 2)).toBe('100.00 USD × 48.5 = 4850.00')
    expect(COMMON_FX_CURRENCIES.find((row) => row.code === 'KWD')?.decimals).toBe(3)
  })
})

describe('مستندات الأنشطة المتخصصة في تخصيص السند', () => {
  const base = {
    customerId: 1,
    settledOf: () => 0,
  }

  it('يخرج كل مستند بمفتاح ثابت وذمة = القيمة ناقص المحصَّل', () => {
    const rows = openCustomerSpecializedDocuments({
      ...base,
      labOrders: [{ id: 2, orderNumber: 'LAB-0002', date: '2026-04-01', patientId: 5, payment: 'mixed', paidMinor: 4000, totals: { totalMinor: 10000 } }],
      linkedLabPatientIds: [5],
      trips: [{ id: 3, tripNumber: 'TR-0003', date: '2026-04-02', customerId: 1, payment: 'credit', totals: { grandMinor: 30000 } }],
      walletOps: [{ id: 4, opNumber: 'WS-0004', date: '2026-04-03', customerId: 1, status: 'done', chargeMinor: 5000, paidMinor: 5000 }],
    })
    expect(rows.map((row) => row.docKey)).toEqual(['lab:2', 'trip:3'])
    expect(rows[0].dueMinor).toBe(6000)
    expect(rows[1].dueMinor).toBe(30000)
  })

  it('يطبق نفس استثناءات كشف الحساب: تذكرة غير مسلَّمة ومحفظة مرتجعة وإيجار محصَّل', () => {
    const rows = openCustomerSpecializedDocuments({
      ...base,
      tickets: [{ id: 1, ticketNumber: 'MT-0001', customerId: 1, deliveredAt: null, totals: { grandMinor: 50000, paidMinor: 0 } }],
      walletOps: [{ id: 2, opNumber: 'WS-0002', date: '2026-04-01', customerId: 1, status: 'returned', chargeMinor: 9000, paidMinor: 0 }],
      rentals: [{ id: 3, contractNumber: 'RC-0003', date: '2026-04-01', customerId: 1, totals: { grandMinor: 70000, collectCreditMinor: 0 } }],
    })
    expect(rows).toEqual([])
  })

  it('يخصم مرتجع «على حساب العميل» من ذمة المستند نفسه', () => {
    const rows = openCustomerSpecializedDocuments({
      ...base,
      labOrders: [{
        id: 9, orderNumber: 'LAB-0009', date: '2026-04-05', patientId: 8, payment: 'credit', paidMinor: 0,
        totals: { totalMinor: 20000 }, refunds: [{ mode: 'customer_credit', amountMinor: 5000 }, { mode: 'cash', amountMinor: 3000 }],
      }],
      linkedLabPatientIds: [8],
    })
    expect(rows[0].dueMinor).toBe(15000)
  })

  it('يوزع تحصيلات المريض على زياراته بالأقدم أولاً كما في ملف المريض', () => {
    const rows = openCustomerSpecializedDocuments({
      ...base,
      linkedPatientIds: [4],
      clinicVisits: [
        { id: 1, visitNumber: 'VIS-0001', date: '2026-01-01', patientId: 4, totals: { totalMinor: 10000, paidMinor: 0, dueMinor: 10000 } },
        { id: 2, visitNumber: 'VIS-0002', date: '2026-02-01', patientId: 4, totals: { totalMinor: 30000, paidMinor: 0, dueMinor: 30000 } },
      ],
      clinicCollections: [{ patientId: 4, date: '2026-02-05', amountMinor: 15000 }],
    })
    expect(rows.map((row) => [row.docKey, row.dueMinor])).toEqual([['visit:2', 25000]])
  })

  it('يمرّر المخصص سابقاً لكل مفتاح حتى لا يُخصَّص المستند مرتين', () => {
    const rows = openCustomerSpecializedDocuments({
      customerId: 1,
      settledOf: (key) => (key === 'propsale:7' ? 60000 : 0),
      propertySales: [{ id: 7, saleNumber: 'RS-0007', date: '2026-05-01', buyerCustomerId: 1, dueMinor: 100000 }],
    })
    expect(rows[0]).toMatchObject({ docKey: 'propsale:7', dueMinor: 100000, settledMinor: 60000 })
  })

  it('يغطي مستندات المورد المتخصصة ويسمّي كل نوع بالعربية', () => {
    const rows = openSupplierSpecializedDocuments({
      supplierId: 3,
      settledOf: () => 0,
      carPurchaseInvoices: [{ id: 1, invoiceNumber: 'CPI-0001', date: '2026-01-01', supplierId: 3, dueMinor: 500000, carIds: [1] }],
      carPrepCosts: [{ id: 2, carId: 1, date: '2026-01-05', description: 'فرش', supplierId: 3, dueMinor: 0 }],
      projectCosts: [{ id: 3, date: '2026-01-07', description: 'أسمنت', supplierId: 3, dueMinor: 25000 }],
      carLabel: () => 'كورولا',
    })
    expect(rows.map((row) => row.docKey)).toEqual(['carinv:1', 'projcost:3'])
    expect(documentKindLabel('carinv:1')).toBe('فاتورة سيارات')
    expect(documentKindLabel('visit:9')).toBe('عيادة')
    expect(documentKindLabel('sale:1')).toBe('فاتورة بيع')
    expect(documentKindLabel('unknown:1')).toBe('مستند')
  })
})
