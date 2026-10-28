/**
 * انحدارات «المراجعة الأدق» — 2026-10-27.
 * أثبتت هذه الحالات أربعة عيوب محاسبية حقيقية في الدفتر التحليلي (التصميم ③)
 * بعد المراجعة الشاملة الأولى، ثم صارت اختبارات حارسة بعد الإصلاح:
 *   A) شيكات العميل كلها كانت تُدرج في كل مشروع ⇒ تحصيل مضخَّم.
 *   B) استنتاج تسديد كامل لمستند غاب عن الدفتر بلا دليل سداد ⇒ تحصيل وهمي.
 *   C) المستخلص النقدي مع استرداد دفعة مقدمة كان يُحصَّل مرتين.
 *   G) التسوية الختامية كانت توحي بطرح المصروفات من «المتبقي من التحصيل».
 */
import { describe, expect, it } from 'vitest'
import {
  buildAnalyticalProjectReport, buildCollectionRows, buildExtractSettledMap,
  type AnalyticalProjectSource,
} from '../src/core/analyticalProjectReport.ts'
import { renderFormalReportHtml } from '../src/core/formalReport.ts'
import { DEFAULT_REPORT_PRINT } from '../src/core/reportPrint.ts'

const fmt = (m: number) => (m / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function src(over: Partial<AnalyticalProjectSource> = {}): AnalyticalProjectSource {
  return {
    project: { code: 'P1', nameAr: 'مشروع', clientName: 'عميل', status: 'جارٍ', startDate: '2026-01-01', contractValueMinor: 100_000_00 },
    extracts: [{ extractNumber: 'E1', date: '2026-02-01', grossMinor: 100_000_00, vatMinor: 0, retentionMinor: 0, dueMinor: 100_000_00, payment: 'credit' }],
    expenses: [],
    extractDocKeys: ['extract:1'],
    openInvoiceSettled: new Map([['extract:1', 40_000_00]]),
    currencySymbol: 'ج.م', companyName: 'شركة الحديد', fmt,
    ...over,
  }
}

const twoCheques: NonNullable<AnalyticalProjectSource['cheques']> = [
  { direction: 'incoming', partyId: 1, status: 'collected', amountMinor: 40_000_00, chequeNumber: 'CHQ-1', createdAt: '2026-03-01T00:00:00Z' },
  { direction: 'incoming', partyId: 1, status: 'collected', amountMinor: 60_000_00, chequeNumber: 'CHQ-2', createdAt: '2026-03-02T00:00:00Z' },
]

describe('المراجعة الأدق — سلامة منطق الدفتر التحليلي', () => {
  it('A) يُدرج من شيكات العميل نصيب هذا المشروع فقط ولا يتجاوز هدف التحصيل', () => {
    /* عميل له مشروعان: شيك 100 ألف وُزّع FIFO — 40 ألف على هذا المشروع،
       60 ألف على مستند آخر. الدفتر يعرف 40 ألف فقط. */
    const collections = buildCollectionRows(src({ cheques: twoCheques, chequeAttributedMinor: 40_000_00 }))
    expect(collections.targetMinor).toBe(40_000_00)
    expect(collections.totalMinor).toBe(40_000_00)
    /* الشيك خارج النطاق معروض بصفرة للتوضيح لا محذوف */
    const outside = collections.rows.find((r) => r.number === 'CHQ-2')
    expect(outside?.amountMinor).toBe(0)
    expect(outside?.description).toContain('خارج نطاق هذا المشروع')
    expect(collections.running.at(-1)).toBe(100_000_00 - 40_000_00)
  })

  it('A2) بدون سقف توزيع تبقى كل الشيكات محسوبة (توافق قديم)', () => {
    const collections = buildCollectionRows(src({ cheques: twoCheques }))
    expect(collections.totalMinor).toBe(100_000_00)
    expect(collections.rows.every((r) => r.number !== 'CHQ-2' || r.amountMinor === 60_000_00)).toBe(true)
  })

  it('A3) شيك مرتد لا يُحسب ضمن التحصيل ولا يستهلك سقف التوزيع', () => {
    const collections = buildCollectionRows(src({
      chequeAttributedMinor: 40_000_00,
      cheques: [
        { direction: 'incoming', partyId: 1, status: 'bounced', amountMinor: 90_000_00, chequeNumber: 'CHQ-BAD', createdAt: '2026-02-20T00:00:00Z' },
        ...twoCheques,
      ],
    }))
    expect(collections.totalMinor).toBe(40_000_00)
    expect(collections.rows.find((r) => r.number === 'CHQ-1')?.amountMinor).toBe(40_000_00)
  })

  it('A4) ملاحظة التقرير تشرح فرق التوزيع بين المشروعات', () => {
    const m = buildAnalyticalProjectReport(src({
      cheques: twoCheques,
      chequeAttributedMinor: 40_000_00,
      vouchers: [{ date: '2026-03-01', number: 'CHQ-1', amountMinor: 40_000_00, allocations: [{ docKey: 'extract:1', appliedMinor: 40_000_00 }] }],
    }))
    expect(m.notes?.some((n) => n.includes('تخص مستندات أخرى أيضاً'))).toBe(true)
    expect(m.notes?.some((n) => n.includes('معادلتان مستقلتان'))).toBe(true)
  })

  it('B) لا يُستنتج تسديد كامل لمستند غائب عن الدفتر بلا دليل سداد', () => {
    const map = buildExtractSettledMap({
      extractDocKeys: ['extract:1'],
      openInvoices: [], // الدفتر لم يُرجع المستخلص (مثلاً ارتبط بعميل آخر)
      extractDues: new Map([['extract:1', 100_000_00]]),
      // لا سندات ولا تسويات ولا شيكات ⇒ لا دليل سداد إطلاقاً
    })
    expect(map.get('extract:1') ?? 0).toBe(0)
  })

  it('B2) مع دليل سداد (شيك/سند) يُستنتج السداد، ومع توزيع صريح يُعتمد التوزيع', () => {
    const args = {
      extractDocKeys: ['extract:1'],
      openInvoices: [] as { docKey: string; settledMinor: number }[],
      extractDues: new Map([['extract:1', 100_000_00]]),
    }
    expect(buildExtractSettledMap({ ...args, hasSettlementEvidence: true }).get('extract:1')).toBe(100_000_00)
    const withExplicit = buildExtractSettledMap({
      ...args,
      vouchers: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 30_000_00 }] }],
    })
    /* التوزيع الصريح 30 ألف ⇒ لا يُرفع إلى 100 ألف إلا بوجود دليل إضافي؛
       والتوزيع الصريح نفسه دليل سداد فيُكمَّل بصافي الاستحقاق. */
    expect(withExplicit.get('extract:1')).toBe(100_000_00)
    const open = buildExtractSettledMap({
      ...args,
      openInvoices: [{ docKey: 'extract:1', settledMinor: 25_000_00 }],
      vouchers: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 30_000_00 }] }],
    })
    expect(open.get('extract:1')).toBe(25_000_00) // المستند المفتوح: settledMinor هو المصدر الوحيد
  })

  it('C) المستخلص النقدي مع استرداد دفعة مقدمة: التحصيل = المستحق فقط', () => {
    const base = src({
      extracts: [{ extractNumber: 'E1', date: '2026-02-01', grossMinor: 100_000_00, vatMinor: 0, retentionMinor: 0, dueMinor: 100_000_00, payment: 'cash', advanceRecoveryMinor: 30_000_00 }],
      openInvoiceSettled: new Map(),
    })
    const collections = buildCollectionRows(base)
    expect(collections.targetMinor).toBe(100_000_00)
    expect(collections.totalMinor).toBe(100_000_00)
    expect(collections.running.at(-1)).toBe(0)
    /* 70 ألف نقد + 30 ألف مقاصة = 100 ألف (لا 130 ألف) */
    expect(collections.rows.find((r) => r.method === 'نقدي')?.amountMinor).toBe(70_000_00)
    expect(collections.rows.find((r) => r.method === 'مقاصة 2109')?.amountMinor).toBe(30_000_00)
  })

  it('C2) استرداد دفعة مقدمة يتجاوز المستحق يُقيَّد بالمستحق (حارس المقاصة)', () => {
    const base = src({
      extracts: [{ extractNumber: 'E1', date: '2026-02-01', grossMinor: 100_000_00, vatMinor: 0, retentionMinor: 0, dueMinor: 20_000_00, payment: 'cash', advanceRecoveryMinor: 30_000_00 }],
      openInvoiceSettled: new Map(),
    })
    const collections = buildCollectionRows(base)
    expect(collections.targetMinor).toBe(20_000_00)
    expect(collections.totalMinor).toBe(20_000_00)
  })

  it('G) التسوية الختامية تفصل بين ذمة العميل ونتيجة المشروع', () => {
    const m = buildAnalyticalProjectReport(src({
      expenses: [{ date: '2026-02-05', docNumber: 'X', description: 'مصروف', amountMinor: 25_000_00 }],
      openInvoiceSettled: new Map([['extract:1', 40_000_00]]),
      vouchers: [{ date: '2026-02-10', number: 'RV-1', amountMinor: 40_000_00, allocations: [{ docKey: 'extract:1', appliedMinor: 40_000_00 }] }],
    }))
    const eq = m.equation ?? []
    const iRemain = eq.findIndex((e) => e.label.includes('المتبقي من التحصيل'))
    const iRevenue = eq.findIndex((e) => e.label.includes('بداية مستقلة'))
    const iExpense = eq.findIndex((e) => e.label.includes('يُطرح: إجمالي مصروفات'))
    expect(iRemain).toBeGreaterThanOrEqual(0)
    expect(iRevenue).toBe(iRemain + 1) // بدء معادلة جديدة قبل طرح المصروفات
    expect(iExpense).toBe(iRevenue + 1)
    expect(eq.at(-1)?.value).toBe(fmt(100_000_00 - 25_000_00))
  })

  it('يوضّح أن ربط الشيكات الفردية تقديري وأن الحافظة ليست نقدية محصلة', () => {
    const model = buildAnalyticalProjectReport(src({
      chequeAttributedMinor: 100,
      cheques: [{ direction: 'incoming', partyId: 1, status: 'held', amountMinor: 100, chequeNumber: 'H', createdAt: '2026-01-01' }],
    }))
    expect(model.notes?.join(' ')).toContain('تقديري')
    expect(model.notes?.join(' ')).toContain('لا يعني دخول النقدية')
  })

  it('H) سطور الترويسة تصل إلى HTML الطباعة كما تظهر على الشاشة', () => {
    const m = buildAnalyticalProjectReport(src({ headerLines: ['المنطقة الصناعية — المنصورة', 'الرقم الضريبي: 123456789'] }))
    const html = renderFormalReportHtml(m, DEFAULT_REPORT_PRINT)
    expect(html).toContain('المنطقة الصناعية — المنصورة')
    expect(html).toContain('الرقم الضريبي: 123456789')
    expect(html).toContain('class="rp-hl"')
  })
})
