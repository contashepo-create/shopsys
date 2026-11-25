import { beforeEach, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => ({ canvas: vi.fn(), addImage: vi.fn(), addPage: vi.fn(), save: vi.fn() }))
vi.mock('html2canvas', () => ({ default: calls.canvas }))
vi.mock('jspdf', () => ({ jsPDF: class { addImage = calls.addImage; addPage = calls.addPage; save = calls.save } }))
import { exportLetterCanvasPdf } from '../src/ui/pages/letterCanvasPdf.ts'
beforeEach(() => { vi.clearAllMocks(); calls.canvas.mockResolvedValue({ toDataURL: () => 'data:image/jpeg;base64,abc' }) })
it('يلتقط كل صفحة مستقلة ويضيف صفحة PDF ثانية ويحذف حدود التحديد من نسخة التصوير', async () => {
 const a = document.createElement('div'), b = document.createElement('div')
 await exportLetterCanvasPdf([a, b], 'test.pdf')
 expect(calls.canvas).toHaveBeenCalledTimes(2); expect(calls.canvas.mock.calls[0][0]).toBe(a); expect(calls.canvas.mock.calls[1][0]).toBe(b)
 expect(calls.addPage).toHaveBeenCalledOnce(); expect(calls.addImage).toHaveBeenCalledTimes(2); expect(calls.save).toHaveBeenCalledWith('test.pdf')
 const cloned = document.implementation.createHTMLDocument(''); cloned.body.innerHTML = '<div class="letters-canvas-item is-selected"></div>'
 calls.canvas.mock.calls[0][1].onclone(cloned)
 expect(cloned.querySelector('.is-selected')).toBeNull()
})
it('لا يحفظ ملفاً ناقصاً إذا فشل التقاط أي صفحة', async () => {
 calls.canvas.mockResolvedValueOnce({ toDataURL: () => 'data:image/jpeg;base64,abc' }).mockRejectedValueOnce(new Error('canvas failed'))
 await expect(exportLetterCanvasPdf([document.createElement('div'), document.createElement('div')], 'test.pdf')).rejects.toThrow('canvas failed')
 expect(calls.save).not.toHaveBeenCalled()
})
it('يستبدل حقول التحرير بنصوصها ويزيل الأدوات في نسخة PDF فقط', async () => {
 const page = document.createElement('div')
 await exportLetterCanvasPdf([page], 'table.pdf')
 const cloned = document.implementation.createHTMLDocument('')
 cloned.body.innerHTML = '<div class="letters-canvas-item is-selected"><div class="letters-item-tools">أدوات</div><table><tbody><tr><td><textarea class="letters-table-cell-edit">قيمة</textarea></td></tr></tbody></table></div>'
 calls.canvas.mock.calls[0][1].onclone(cloned)
 expect(cloned.querySelector('.letters-table-cell-edit')).toBeNull(); expect(cloned.querySelector('.letters-item-tools')).toBeNull(); expect(cloned.querySelector('td')?.textContent).toBe('قيمة')
})
