/* ميزانية الارتفاع داخل نافذة الفاتورة: كم بكسلاً يفيض جسم المستند عن النافذة؟
   يقيس الوضعين (طريقة واحدة / تحصيل متعدد) في عدة مقاسات — الهدف: صفر فيض. */
import { open, selectQuick } from './lib.mjs'
const PORT = process.env.PORT || 5173
const SIZES = (process.env.SIZES ?? '1600x900,1366x768,1280x720,1024x680').split(',').map((s) => s.split('x').map(Number))

const measure = async (page) => page.evaluate(() => {
  const grid = document.querySelector('.invoice-doc .invoice-body-grid')
  const doc = document.querySelector('.invoice-doc')
  const panels = [...document.querySelectorAll('.invoice-doc-panel')]
  const lines = document.querySelector('.invoice-lines-column')
  const rowsBox = document.querySelector('.invoice-doc .invoice-lines-panel .overflow-x-auto')
  return {
    over: grid ? grid.scrollHeight - grid.clientHeight : -1,
    gridH: grid?.clientHeight ?? 0,
    linesH: Math.round(lines?.getBoundingClientRect().height ?? 0),
    rowsShown: rowsBox ? Math.round(rowsBox.clientHeight / 33) : 0,
    panelH: Math.round(Math.max(...panels.map((p) => p.getBoundingClientRect().height), 0)),
    headH: Math.round((grid?.getBoundingClientRect().top ?? 0) - (doc?.getBoundingClientRect().top ?? 0)),
    docH: Math.round(doc?.getBoundingClientRect().height ?? 0),
    root: getComputedStyle(document.documentElement).fontSize,
  }
})

for (const [w, h] of SIZES) {
  const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 5500)
  await page.evaluate(() => {
    const s = () => globalThis.__shopsysDev.data.getState()
    if (!s().items.length) s().seed(['basic'])
    if (!document.querySelector('[data-window-kind="sales-invoice"]'))
      [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click()
  })
  await new Promise((r) => setTimeout(r, 3200))
  const f = (m) => `فيض=${String(m.over).padStart(4)} · شبكة=${m.gridH} · بنود=${m.linesH}(${m.rowsShown}س) · لوحة=${m.panelH} · ترويسة=${m.headH}`
  const toggleMulti = async () => {
    await page.evaluate(() => {
      const box = document.querySelector('.invoice-doc .invoice-doc-checkline input[type=checkbox]')
      box?.click()
    })
    await new Promise((r) => setTimeout(r, 900))
  }
  const rows = []
  for (const mode of (process.env.MODES ?? 'مبسط,ربحية,متقدم').split(',')) {
    await selectQuick(page, 'نمط تحرير الفاتورة', mode)
    await new Promise((r) => setTimeout(r, 800))
    const single = await measure(page)
    await toggleMulti()
    const multi = await measure(page)
    await toggleMulti()
    rows.push(`   ${mode.padEnd(7)} مفرد : ${f(single)}\n   ${' '.repeat(7)} متعدد: ${f(multi)}`)
  }
  const root = (await measure(page)).root
  console.log(`${w}×${h} [جذر ${root}]\n${rows.join('\n')}`)
  await browser.close()
}
