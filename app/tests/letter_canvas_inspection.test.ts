import { expect, it, vi } from 'vitest'
import { inspectLetterCanvas } from '../src/ui/pages/letterCanvasInspection.ts'

function rect(left: number, top: number, width: number, height: number): DOMRect {
 return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}
it('يحدد أزواج العناصر المتداخلة والعناصر الخارجة في صفحة واحدة دون عدّ الخط الزخرفي', () => {
 const page = document.createElement('div')
 page.innerHTML = '<div data-letter-box="date"></div><div data-letter-box="subject"></div><div data-letter-box="logo"></div><div data-letter-box="bottomRule" class="letters-canvas-line"></div><div data-letter-box="empty"></div>'
 vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 200, 300))
 const nodes = [...page.children] as HTMLElement[]
 ;[rect(10, 10, 50, 20), rect(20, 20, 50, 20), rect(180, 270, 30, 40), rect(10, 10, 100, 20), rect(0, 0, 0, 0)].forEach((r, i) => vi.spyOn(nodes[i], 'getBoundingClientRect').mockReturnValue(r))
 expect(inspectLetterCanvas(page)).toEqual([{ kind: 'overlap', key: 'date', other: 'subject' }, { kind: 'outside', key: 'logo' }])
})
it('يسمح بالتماس ويتسامح مع فرق بكسل واحد ولا يخلط محتوى الصفحات', () => {
 const page = document.createElement('div')
 page.innerHTML = '<div data-letter-box="date"></div><div data-letter-box="subject"></div>'
 vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 200, 300))
 vi.spyOn(page.children[0], 'getBoundingClientRect').mockReturnValue(rect(0, 0, 20, 20))
 vi.spyOn(page.children[1], 'getBoundingClientRect').mockReturnValue(rect(19, 0, 181, 20))
 expect(inspectLetterCanvas(page)).toEqual([])
})

it('يحذر عندما يعبر الخط الفاصل نصاً أو بيانات ويقيس نهاية الترويسة المرئية', async () => {
 const { measureLetterHeaderBottom } = await import('../src/ui/pages/letterCanvasInspection.ts')
 const page = document.createElement('div')
 page.innerHTML = '<div data-letter-box="headerAddress"></div><div data-letter-box="subject"></div><div data-letter-box="topRule" class="letters-canvas-line"></div>'
 vi.spyOn(page, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 210, 297))
 vi.spyOn(page.children[0], 'getBoundingClientRect').mockReturnValue(rect(110, 25, 60, 5))
 vi.spyOn(page.children[1], 'getBoundingClientRect').mockReturnValue(rect(110, 28, 60, 8))
 vi.spyOn(page.children[2], 'getBoundingClientRect').mockReturnValue(rect(15, 28.5, 180, 2))
 expect(measureLetterHeaderBottom(page)).toBe(30)
 expect(inspectLetterCanvas(page)).toContainEqual({ kind: 'overlap', key: 'headerAddress', other: 'topRule' })
 expect(inspectLetterCanvas(page)).toContainEqual({ kind: 'overlap', key: 'subject', other: 'topRule' })
})
