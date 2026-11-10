import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { applyPreviewScale } from '../src/ui/print/previewScale.ts'
import { usePrintPreview } from '../src/ui/components/printPreviewStore.ts'

const print = vi.hoisted(() => vi.fn())
vi.mock('../src/ui/print/printReceipt.ts', () => ({ printHtml: print }))
const { ThermalPreview } = await import('../src/ui/components/ThermalPreview.tsx')
afterEach(() => { cleanup(); usePrintPreview.getState().closePreview(); print.mockClear() })
it('يضيف المقياس للوثيقة دون حذف أو قص المحتوى ويقيده في المجال الآمن', () => {
 const source = '<html><head><title>فاتورة</title></head><body>بند أول وبند أخير</body></html>'
 expect(applyPreviewScale(source, 100)).toBe(source)
 expect(applyPreviewScale(source, 75)).toContain('zoom: 75%')
 expect(applyPreviewScale(source, 75)).toContain('بند أول وبند أخير')
 expect(applyPreviewScale(source, 1)).toContain('zoom: 40%')
 expect(applyPreviewScale(source, 500)).toContain('zoom: 120%')
})
it('الشريط يغير المعاينة ونفس النسبة تذهب للطباعة ثم يعاد الضبط للمستند التالي', async () => {
 render(<MemoryRouter><ThermalPreview /></MemoryRouter>)
 act(() => { usePrintPreview.getState().openPreview({ html: '<html><head></head><body>بيانات حية</body></html>', wide: true }) })
 fireEvent.change(screen.getByLabelText('مقياس الطباعة'), { target: { value: '70' } })
 await waitFor(() => expect((screen.getByTitle('معاينة المستند') as HTMLIFrameElement).contentDocument?.documentElement.innerHTML).toContain('zoom: 70%'))
 fireEvent.click(document.querySelector('[data-thermal-print]')!)
 expect(print).toHaveBeenCalledOnce(); expect(print.mock.calls[0][0]).toContain('zoom: 70%'); expect(print.mock.calls[0][0]).toContain('بيانات حية')
 act(() => { usePrintPreview.getState().openPreview({ html: '<html><head></head><body>آخر</body></html>', wide: true }) })
 expect((screen.getByLabelText('مقياس الطباعة') as HTMLInputElement).value).toBe('100')
})
