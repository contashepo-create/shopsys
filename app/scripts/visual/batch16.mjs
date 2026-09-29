/* فحص حيّ لدفعة المالك ⑯:
   ① نبض نقطة الاتصال ونقطة «القيد متزن»  ② شريط الرأس: عدد البنود + الوزن بلا تلميحات
   ③ المسطرة تفتح منتقي الصنف  ④ سحب حدود الأعمدة يغيّر العرض ويُحفظ
   ⑤ زر تعديل الطرف أصغر  ⑥ «مسودة جديدة» لم تعد مكرَّرة  ⑦ سرعة فتح الفاتورة */
import { open } from './lib.mjs'

const [w, h] = (process.env.SIZE ?? '1440x860').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 5500)
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms))
const res = []
const check = (label, ok, extra = '') => { res.push(ok); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`) }

await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) {
    s().seed(['basic'])
    const base = { barcodes: [], categoryId: 1, baseUnit: 'كيس', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
    try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { /* موجود */ }
  }
})
await wait(1600)

/* ⑦ زمن فتح نافذة الفاتورة بعد التسخين المسبق */
const started = Date.now()
await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].filter((x) => x.textContent.includes('فاتورة مبيعات جديدة') && !x.disabled).pop(); b?.click() })
await page.waitForFunction(() => !!document.querySelector('[data-app-window] .invoice-doc, [data-app-window] .invoice-lines-table'), { timeout: 20000 })
const openMs = Date.now() - started
check('فتح الفاتورة أسرع من ٣ ثوانٍ', openMs < 3000, `${openMs}ms`)
await wait(1200)

/* ① النبضات */
const pulses = await page.evaluate(() => {
  const online = document.querySelector('.invoice-doc-online i')
  const balanced = document.querySelector('.invoice-doc-balanced i')
  const name = (el) => el ? getComputedStyle(el).animationName : null
  return { online: name(online), balanced: name(balanced) }
})
check('نقطة الاتصال تنبض', pulses.online === 'livePulse', String(pulses.online))
check('نقطة «القيد متزن» تنبض', pulses.balanced === 'livePulse', String(pulses.balanced))

/* ② شريط رأس الجدول */
const strip = await page.evaluate(() => {
  const bar = document.querySelector('.invoice-lines-toolbar, .invoice-lines-kpis')?.closest('div')?.parentElement
  const text = (document.querySelector('.invoice-lines-kpis')?.textContent ?? '').replace(/\s+/g, ' ').trim()
  return { text, hint: !!document.querySelector('.invoice-lines-hint'), value: !!document.querySelector('.invoice-lines-value'), scope: !!bar }
})
check('التلميحات أُزيلت من الشريط', !strip.hint)
check('قيمة البنود أُزيلت', !strip.value)
check('يظهر عدد البنود والوزن الإجمالي', /بند/.test(strip.text) && /كجم|—/.test(strip.text), strip.text)

/* ③ المسطرة تفتح المنتقي */
await page.evaluate(() => document.querySelector('.invoice-line-entry-cell input')?.focus())
await page.keyboard.press('Space')
await wait(1200)
const pickerOpen = await page.evaluate(() => !!document.querySelector('[data-window-kind="item-picker"], .invoice-search-dialog'))
check('المسطرة تفتح نافذة انتقاء الصنف', pickerOpen)
await page.keyboard.press('Escape')
await wait(700)

/* ④ سحب حدود الأعمدة */
const before = await page.evaluate(() => {
  const col = document.querySelector('col[data-col="name"]')
  const th = [...document.querySelectorAll('.invoice-lines-table thead th')].find((n) => n.textContent.includes('الصنف'))
  const r = th?.getBoundingClientRect()
  return { width: col?.style.width, x: r ? r.left + 2 : 0, y: r ? r.top + r.height / 2 : 0, px: r ? Math.round(r.width) : 0 }
})
await page.mouse.move(before.x, before.y)
await page.mouse.down()
await page.mouse.move(before.x - 80, before.y, { steps: 10 })
await page.mouse.up()
await wait(700)
const after = await page.evaluate(() => {
  const col = document.querySelector('col[data-col="name"]')
  const th = [...document.querySelectorAll('.invoice-lines-table thead th')].find((n) => n.textContent.includes('الصنف'))
  return { width: col?.style.width, px: Math.round(th?.getBoundingClientRect().width ?? 0), saved: localStorage.getItem('shopsys-invoice-cols-sale') }
})
check('سحب حافة العمود يغيّر عرضه', after.px !== before.px, `${before.px}px ⇐ ${after.px}px`)
check('العرض الجديد محفوظ', !!after.saved && after.saved.includes('name'), String(after.saved).slice(0, 40))

/* ⑤⑥ زر القلم ورقم المستند */
const misc = await page.evaluate(() => {
  const pen = document.querySelector('.invoice-pos-edit-party')
  const number = document.querySelector('[data-doc-number]')?.textContent?.trim()
  const r = pen?.getBoundingClientRect()
  return { pen: r ? `${Math.round(r.width)}×${Math.round(r.height)}` : null, number }
})
check('زر تعديل الطرف صغير وأنيق', !!misc.pen && parseInt(misc.pen) <= 26, misc.pen)
check('«مسودة جديدة» لم تعد مكرَّرة داخل المستند', misc.number === 'INV', misc.number)

await page.screenshot({ path: process.env.OUT ?? '/home/user/batch16.png' })
const bad = res.filter((r) => !r).length
console.log(bad ? `\n❌ ${bad} فحص فاشل من ${res.length}` : `\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
