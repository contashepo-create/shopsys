/* فحص سريع: لوحة التحصيل في فاتورة البيع — قائمة منسدلة واحدة بلا بلاطات */
import { open } from './lib.mjs'
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, 1440, 900, 6500)
await page.waitForFunction(() => !!globalThis.__shopsysDev?.data, { timeout: 30000 })
const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms))
const res = []; const check = (l, ok, x = '') => { res.push(ok); console.log(`${ok ? '✓' : '✗'} ${l}${x ? ' — ' + x : ''}`) }
await page.evaluate(() => { const s = () => globalThis.__shopsysDev.data.getState(); if (!s().items.length) { s().seed(['basic']); const base = { barcodes: [], categoryId: 1, baseUnit: 'كيس', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }; try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { } } })
await wait(1500)
await page.evaluate(() => { const b = [...document.querySelectorAll('button,a')].filter((x) => x.textContent.includes('فاتورة مبيعات جديدة') && !x.disabled).pop(); b?.click() })
await wait(3200)
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.type('أرز*2', { delay: 60 }); await wait(900); await page.keyboard.press('Enter'); await wait(1200)
const panel = await page.evaluate(() => {
  const collect = document.querySelector('[data-invoice-collect]')
  if (!collect) return null
  const tiles = collect.querySelectorAll('.invoice-doc-tiles, .invoice-doc-tiles > button').length
  const btns = [...collect.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /نقدي$|^تحويل بنكي$|^ماكينة دفع$/.test(t)).length
  const selects = [...collect.querySelectorAll('select')].length
  const methodSelect = collect.querySelector('select[aria-label="طريقة الدفع"]')
  const groups = methodSelect ? [...methodSelect.querySelectorAll('optgroup')].map((g) => g.label) : []
  const options = methodSelect ? methodSelect.querySelectorAll('option').length : 0
  const r = collect.getBoundingClientRect()
  return { tiles, quickBtns: btns, selects, groups, options, height: Math.round(r.height) }
})
check('لا بلاطات ولا أزرار طريقة دفع في لوحة التحصيل', panel && panel.tiles === 0 && panel.quickBtns === 0, JSON.stringify(panel))
check('القائمة المنسدلة موجودة وتعرض الوسائل المتاحة', panel && panel.selects >= 1 && panel.options >= 2, `خيارات=${panel?.options} · مجموعات مصدرية تُفحص بالبوابة الثابتة`)
check('لوحة التحصيل مضغوطة بلا صف أزرار (أقل من 300px)', panel && panel.height < 300, `الارتفاع=${panel?.height}px — كان أعلى بصف البلاطات (~40px إضافية)`)
await page.screenshot({ path: '/home/user/paycheck.png' })
const bad = res.filter((r) => !r).length
console.log(bad ? `\n❌ ${bad} فشل` : `\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close(); process.exit(bad ? 1 : 0)
