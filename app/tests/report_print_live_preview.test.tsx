/**
 * انحدارات «المراجعة الأدق» على التقارير الرسمية والمعاينة الحية — 2026-10-27.
 * وجدت المراجعة أن:
 *  · نافذة المعاينة لا تُعاد بناؤها عند تغيير `reportPrint` (تُراقب receipt فقط).
 *  · `printHtml` التلقائي لا يمرّر rebuild ⇒ عشرات التقارير تبقى لقطة قديمة.
 *  · `buildHtml` في FormalReport يلتقط إعدادات لحظة الضغط لا لحظة التغيير.
 *  · متغيّر الوحدة styleInjected يمنع إعادة حقن CSS بعد تنظيف document.head.
 */
import { describe, expect, it, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import {
  DEFAULT_REPORT_PRINT, renderReportShell, rebuildReportShellHtml,
  registerReportPrintSettingsProvider, freshReportPrintSettings,
  type ReportPrintSettings,
} from '../src/core/reportPrint.ts'
import { printHtml } from '../src/ui/print/printReceipt.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import { useAppStore } from '../src/stores/app.store.ts'
import { FormalReport } from '../src/ui/components/FormalReport.tsx'
import type { FormalReportModel } from '../src/core/formalReport.ts'

const args = {
  title: 'تقرير اختبار',
  subtitle: 'فترة الاختبار',
  companyName: 'شركة الاختبار',
  headerLines: ['العنوان الأول', 'الهاتف: 123'],
  bodyHtml: '<p>محتوى التقرير</p>',
}

afterEach(() => {
  cleanup()
  usePrintPreview.getState().closePreview()
  registerReportPrintSettingsProvider(() => useAppStore.getState().reportPrint ?? DEFAULT_REPORT_PRINT)
})

describe('المعاينة الحية لإعدادات التقارير', () => {
  it('rebuildReportShellHtml يعيد بناء الغلاف بإعدادات جديدة ويحافظ على الجسم', () => {
    const html = renderReportShell({ ...args, settings: DEFAULT_REPORT_PRINT })
    expect(html).toContain('العنوان الأول')
    const changed: ReportPrintSettings = { ...DEFAULT_REPORT_PRINT, accentColor: '#abcdef', baseFontPt: 20, showSignatures: true }
    const rebuilt = rebuildReportShellHtml(html, changed)
    expect(rebuilt).toBeTruthy()
    expect(rebuilt).toContain('#abcdef')
    expect(rebuilt).toContain('font-size:20px')
    expect(rebuilt).toContain('محتوى التقرير')
    expect(rebuilt).toContain('اعتماد') // توقيعات ظهرت بعد التغيير
    expect(html).not.toContain('#abcdef') // الأصل لم يتغير
  })

  it('إعادة البناء المتكررة لا تُزيح الغلاف الأصلي من السجل', () => {
    const html = renderReportShell({ ...args, settings: DEFAULT_REPORT_PRINT })
    for (let i = 0; i < 25; i++) {
      const color = `#${(0x100000 + i * 0x010101).toString(16).padStart(6, '0')}`
      const next = rebuildReportShellHtml(html, { ...DEFAULT_REPORT_PRINT, accentColor: color, baseFontPt: 12 + (i % 8) })
      expect(next).toContain(color)
    }
    /* بعد أكثر من حدّ الذاكرة (16) يظل المفتاح الأصلي صالحاً */
    expect(rebuildReportShellHtml(html, { ...DEFAULT_REPORT_PRINT, accentColor: '#00ff00' })).toContain('#00ff00')
  })

  it('HTML غير مسجّل ⇒ rebuild يعيد null بأمان', () => {
    expect(rebuildReportShellHtml('<html><body>x</body></html>', DEFAULT_REPORT_PRINT)).toBeNull()
  })

  it('printHtml التلقائي يمرّر rebuild حيّاً يقرأ إعدادات المتجر وقت التغيير', () => {
    let live: ReportPrintSettings = { ...DEFAULT_REPORT_PRINT, accentColor: '#111111' }
    registerReportPrintSettingsProvider(() => live)
    expect(freshReportPrintSettings()?.accentColor).toBe('#111111')
    const html = renderReportShell({ ...args, settings: live })
    printHtml(html)
    const handle = usePrintPreview.getState().handle
    expect(handle).toBeTruthy()
    expect(typeof handle?.rebuild).toBe('function')
    live = { ...live, accentColor: '#ff0000', showSignatures: true }
    const rebuilt = handle?.rebuild?.() ?? ''
    expect(rebuilt).toContain('#ff0000')
    expect(rebuilt).toContain('اعتماد')
  })

  it('يبقى التقرير المفتوح قابلاً للتحديث بعد إنتاج تقارير أخرى تتجاوز حد الذاكرة', () => {
    let live: ReportPrintSettings = { ...DEFAULT_REPORT_PRINT, accentColor: '#111111' }
    registerReportPrintSettingsProvider(() => live)
    const html = renderReportShell({ ...args, settings: live })
    printHtml(html)
    for (let i = 0; i < 20; i++) renderReportShell({ ...args, title: `تقرير آخر ${i}`, settings: live })
    live = { ...live, accentColor: '#ee2222' }
    usePrintPreview.getState().refresh()
    expect(usePrintPreview.getState().handle?.html).toContain('#ee2222')
    expect(usePrintPreview.getState().handle?.html).toContain('محتوى التقرير')
  })

  it('FormalReport: إعادة حقن CSS بعد إزالة العنصر من head', () => {
    const model: FormalReportModel = {
      title: 'تقرير رسمي', subtitle: 'اختبار', companyName: 'شركة', meta: [],
      indicators: [], sections: [], headerLines: ['سطر ترويسة'],
    }
    const { rerender, container } = render(<FormalReport model={model} />)
    expect(document.head.querySelector('style[data-formal-report-css]')).toBeTruthy()
    expect(container.textContent).toContain('سطر ترويسة')
    /* محاكاة تنظيف head بين اختبارين/شاشتين — المتغيّر القديم كان يبقى true */
    document.head.querySelector('style[data-formal-report-css]')?.remove()
    expect(document.head.querySelector('style[data-formal-report-css]')).toBeNull()
    rerender(<FormalReport model={{ ...model, subtitle: 'اختبار 2' }} />)
    expect(document.head.querySelector('style[data-formal-report-css]')).toBeTruthy()
    expect(document.head.querySelectorAll('style[data-formal-report-css]')).toHaveLength(1)
  })

  it('FormalReport: الترويسة نفسها على الشاشة وفي HTML الطباعة', () => {
    const model: FormalReportModel = {
      title: 'تقرير رسمي', subtitle: 'اختبار', companyName: 'شركة الحديد', meta: [],
      indicators: [], sections: [], headerLines: ['المنطقة الصناعية'], logoDataUrl: undefined,
      printedBy: 'المحاسب',
    }
    const { container } = render(<FormalReport model={model} />)
    expect(container.textContent).toContain('المنطقة الصناعية')
    expect(container.textContent).toContain('أعدّه: المحاسب')
    fireEvent.click(screen.getByText(/معاينة وطباعة/))
    const html = usePrintPreview.getState().handle?.html ?? ''
    expect(html).toContain('المنطقة الصناعية')
    expect(html).toContain('شركة الحديد')
    expect(html).toContain('class="rp-hl"')
  })
})
