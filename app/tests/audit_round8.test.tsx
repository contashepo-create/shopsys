import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { buildCollectionRows, type AnalyticalProjectSource } from '../src/core/analyticalProjectReport.ts'
import { projectOpenBalances } from '../src/core/projectReportBalances.ts'
import { toCsv } from '../src/core/security.ts'
import { FormalReport } from '../src/ui/components/FormalReport.tsx'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'
import type { FormalReportModel } from '../src/core/formalReport.ts'

const source = (overrides: Partial<AnalyticalProjectSource> = {}): AnalyticalProjectSource => ({
  project: { code: 'p', nameAr: 'مشروع', clientName: 'عميل', status: 'نشط', startDate: '2026-01-01', contractValueMinor: 1000 },
  extracts: [], expenses: [], extractDocKeys: [], openInvoiceSettled: new Map(), companyName: 'شركة', currencySymbol: 'ج', fmt: String, ...overrides,
})
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); vi.restoreAllMocks() })

describe('مراجعة سلوكية للحالات الحدية', () => {
  it('مستخلص غير مرتبط بدفتر العميل لا يعتبر مسدداً والمقاصة تخصم من رصيده', () => {
    const result = projectOpenBalances([{ id: 1, clientId: 10 }], [
      { id: 2, projectId: 1, payment: 'credit', totals: { dueMinor: 1000 }, advanceRecoveryMinor: 300 },
    ], () => [])
    expect(result.get(1)).toBe(700)
  })
  it('مشروع بلا مستخلصات لا ينسب إليه سنداً أو تسوية لعميل مشترك', () => {
    const result = buildCollectionRows(source({
      vouchers: [{ date: '2026-01-02', number: 'v', amountMinor: 500, allocations: [{ docKey: 'sale:1', appliedMinor: 500 }] }],
      clientSettlements: [{ date: '2026-01-03', number: 's', amountMinor: 200, allocations: [{ docKey: 'extract:2', appliedMinor: 200 }] }],
    }))
    expect(result.rows).toHaveLength(0)
    expect(result.totalMinor).toBe(0)
  })
  it('تاريخ الشيك المحتسب هو تاريخ استلامه لا تاريخ تحصيل الورقة بالبنك', () => {
    const result = buildCollectionRows(source({ extractDocKeys: ['extract:1'], chequeAttributedMinor: 100,
      cheques: [{ direction: 'incoming', partyId: 1, status: 'collected', amountMinor: 100, chequeNumber: 'c', createdAt: '2026-01-02T00:00:00Z', settledAt: '2026-03-05T00:00:00Z' }] }))
    expect(result.rows[0]?.date).toBe('2026-01-02')
  })
  it('رؤوس CSV التي تحوي فواصل وتنصيص تُقتبس مثل بقية الخلايا', () => {
    const csv = toCsv([{ 'قسم, "تفاصيل"': '100', 'مبلغ': '200' }])
    expect(csv).toContain('"قسم, ""تفاصيل""",مبلغ\n100,200')
  })
  it('تصدير قسم بعناوين مكررة يحتفظ بقيم كل عمود', () => {
    let csv = ''
    const RealBlob = globalThis.Blob
    vi.spyOn(globalThis, 'Blob').mockImplementation(function (parts: BlobPart[]) {
      csv = String(parts[0] ?? '')
      return new RealBlob(parts)
    } as unknown as typeof Blob)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const model: FormalReportModel = { title: 'تقرير', subtitle: '', companyName: 'شركة', meta: [],
      sections: [{ title: 'قسم', headers: ['مبلغ', 'مبلغ'], rows: [{ cells: ['100', '200'] }] }] }
    render(<FormalReport model={model} />)
    fireEvent.click(screen.getByText(/تصدير/))
    expect(csv).toContain('قسم [1] · مبلغ [1]')
    expect(csv).toContain('قسم [1] · مبلغ [2]')
    expect(csv).toContain('100,200')
  })
  it('خاصية showSignatures تطبق على الشاشة والمعاينة بنفس الأولوية', () => {
    const model: FormalReportModel = { title: 'تقرير', subtitle: '', companyName: 'شركة', meta: [], sections: [], signatures: false }
    const { container } = render(<FormalReport model={model} showSignatures />)
    expect(container.querySelector('.fr-sign')).not.toBeNull()
    fireEvent.click(screen.getByText(/معاينة وطباعة/))
    expect(usePrintPreview.getState().handle?.html).toContain('اعتماد')
  })
})
