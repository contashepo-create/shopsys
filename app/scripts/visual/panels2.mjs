/* نفس قياس panels.mjs لكن في أسوأ حالة محتوى: النمط «متقدم» + تحصيل متعدد + عملة أجنبية،
   لأن اللوحات تكبر حينها فيظهر أي اختفاء أسفلها. */
import { open } from './lib.mjs'
const SIZES = (process.env.SIZES ?? '1920x1080,1440x900,1280x800,1152x720,1024x700').split(',').map((p) => p.split('x').map(Number))
const WAIT = Number(process.env.WAIT ?? 7000)
for (const [w, h] of SIZES) {
  const { browser, page } = await open('http://localhost:5173/#/sales/invoices/new', w, h, WAIT)
  // النمط المتقدم (أكبر عدد حقول) — القائمة `QuickSelect` لا `select` أصلي
  const box = await page.evaluateHandle(() => {
    const fields = [...document.querySelectorAll('.invoice-doc-fields .form-field')]
    return fields.find((f) => (f.textContent || '').includes('النمط'))?.querySelector('input') ?? null
  })
  const el = box.asElement()
  if (el) {
    await el.click()
    await new Promise((r) => setTimeout(r, 400))
    await page.evaluate(() => document.querySelector('button[data-quick-option][data-value="advanced"]')?.click())
    await new Promise((r) => setTimeout(r, 800))
  }
  await page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.invoice-doc-panel input[type="checkbox"]')]
    boxes.forEach((box) => { if (!box.checked) box.click() }) // تحصيل متعدد + عملة أجنبية
  })
  await new Promise((r) => setTimeout(r, 1200))
  const report = await page.evaluate(() => {
    const docRect = (document.querySelector('.invoice-doc') ?? document.body).getBoundingClientRect()
    const panels = [...document.querySelectorAll('.invoice-doc-panel')].map((panel) => {
      const body = panel.querySelector('.invoice-doc-panel-body')
      const rect = panel.getBoundingClientRect()
      return {
        title: panel.querySelector('.invoice-doc-panel-head b')?.textContent ?? '—',
        hiddenPx: body ? body.scrollHeight - body.clientHeight : 0,
        overflowY: body ? getComputedStyle(body).overflowY : '—',
        belowDoc: Math.round(rect.bottom - docRect.bottom),
        belowScreen: Math.round(rect.bottom - window.innerHeight),
      }
    })
    const expense = document.querySelector('[data-invoice-terms]')?.parentElement
    const expenseBtns = [...document.querySelectorAll('.invoice-doc-addons button')].map((b) => {
      const r = b.getBoundingClientRect()
      return { t: b.textContent.trim().slice(0, 18), visible: r.height > 0 && r.bottom <= window.innerHeight && r.top >= 0 }
    })
    return { panels, expenseBtns, hasExpenseBox: Boolean(expense), pageScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight) }
  })
  console.log(`\n■ ${w}×${h} — تمرير الصفحة=${report.pageScroll}`)
  for (const panel of report.panels) {
    const flag = panel.hiddenPx > 1 || panel.belowScreen > 0 ? '✗' : '✓'
    console.log(`  ${flag} ${panel.title}: مخفي=${panel.hiddenPx}px · overflowY=${panel.overflowY} · أسفل المستند=${panel.belowDoc}px · خارج الشاشة=${panel.belowScreen}px`)
  }
  console.log(`  أزرار المصاريف: ${report.expenseBtns.map((b) => `${b.visible ? '✓' : '✗'}${b.t}`).join(' · ') || 'لا توجد'}`)
  await browser.close()
}
