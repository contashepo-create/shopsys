/**
 * انحدارات «الجولة السادسة — مراجعة أدق» (2026-10-27/28).
 * كل حالة هنا أثبتت فشلها فعلياً قبل الإصلاح:
 *  H1/H2/H3  تصدير Excel كان ناقصاً (يفقد الملخص/التسوية/البيانات/القيمة
 *            الثانوية/صفوف الإجمالي) ويكتب BOM مرتين.
 *  H4        سند قبض قديم بلا توزيعات كان يُحتسب كاملاً في كل مشروع للعميل.
 *  H5        الصفوف المؤكدة على الشاشة كانت تفقد إبرازها في النسخة المطبوعة.
 *  H6/H7     الشعار/اللون/علامات التنصيص كانت تُحقن خاماً في HTML/CSS المطبوع.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { FormalReport } from '../src/ui/components/FormalReport.tsx'
import {
  DEFAULT_REPORT_PRINT, escAttr, escHtml, htmlTableHtml, renderReportShell,
  safeHexColor, safeLogoUrl,
} from '../src/core/reportPrint.ts'
import { renderFormalReportHtml } from '../src/core/formalReport.ts'
import type { FormalReportModel } from '../src/core/formalReport.ts'
import { buildCollectionRows, buildAnalyticalProjectReport, type AnalyticalProjectSource } from '../src/core/analyticalProjectReport.ts'
import { renderLabReportHtml } from '../src/ui/print/printLabReport.ts'
import { DEFAULT_RECEIPT_SETTINGS } from '../src/core/receipt.ts'

const fmt = (m: number) => String(m)
const model: FormalReportModel = {
  title: 'تقرير متابعة مشروع', subtitle: 'مشروع · P1',
  companyName: 'شركة', printedBy: 'المحاسب',
  meta: [{ label: 'اسم المشروع', value: 'مشروع A' }, { label: 'العميل', value: 'عميل B' }],
  indicators: [{ label: 'قيمة العقد', value: '1,000' }],
  sections: [{
    title: 'أولاً — المصروفات', headers: ['البيان', 'المبلغ'], numCols: [1],
    rows: [{ cells: [{ value: 'حديد', sub: 'مورد الشمال' }, '500'] }],
    totalRow: ['إجمالي', '500'],
  }],
  notes: ['ملاحظة مراجعة مهمة'],
  equation: [{ label: 'صافي النتيجة', value: '500', emphasis: true }],
}

function src(over: Partial<AnalyticalProjectSource> = {}): AnalyticalProjectSource {
  return {
    project: { code: 'P1', nameAr: 'مشروع', clientName: 'عميل', status: 'جارٍ', startDate: '2026-01-01', contractValueMinor: 1000 },
    extracts: [{ extractNumber: 'E1', date: '2026-02-01', grossMinor: 1000, vatMinor: 0, retentionMinor: 0, dueMinor: 1000, payment: 'credit' }],
    expenses: [], extractDocKeys: ['extract:1'], openInvoiceSettled: new Map(),
    currencySymbol: 'ج.م', companyName: 'شركة', fmt,
    ...over,
  }
}

/** يضغط زر التصدير ويعيد البايتات والنص كما سيصلان للمستخدم */
async function exportedCsv(): Promise<{ text: string; bytes: Uint8Array }> {
  let text = ''
  let bytes = new Uint8Array()
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      void blob.text().then((t) => { text = t })
      void blob.arrayBuffer().then((b) => { bytes = new Uint8Array(b) })
      return 'blob:test'
    },
    revokeObjectURL: () => {},
  })
  render(<FormalReport model={model} filename="x" />)
  fireEvent.click(screen.getByText(/تصدير Excel/))
  await new Promise((r) => setTimeout(r, 25))
  return { text, bytes }
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('الجولة السادسة — اكتمال تصدير التقرير الرسمي', () => {
  it('H1) التصدير يحمل بيانات المستند والملخص والتسوية والملاحظات وصف الإجمالي', async () => {
    const { text } = await exportedCsv()
    expect(text).toContain('اسم المشروع')
    expect(text).toContain('مشروع A')
    expect(text).toContain('قيمة العقد')
    expect(text).toContain('صافي النتيجة')
    expect(text).toContain('ملاحظة مراجعة مهمة')
    expect(text).toContain('— الإجمالي')
    expect(text).toContain('تقرير متابعة مشروع')
  })

  it('H2) ملف CSV يحوي BOM واحداً فقط', async () => {
    const { bytes } = await exportedCsv()
    let boms = 0
    for (let i = 0; i + 2 < bytes.length; i += 1) {
      if (bytes[i] === 0xEF && bytes[i + 1] === 0xBB && bytes[i + 2] === 0xBF) boms += 1
    }
    expect(boms).toBe(1)
  })

  it('H3) التصدير يحفظ القيمة الثانوية (اسم المورد) كما في الشاشة والطباعة', async () => {
    const { text } = await exportedCsv()
    expect(text).toContain('مورد الشمال')
  })

  it('H1b) التصدير لا يضع رأس أعمدة فارغاً ولا يفقد ترتيب الأعمدة الأصلية', async () => {
    const { text } = await exportedCsv()
    expect(text.split('\n')[0]).toContain('القسم')
    expect(text.split('\n')[0]).toContain('البيان')
    expect(text.split('\n')[0]).toContain('المبلغ')
  })
})

