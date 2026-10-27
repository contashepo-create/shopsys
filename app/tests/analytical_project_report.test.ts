/**
 * التصميم ③ «الدفتر التحليلي» — اختبارات النواة الخالصة.
 * يثبت ترتيب الأقسام كما طلب المالك، وعمود الرصيد التراكمي، وعمود
 * «المتبقي بعد كل تحصيل»، والتسوية، وإدراج الشيكات، وإظهار فرق المراجعة.
 */
import { describe, expect, it } from 'vitest'
import { buildAnalyticalProjectReport, buildCollectionRows, buildExtractSettledMap, type AnalyticalProjectSource } from '../src/core/analyticalProjectReport.ts'
import { formalReportBodyHtml, renderFormalReportHtml } from '../src/core/formalReport.ts'
import { DEFAULT_REPORT_PRINT } from '../src/core/reportPrint.ts'

const fmt = (m: number) => (m / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function base(over: Partial<AnalyticalProjectSource> = {}): AnalyticalProjectSource {
  return {
    project: { code: 'PRJ-1', nameAr: 'فيلا النخيل', clientName: 'شركة الأفق', status: 'جارٍ التنفيذ', startDate: '2026-01-01', contractValueMinor: 2_450_000_00 },
    changeOrdersApprovedMinor: 85_000_00,
    extracts: [
      { extractNumber: 'EXT-1', date: '2026-02-01', grossMinor: 1_000_000_00, vatMinor: 0, retentionMinor: 50_000_00, dueMinor: 950_000_00, payment: 'credit' },
      { extractNumber: 'EXT-2', date: '2026-03-01', grossMinor: 830_000_00, vatMinor: 0, retentionMinor: 0, dueMinor: 830_000_00, payment: 'credit' },
    ],
    expenses: [
      { date: '2026-02-05', docNumber: 'EXP-1', description: 'حديد', amountMinor: 186_500_00, category: 'مواد' },
      { date: '2026-03-10', docNumber: 'EXP-2', description: 'أجور', amountMinor: 74_250_00, category: 'أجور' },
    ],
    openInvoiceSettled: new Map([['extract:1', 565_000_00], ['extract:2', 700_000_00]]),
    extractDocKeys: ['extract:1', 'extract:2'],
    vouchers: [{ date: '2026-02-10', number: 'RV-1', amountMinor: 565_000_00, description: 'دفعة' }],
    clientSettlements: [{ date: '2026-03-05', number: 'SET-1', amountMinor: 300_000_00, allocations: [{ docKey: 'extract:2', appliedMinor: 300_000_00 }] }],
    cheques: [{ direction: 'incoming', partyId: 1, status: 'collected', amountMinor: 400_000_00, chequeNumber: 'CHQ-1', createdAt: '2026-03-20T00:00:00Z', bankName: 'بنك مصر' }],
    currencySymbol: 'ر.س',
    companyName: 'مجموعة البناء الحديث',
    fmt,
    ...over,
  }
}

describe('نموذج التقرير التحليلي (التصميم ③)', () => {
  it('① ترتيب الأقسام: مؤشرات ← مصروفات برصيد تراكمي ← تحصيلات بالمتبقي ← تسوية', () => {
    const m = buildAnalyticalProjectReport(base())
    expect(m.title).toBe('تقرير متابعة مشروع')
    expect(m.meta[0]).toMatchObject({ label: 'اسم المشروع', value: 'فيلا النخيل' })
    expect(m.sections).toHaveLength(2)
    expect(m.sections[0]!.title).toContain('المصروفات')
    expect(m.sections[0]!.headers).toContain('الرصيد التراكمي (ر.س)')
    expect(m.sections[1]!.title).toContain('التحصيلات')
    expect(m.sections[1]!.headers).toContain('المتبقي بعد التحصيل (ر.س)')
    expect(m.equation?.at(-1)?.label).toContain('صافي نتيجة المشروع')
  })

  it('② الرصيد التراكمي للمصروفات صحيح ومتصاعد', () => {
    const m = buildAnalyticalProjectReport(base())
    const rows = m.sections[0]!.rows
    expect(rows[0]!.cells[6]).toBe(fmt(186_500_00))
    expect(rows[1]!.cells[6]).toBe(fmt(260_750_00))
    expect(m.sections[0]!.totalRow?.[6]).toBe(fmt(260_750_00))
  })

  it('③ «المتبقي بعد كل تحصيل» يتناقص حتى يطابق المتبقي من التسوية', () => {
    const src = base()
    const m = buildAnalyticalProjectReport(src)
    const rows = m.sections[1]!.rows
    expect(rows.length).toBeGreaterThanOrEqual(3)
    const running = rows.map((r) => r.cells[7] as string)
    // آخر رصيد = المتبقي من التحصيل في التسوية
    const remaining = m.equation?.find((e) => e.label.includes('المتبقي من التحصيل'))?.value
    expect(running.at(-1)).toBe(remaining)
  })

  it('④ الشيك الوارد مُدرَج ضمن التحصيلات، والمرتد معروض بين قوسين بلا خصم', () => {
    const active = buildAnalyticalProjectReport(base())
    expect(active.sections[1]!.rows.some((r) => JSON.stringify(r.cells).includes('CHQ-1'))).toBe(true)
    expect(active.notes?.some((n) => n.includes('الشيكات الواردة'))).toBe(true)

    const bounced = buildAnalyticalProjectReport(base({
      cheques: [{ direction: 'incoming', partyId: 1, status: 'bounced', amountMinor: 400_000_00, chequeNumber: 'CHQ-2', createdAt: '2026-03-20T00:00:00Z' }],
      vouchers: [], clientSettlements: [],
      openInvoiceSettled: new Map([['extract:1', 200_000_00], ['extract:2', 300_000_00]]),
    }))
    const row = bounced.sections[1]!.rows.find((r) => JSON.stringify(r.cells).includes('CHQ-2'))!
    expect(JSON.stringify(row.cells)).toContain('مرتد')
    expect(JSON.stringify(row.cells)).toContain('(400,000.00)') // بين قوسين
    expect(bounced.notes?.some((n) => n.includes('مرتدة'))).toBe(true)
  })

  it('⑤ فرق المراجعة يظهر when سطور التحصيل لا تطابق المخصوم من الذمم', () => {
    const m = buildAnalyticalProjectReport(base({
      vouchers: [{ date: '2026-02-10', number: 'RV-1', amountMinor: 999_999_00 }],
      clientSettlements: [], cheques: [],
      openInvoiceSettled: new Map([['extract:1', 100_000_00]]),
    }))
    expect(m.notes?.some((n) => n.includes('تنبيه مراجعة'))).toBe(true)
  })

  it('⑥ no project ⇒ لا قسمة على صفر (نسبة التحصيل 0)', () => {
    const m = buildAnalyticalProjectReport(base({ extracts: [], openInvoiceSettled: new Map(), vouchers: [], clientSettlements: [], cheques: [] }))
    expect(m.indicators?.find((i) => i.label === 'نسبة التحصيل')?.value).toBe('0٪')
    expect(m.indicators?.find((i) => i.label === 'المتبقي من التحصيل')?.value).toBe(fmt(0))
    // المصروفات مستقلة عن المستخلصات: تظهر حتى لو لم يُستخلص شيء بعد
    expect(m.sections[0]!.rows.length).toBeGreaterThan(0)
    expect(m.sections[1]!.rows).toHaveLength(0)
  })

  it('⑦ buildCollectionRows يرتّب زمنياً ويحسب الإجمالي والجري', () => {
    const r = buildCollectionRows(base())
    expect(r.rows.map((x) => x.date)).toEqual([...r.rows.map((x) => x.date)].sort())
    expect(r.totalMinor).toBeGreaterThan(0)
    expect(r.running).toHaveLength(r.rows.length)
  })
})

describe('مخرجات HTML الرسمية', () => {
  it('① الجسم يحمل كل العناوين والأقسام دون كروت', () => {
    const m = buildAnalyticalProjectReport(base())
    const html = formalReportBodyHtml(m)
    expect(html).toContain('الملخص المالي')
    expect(html).toContain('الرصيد التراكمي')
    expect(html).toContain('المتبقي بعد التحصيل')
    expect(html).toContain('التسوية الختامية')
    expect(html).toContain('class="total"')
    expect(html).not.toContain('class="cards"')
  })

  it('② الغلاف الكامل يحمل rp-body (يُفتح به باب المعاينة) وتوقيعات عند الطلب', () => {
    const m = buildAnalyticalProjectReport(base())
    const html = renderFormalReportHtml(m, DEFAULT_REPORT_PRINT)
    expect(html).toContain('class="rp-body"')
    expect(html).toContain('فيلا النخيل')
    const withSigs = renderFormalReportHtml(m, { ...DEFAULT_REPORT_PRINT, showSignatures: true })
    expect(withSigs).toContain('اعتماد')
  })

  it('③ تهريب HTML: اسم مشروع فيه <script> لا يمرّ كـ HTML خام', () => {
    const m = buildAnalyticalProjectReport(base())
    m.subtitle = '<script>alert(1)</script>'
    const html = renderFormalReportHtml(m, DEFAULT_REPORT_PRINT)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })
})


/* ─── مراجعة شاملة 2026-10-27: منع تكرار التحصيل وحصره في مستخلصات المشروع ─── */
describe('مراجعة الدفتر التحليلي — سلامة التحصيلات', () => {
  it('① المستند المفتوح يأخذ settledMinor وحده (لا تُضاف توزيعاته مرة ثانية)', () => {
    const map = buildExtractSettledMap({
      extractDocKeys: ['extract:1'],
      /* الدفتر أصلًا جمع 250 ألف سند + 150 ألف تسوية */
      openInvoices: [{ docKey: 'extract:1', settledMinor: 400_000 }],
      vouchers: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 250_000 }] }],
      clientSettlements: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 150_000 }] }],
    })
    expect(map.get('extract:1')).toBe(400_000)
  })

  it('② مستخلص مسدَّد بالكامل (غاب عن الدفتر المفتوح) يُقرأ من توزيعاته', () => {
    const map = buildExtractSettledMap({
      extractDocKeys: ['extract:1', 'extract:2'],
      openInvoices: [{ docKey: 'extract:2', settledMinor: 100_000 }],
      extractDues: new Map([['extract:1', 500_000], ['extract:2', 500_000]]),
      vouchers: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 500_000 }] }],
    })
    expect(map.get('extract:1')).toBe(500_000)
    expect(map.get('extract:2')).toBe(100_000)
  })

  it('③ مستخلص سُدّد بشيك (توزيع FIFO بلا سجل صريح) يُحتسب بصافي استحقاقه', () => {
    const map = buildExtractSettledMap({
      extractDocKeys: ['extract:1'], openInvoices: [],
      extractDues: new Map([['extract:1', 700_000]]),
    })
    expect(map.get('extract:1')).toBe(700_000)
  })

  it('④ بلا دفتر عميل لا يُفترض السداد — التوزيعات الصريحة وحدها', () => {
    const map = buildExtractSettledMap({
      extractDocKeys: ['extract:1', 'extract:2'], openInvoices: [],
      clientSettlements: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 40_000 }] }],
    })
    expect(map.get('extract:1')).toBe(40_000)
    expect(map.has('extract:2')).toBe(false)
  })

  it('⑤ سند/تسوية يخصّان مستندات أخرى لا يظهران في تحصيلات المشروع', () => {
    const r = buildCollectionRows(base({
      vouchers: [{ date: '2026-02-10', number: 'RV-OTHER', amountMinor: 900_000_00, allocations: [{ docKey: 'sale:9', appliedMinor: 900_000_00 }] }],
      clientSettlements: [{ date: '2026-03-05', number: 'SET-NONE', amountMinor: 500_000_00, allocations: [] }],
      cheques: [],
    }))
    expect(r.rows.some((x) => x.number === 'RV-OTHER')).toBe(false)
    expect(r.rows.some((x) => x.number === 'SET-NONE')).toBe(false)
  })

  it('⑥ سند موزّع على المشروع وغيره يظهر بنصيب المشروع فقط', () => {
    const r = buildCollectionRows(base({
      vouchers: [{ date: '2026-02-10', number: 'RV-2', amountMinor: 100_000, allocations: [
        { docKey: 'extract:1', appliedMinor: 30_000 }, { docKey: 'sale:9', appliedMinor: 70_000 },
      ] }],
      clientSettlements: [], cheques: [],
    }))
    expect(r.rows.find((x) => x.number === 'RV-2')?.amountMinor).toBe(30_000)
  })

  it('⑦ «المحصَّل» في التقرير يساوي خريطة الذمم لا ضعفها', () => {
    const settled = buildExtractSettledMap({
      extractDocKeys: ['extract:1', 'extract:2'],
      openInvoices: [{ docKey: 'extract:1', settledMinor: 565_000_00 }],
      vouchers: [{ allocations: [{ docKey: 'extract:1', appliedMinor: 565_000_00 }] }],
    })
    const m = buildAnalyticalProjectReport(base({ openInvoiceSettled: settled, cheques: [], clientSettlements: [], vouchers: [] }))
    const collected = m.indicators?.find((i) => i.label === 'إجمالي ما تم تحصيله')?.value
    expect(collected).toBe(fmt(565_000_00))
    const remaining = m.indicators?.find((i) => i.label === 'المتبقي من التحصيل')?.value
    expect(remaining).toBe(fmt(1_780_000_00 - 565_000_00))
  })

  it('⑧ القيمة الثانوية (اسم الطرف) تصل إلى النسخة المطبوعة', () => {
    const m = buildAnalyticalProjectReport(base({
      expenses: [{ date: '2026-02-05', docNumber: 'EXP-1', description: 'حديد', party: 'شركة الحديد', amountMinor: 100_00, category: 'مواد' }],
    }))
    expect(formalReportBodyHtml(m)).toContain('شركة الحديد')
  })
})
