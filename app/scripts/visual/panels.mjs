/* قياس اللوحات الثلاث أسفل الفاتورة (الشروط · التحصيل · الإجمالي) وبطاقة الطرف:
   هل يختفي جزء من محتواها (scrollHeight > clientHeight مع overflow مخفي/تمرير)،
   وهل يتجاوز أسفلها حدود المستند؟ وكم ارتفاع بطاقة الطرف مقابل صفوف الحقول؟ */
import { open } from './lib.mjs'
const SIZES = (process.env.SIZES ?? '1920x1080,1600x900,1440x900,1366x768,1280x800,1152x720,1024x700')
  .split(',').map((pair) => pair.split('x').map(Number))
const URL = process.env.URL ?? 'http://localhost:5173/#/sales/invoices/new'
const WAIT = Number(process.env.WAIT ?? 7000)
for (const [w, h] of SIZES) {
  const { browser, page } = await open(URL, w, h, WAIT)
  const report = await page.evaluate(() => {
    const out = []
    const docRect = (document.querySelector('.invoice-doc') ?? document.body).getBoundingClientRect()
    document.querySelectorAll('.invoice-doc-panel').forEach((panel) => {
      const title = panel.querySelector('.invoice-doc-panel-head b')?.textContent ?? '—'
      const body = panel.querySelector('.invoice-doc-panel-body')
      const style = body ? getComputedStyle(body) : null
      const rect = panel.getBoundingClientRect()
      out.push({
        title,
        hiddenPx: body ? body.scrollHeight - body.clientHeight : 0,
        overflowY: style?.overflowY ?? '—',
        bottomOverflowPx: Math.round(rect.bottom - docRect.bottom),
        outsideViewport: Math.round(rect.bottom - window.innerHeight),
      })
    })
    const party = document.querySelector('.invoice-doc-party')
    const fields = document.querySelector('.invoice-doc-fields')
    return {
      panels: out,
      party: party ? Math.round(party.getBoundingClientRect().height) : 0,
      fields: fields ? Math.round(fields.getBoundingClientRect().height) : 0,
      partyHidden: party ? party.scrollHeight - party.clientHeight : 0,
      pageScroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    }
  })
  console.log(`\n■ ${w}×${h} — تمرير الصفحة=${report.pageScroll} · بطاقة الطرف=${report.party}px مقابل صف الحقول=${report.fields}px (مخفي ${report.partyHidden})`)
  for (const panel of report.panels) {
    const flag = panel.hiddenPx > 1 || panel.bottomOverflowPx > 1 || panel.outsideViewport > 0 ? '✗' : '✓'
    console.log(`  ${flag} ${panel.title}: مخفي=${panel.hiddenPx}px · overflowY=${panel.overflowY} · تجاوز أسفل المستند=${panel.bottomOverflowPx}px · خارج الشاشة=${panel.outsideViewport}px`)
  }
  await browser.close()
}
