/* مصفوفة المقاسات: تتحقق من أن الفاتورة تتكيّف مع كل مقاس — خمسة سطور ظاهرة،
   بلا تمرير عام، وبلا عنصر مقصوص (scrollWidth > clientWidth) في المستند. */
import { open } from './lib.mjs'
const SIZES = [[1920, 1080], [1680, 1050], [1600, 900], [1440, 900], [1366, 768], [1280, 800], [1280, 720], [1152, 720], [1024, 700], [960, 680], [860, 650]]
const WAIT = Number(process.env.WAIT ?? 7000)
let bad = 0
for (const [w, h] of SIZES) {
  const { browser, page } = await open('http://localhost:5173/#/sales/invoices/new', w, h, WAIT)
  const r = await page.evaluate(() => {
    const doc = document.querySelector('.invoice-doc') ?? document.body
    const clipped = [...doc.querySelectorAll('*')].filter((e) => {
      if (e.classList.contains('sr-only') || e.closest('.sr-only')) return false
      /* «مقصوص» = محتوى يختفي فعلاً: الصندوق يخفي الفائض ومحتواه أكبر منه.
         أما overflow:visible فالنص ظاهر كاملاً ولو تجاوز الحد. */
      const s = getComputedStyle(e)
      const hidX = s.overflowX === 'hidden' || s.overflowX === 'clip'
      const hidY = s.overflowY === 'hidden' || s.overflowY === 'clip'
      return (hidX && e.scrollWidth - e.clientWidth > 1) || (hidY && e.scrollHeight - e.clientHeight > 1)
    }).map((e) => `${e.tagName}.${String(e.className).split(' ')[0]}`)
    return { rows: document.querySelectorAll('.invoice-doc tbody tr').length, scroll: Math.max(0, document.documentElement.scrollHeight - window.innerHeight), clipped: clipped.slice(0, 4), n: clipped.length }
  })
  const ok = r.rows === 5 && r.scroll === 0 && r.n === 0
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${w}×${h} — سطور=${r.rows} · تمرير=${r.scroll} · مقصوص=${r.n}${r.n ? ' ⇐ ' + r.clipped.join(' | ') : ''}`)
  await browser.close()
}
console.log(bad ? `❌ فشل ${bad} من ${SIZES.length}` : `✅ ${SIZES.length}/${SIZES.length} — الفاتورة تتكيّف مع كل المقاسات`)
