/**
 * إثبات أخطاء الجولة السابعة (مراجعة سطر بسطر لكل تعديلات الجلسة).
 * هذه الاختبارات مُصمَّمة لتفشل قبل الإصلاح — تُحوَّل لاختبارات انحدار بعده.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildAnalyticalProjectReport, buildCollectionRows, buildExtractSettledMap, type AnalyticalProjectSource } from '../src/core/analyticalProjectReport.ts'
import { formalReportBodyHtml, type FormalReportModel } from '../src/core/formalReport.ts'
import { registerNavigationGuard } from '../src/ui/components/navigationGuard.ts'
import { useWindowStore } from '../src/ui/windows/windowStore.ts'

const fmt = (m: number) => String(m)
const base = (over: Partial<AnalyticalProjectSource> = {}): AnalyticalProjectSource => ({
  project: { code: 'P1', nameAr: 'مشروع', clientName: 'عميل', status: 'جارٍ', startDate: '2026-01-01', contractValueMinor: 1000 },
  extracts: [{ extractNumber: 'E1', date: '2026-02-01', grossMinor: 1000, retentionMinor: 0, dueMinor: 1000, payment: 'credit' }],
  expenses: [], currencySymbol: 'ج.م', companyName: 'شركة', fmt,
  openInvoiceSettled: new Map([['extract:1', 0]]), extractDocKeys: ['extract:1'],
  ...over,
})

const readSrc = (p: string) => readFileSync(`${process.cwd()}/src/${p}`, 'utf8')

describe('الجولة السابعة — أخطاء مثبتة', () => {
  afterEach(() => { vi.restoreAllMocks() })

  /* ── P2: استنتاج سداد كامل بلا دليل مرتبط بهذا المستخلص ── */
  it('P2: شيك لعميل موزّع على فاتورة أخرى لا يُسدّد مستخلص المشروع كاملاً', () => {
    const settled = buildExtractSettledMap({
      extractDocKeys: ['extract:1'],
      openInvoices: [],                       // المستخلص غائب عن الدفتر المفتوح
      extractDues: new Map([['extract:1', 1000]]),
      hasSettlementEvidence: true,            // يوجد شيك للعميل لكنه يخص مستنداً آخر
      fullLedger: true,                       // الإنتاج يقرأ الدفتر كاملاً ⇒ settledMinor الحقيقي = 0
    } as Parameters<typeof buildExtractSettledMap>[0])
    expect(settled.get('extract:1') ?? 0).toBe(0)
  })

  it('P2b: الدفتر الكامل يُعيد المستند المسدّد جزئياً بقيمته الحقيقية', () => {
    const settled = buildExtractSettledMap({
      extractDocKeys: ['extract:1'],
      openInvoices: [{ docKey: 'extract:1', settledMinor: 300 }],
      extractDues: new Map([['extract:1', 1000]]),
      hasSettlementEvidence: true,
      fullLedger: true,
    } as Parameters<typeof buildExtractSettledMap>[0])
    expect(settled.get('extract:1')).toBe(300)
  })

  /* ── P3: includeCheques=false يكسر اتساق التحصيلات ── */
  it('P3: استبعاد الشيكات من السطور يستبعدها من الهدف أيضاً', () => {
    const src = base({
      includeCheques: false,
      chequeAttributedMinor: 400,
      cheques: [{ direction: 'incoming', partyId: 1, status: 'held', amountMinor: 400, chequeNumber: 'C1', createdAt: '2026-03-01' }],
      openInvoiceSettled: new Map([['extract:1', 400]]),
    })
    const rows = buildCollectionRows(src)
    expect(rows.totalMinor).toBe(rows.targetMinor)
    const report = buildAnalyticalProjectReport(src)
    expect(report.notes?.some((n) => n.includes('تنبيه مراجعة'))).toBe(false)
  })

  /* ── P4: تصادم أسماء الأعمدة في تصدير CSV ── */
  it('P4: عمود «البيان» الوصفي لا يتشارك مع عمود «البيان» داخل جداول الأقسام', async () => {
    const { FormalReport } = await import('../src/ui/components/FormalReport.tsx')
    const { render, fireEvent, cleanup } = await import('@testing-library/react')
    let csv = ''
    const RealBlob = globalThis.Blob
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts: BlobPart[]) {
      csv = String(parts?.[0] ?? '')
      return new RealBlob(parts)
    } as unknown as typeof Blob)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const model: FormalReportModel = {
      title: 'تقرير', subtitle: 'فرعية', companyName: 'شركة', meta: [{ label: 'العميل', value: 'أحمد' }],
      indicators: [{ label: 'الإجمالي', value: '100' }],
      sections: [{ title: 'المصروفات', headers: ['البيان', 'القيمة'], rows: [{ cells: ['حديد', '500'] }] }],
      equation: [{ label: 'النتيجة', value: '500' }],
    }
    render(<FormalReport model={model} filename="x" />)
    fireEvent.click(document.querySelector('button') as HTMLButtonElement)
    const lines = csv.split(/\r?\n/)
    const header = (lines[0] ?? '').split(',')
    expect(header.filter((h) => h === 'البيان').length).toBeLessThanOrEqual(1)
    /* لا مفتاح عمود مكرر — وإلا لاختلطت قيمة مؤشر بقيمة مصروف */
    expect(new Set(header).size).toBe(header.length)
    expect(csv).toContain('حديد')
    expect(csv).toContain('500')
    /* قيمة العمود الجدولي تأتي في عمود مستقل عن عمود «القيمة» الوصفي */
    const valueIdx = header.indexOf('القيمة')
    const sectionRow = lines.find((l) => l.includes('حديد'))?.split(',') ?? []
    expect(sectionRow[valueIdx] ?? '').toBe('')
    expect(sectionRow.at(-1)).toBe('500')
    cleanup()
  })

  /* ── P5: حقل signatures في النموذج بلا أثر ── */
  it('P5: model.signatures يُظهر خانات التوقيع على الشاشة', async () => {
    const { FormalReport } = await import('../src/ui/components/FormalReport.tsx')
    const { render, cleanup } = await import('@testing-library/react')
    const model: FormalReportModel = {
      title: 'ت', subtitle: 'س', companyName: 'ش', meta: [], sections: [], signatures: true,
    }
    const { container } = render(<FormalReport model={model} />)
    expect(container.querySelector('.fr-sign')).not.toBeNull()
    cleanup()
  })

  /* ── P9: حارس إغلاق تبويب مسار يبقى قائماً (عقد مُختبَر) ── */
  it('P9: إغلاق تبويب مسار يمرّ بحارس الصفحة المسجّل', () => {
    const st = useWindowStore.getState()
    const id = st.openTab({ path: '/reports/statements', title: 'كشف حساب' })
    expect(id).not.toBeNull()
    let intercepted = false
    const unregister = registerNavigationGuard((go) => { intercepted = true; go() })
    try {
      useWindowStore.getState().requestCloseTab(id!)
      expect(intercepted).toBe(true)
      expect(useWindowStore.getState().tabs.some((t) => t.id === id)).toBe(false)
    } finally { unregister() }
  })

  /* ── P10: نسبة تحصيل تتجاوز 100٪ ── */
  it('P10: نسبة التحصيل لا تتجاوز 100٪ ويظهر تنبيه عند تحصيل زائد', () => {
    const report = buildAnalyticalProjectReport(base({
      openInvoiceSettled: new Map([['extract:1', 1500]]),
    }))
    const pct = report.indicators?.find((i) => i.label === 'نسبة التحصيل')?.value ?? ''
    expect(Number(pct.replace(/[^\d.]/g, ''))).toBeLessThanOrEqual(100)
    expect(report.notes?.some((n) => n.includes('تحصيل زائد'))).toBe(true)
  })

  /* ── P13: قيمة ثانوية في صف الإجمالي تُسقط من الطباعة ── */
  it('P13: totalRow يحفظ القيمة الثانوية كما في الصفوف العادية', () => {
    const html = formalReportBodyHtml({
      title: 'ت', subtitle: 'س', companyName: 'ش', meta: [],
      sections: [{
        title: 'ق', headers: ['البيان', 'المبلغ'],
        rows: [{ cells: [{ value: 'حديد', sub: 'مورد الشمال' }, '100'] }],
        totalRow: [{ value: 'الإجمالي', sub: 'شامل الضريبة' }, '100'],
      }],
    })
    expect(html).toContain('شامل الضريبة')
  })

  /* ── P7: مسبار الاتصال يفشل بسبب CORS فيُتهم الإنترنت زوراً ── */
  it('P7: المسبار يثبت الاتصال حتى لو حجب CORS قراءة الجسم', async () => {
    const { probeSupportConnectivity } = await import('../src/core/support.ts')
    const original = globalThis.fetch
    ;(globalThis as { fetch: unknown }).fetch = vi.fn(async () => (
      { ok: false, status: 0, type: 'opaque' } as unknown as Response
    ))
    try {
      expect(await probeSupportConnectivity(100)).toBe(true)
    } finally {
      ;(globalThis as { fetch: unknown }).fetch = original
    }
  })

  /* ── P8: مضيف مخصص لا تُرسل رسائله لخوادم المطوّر العامة ── */
  it('P8: baseUrl مخصص لا تُضاف إليه خوادم عامة تلقائياً', async () => {
    const { supportBaseCandidates } = await import('../src/core/support.ts')
    const { LICENSE_CLOUD_BASE_URL } = await import('../src/core/cloud.ts')
    const candidates = supportBaseCandidates('https://support.my-company.example')
    expect(candidates).toEqual(['https://support.my-company.example'])
    expect(candidates).not.toContain(LICENSE_CLOUD_BASE_URL)
  })

  /* ── P1: iframe المعاينة بلا sandbox ── */
  it('P1: iframe المعاينة محمي بـ sandbox يمنع تنفيذ السكربتات', () => {
    const file = readSrc('ui/components/ThermalPreview.tsx')
    const iframes = [...file.matchAll(/<iframe\b[\s\S]*?\/>/g)].map((m) => m[0])
    expect(iframes.length).toBeGreaterThan(0)
    for (const tag of iframes) {
      expect(tag).toMatch(/sandbox=/)
      expect(tag).toMatch(/allow-same-origin/)
      expect(tag).not.toMatch(/allow-scripts/)
    }
  })

  /* ── P1b: صفحات المعاينة الجديدة تُهرّب بيانات المستخدم ── */
  it('P1b: كشف حركة الحساب وسجل السندات يهرّبان بيانات المستخدم في HTML', () => {
    for (const name of ['CoaPage.tsx', 'VouchersPage.tsx']) {
      expect(readSrc(`ui/pages/${name}`)).toMatch(/escHtml|escapeHtml|escapePrintText|esc\(/)
    }
  })

  /* ── P6: تكرار العنوان الفرعي على الشاشة ── */
  it('P6: الترويسة لا تعرض الفترة مرتين (داخلها وتحتها)', async () => {
    const { FormalReport } = await import('../src/ui/components/FormalReport.tsx')
    const { render, cleanup } = await import('@testing-library/react')
    const model: FormalReportModel = {
      title: 'تقرير', subtitle: 'المشروع · حتى 2026-10-28', period: 'حتى 2026-10-28',
      companyName: 'ش', meta: [], sections: [],
    }
    const { container } = render(<FormalReport model={model} />)
    const head = container.querySelector('.fr-head')?.textContent ?? ''
    const sub = container.querySelector('.fr-sub')?.textContent ?? ''
    expect(head.includes('حتى 2026-10-28') && sub.includes('حتى 2026-10-28')).toBe(false)
    cleanup()
  })

  /* ── P11: تاريخ التقرير لا يتجمد عند بقاء الشاشة مفتوحة ── */
  it('P11: تاريخ «حتى» يُحسب خارج useMemo أو يوضع في تبعياته', () => {
    const file = readSrc('ui/contracting/AnalyticalProjectReportView.tsx')
    const memoIdx = file.indexOf('const model = useMemo(')
    const depIdx = file.indexOf('}, [selected,', memoIdx)
    const body = file.slice(memoIdx, depIdx > memoIdx ? depIdx : undefined)
    expect(body).not.toContain('todayLocalIso()')
  })

  /* ── P12: silent print لا يُستبدل بمعاينة ── */
  it('P12: الطباعة الصامتة لا تفتح نافذة معاينة', () => {
    const file = readSrc('ui/print/printReceipt.ts')
    expect(file).toMatch(/directPrint/)
  })

  /* ── P14: iframe الطباعة النهائي محصّن أيضاً ── */
  it('P14: iframe الطباعة النهائي محصّن بلا صلاحية سكربتات', () => {
    const file = readSrc('ui/print/printReceipt.ts')
    expect(file).toMatch(/setAttribute\('sandbox', 'allow-same-origin allow-modals'\)/)
    expect(file).not.toMatch(/allow-scripts/)
  })

  /* ── P15: إعادة بناء المعاينة تقرأ أحدث نموذج لا لقطة لحظة الفتح ── */
  it('P15: rebuild يستخدم أحدث نموذج عند تغيّر بيانات التقرير والمعاينة مفتوحة', async () => {
    const { FormalReport } = await import('../src/ui/components/FormalReport.tsx')
    const { usePrintPreview } = await import('../src/ui/components/printPreviewStore.ts')
    const { render, fireEvent, cleanup } = await import('@testing-library/react')
    const mk = (sub: string): FormalReportModel => ({
      title: 'تقرير', subtitle: sub, companyName: 'ش', meta: [], sections: [],
    })
    const { rerender } = render(<FormalReport model={mk('قبل التعديل')} />)
    fireEvent.click(document.querySelector('[data-print-formal]') as HTMLButtonElement)
    const handle = usePrintPreview.getState().handle
    expect(handle?.html).toContain('قبل التعديل')
    rerender(<FormalReport model={mk('بعد التعديل')} />)
    expect(handle?.rebuild?.()).toContain('بعد التعديل')
    usePrintPreview.getState().closePreview()
    cleanup()
  })

  /* ── P16: تصادير CSV في الصفحات موحّد على toCsv ── */
  it('P16: تصادير الصفحات يستخدم toCsv ويؤجّل تحرير الرابط', () => {
    for (const name of ['CoaPage.tsx', 'VouchersPage.tsx', 'HrPage.tsx']) {
      const file = readSrc(`ui/pages/${name}`)
      expect(file).toMatch(/toCsv\(/)
      expect(file).toMatch(/setTimeout\(\(\) => URL\.revokeObjectURL/)
      expect(file).not.toMatch(/a\.click\(\);URL\.revokeObjectURL/)
    }
  })

  /* ── P17: الدفتر الكامل متاح للتقارير التحليلية ── */
  it('P17: getOpenClientInvoices يدعم includeSettled والعارض يستخدمه', () => {
    expect(readSrc('data/repo.ts')).toMatch(/getOpenClientInvoices: \(customerId, includeSettled\)/)
    const view = readSrc('ui/contracting/AnalyticalProjectReportView.tsx')
    expect(view).toMatch(/getOpenClientInvoices\(clientId, true\)/)
    expect(view).toMatch(/fullLedger: true/)
  })

  /* ── P18: نسبة التحصيل والتنبيه ── */
  it('P18: سقف نسبة التحصيل 100٪ مع تنبيه تحصيل زائد', () => {
    expect(readSrc('core/analyticalProjectReport.ts')).toMatch(/Math\.min\(100, Math\.round/)
    expect(readSrc('core/analyticalProjectReport.ts')).toMatch(/تحصيل زائد/)
  })
})