describe('الجولة السادسة — سلامة أرقام الدفتر التحليلي', () => {
  it('H4) سند قبض بلا توزيعات لا يُنسب للمشروع ويُذكر في الملاحظات', () => {
    const base = src({
      vouchers: [{ date: '2026-03-01', number: 'RV-OLD', amountMinor: 900, description: 'سند قديم بلا توزيع' }],
    })
    const collections = buildCollectionRows(base)
    expect(collections.rows.find((r) => r.number === 'RV-OLD')).toBeUndefined()
    expect(collections.unattributedVouchers).toBe(1)
    expect(collections.unattributedVoucherMinor).toBe(900)
    const report = buildAnalyticalProjectReport(base)
    expect(report.notes?.some((n) => n.includes('سندات قبض غير موزّعة'))).toBe(true)
  })

  it('H4b) سند موزّع على مستخلص المشروع يظل محسوباً بنصيبه', () => {
    const rows = buildCollectionRows(src({
      vouchers: [{ date: '2026-03-01', number: 'RV-NEW', amountMinor: 900, allocations: [{ docKey: 'extract:1', appliedMinor: 400 }] }],
    })).rows
    expect(rows.find((r) => r.number === 'RV-NEW')?.amountMinor).toBe(400)
  })

  it('H5) الصفوف المؤكدة تُبرز في النسخة المطبوعة', () => {
    const html = renderFormalReportHtml(model, DEFAULT_REPORT_PRINT)
    expect(html).toMatch(/<tr class="total"><td>صافي النتيجة<\/td>/)
    /* إبراز صفوف المؤشرات أيضاً */
    const indicatorRow = /<tr class="total"><td>قيمة العقد<\/td>/.test(html)
    expect(indicatorRow).toBe(false) // المؤشر غير مؤكّد في النموذج ⇒ لا يُبرز
  })

  it('H5b) htmlTableHtml يرفض أصناف صفوف غير مدرجة في القائمة البيضاء', () => {
    const html = htmlTableHtml({ headers: ['ع'], rows: [['نص']], rowClasses: ['total" onclick="alert(1)'] })
    expect(html).not.toContain('onclick')
    expect(html).toContain('<tr><td>نص</td></tr>')
  })
})

describe('الجولة السادسة — تهريب قوالب الطباعة', () => {
  it('H6) الشعار المخرب واللون المخرب لا يحقنان HTML/CSS في الغلاف', () => {
    const html = renderReportShell({
      title: 'تقرير', subtitle: 'فترة', companyName: 'شركة',
      logoDataUrl: 'x" onerror="alert(1)', bodyHtml: '<p>محتوى</p>',
      settings: { ...DEFAULT_REPORT_PRINT, accentColor: '#000;} body{background:url(javascript:alert(2))} /*' },
    })
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).not.toContain('javascript:alert(2)')
    expect(html).toContain('#0f172a') // لون آمن بديل
  })

  it('H6b) شعار PNG شرعي يمرّ، وjavascript:/svg/data:text/html تُرفض', () => {
    expect(safeLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toContain('data:image/png;base64,')
    expect(safeLogoUrl('javascript:alert(1)')).toBe('')
    expect(safeLogoUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe('')
    expect(safeLogoUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe('')
    expect(safeLogoUrl('https://example.com/logo.png')).toBe('https://example.com/logo.png')
  })

  it('H6c) safeHexColor يوسّع #abc ويرفض أي حقن', () => {
    expect(safeHexColor('#abc')).toBe('#aabbcc')
    expect(safeHexColor('#A1B2C3')).toBe('#a1b2c3')
    expect(safeHexColor('red;}</style><script>x</script>')).toBe('#0f172a')
  })

  it('H6d) قالب تقرير المختبر يهرّب شعاره ولونه أيضاً', () => {
    const settings = {
      ...DEFAULT_RECEIPT_SETTINGS,
      showLogo: true, logoDataUrl: 'x" onerror="alert(1)',
      accentColor: '#000;}body{background:url(javascript:alert(2))}/*',
      showHeaderLines: false, headerLines: [], watermarkEnabled: false, watermarkText: '',
    }
    const html = renderLabReportHtml(
      { orderNumber: 'L-1', patientName: 'مريض اختبار', date: '2026-01-01', tests: [] } as never,
      null, null, settings,
    )
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).not.toContain('javascript:alert(2)')
  })

  it('H7) escAttr يهرّب علامات التنصيص في السمات، وescHtml يحفظها مقروءة في النصوص', () => {
    expect(escAttr('a"b\'c<d&e')).toBe('a&quot;b&#39;c&lt;d&amp;e')
    expect(escHtml('a"b\'c<d&e')).toBe('a"b\'c&lt;d&amp;e')
  })

  it('H7b) التهريب لا يكسر قيماً عربية ونصوصاً عادية', () => {
    expect(escHtml('شركة الأفق — المنصورة')).toBe('شركة الأفق — المنصورة')
    expect(escAttr('شركة الأفق — المنصورة')).toBe('شركة الأفق — المنصورة')
  })
})
