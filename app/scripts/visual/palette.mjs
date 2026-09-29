/* فحص حيّ للوحة الأوامر Ctrl+K وخريطة الاختصارات Ctrl+/ */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/`, w, h, 5000)
const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms))
const res = []
const check = (label, ok, extra = '') => { res.push(ok); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`) }

await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) s().seed(['basic'])
  const base = { barcodes: [], categoryId: 1, baseUnit: 'كيس', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
  try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { /* موجود */ }
})
await wait(1200)

const ctrl = async (key) => { await page.keyboard.down('Control'); await page.keyboard.press(key); await page.keyboard.up('Control'); await wait(500) }

await ctrl('KeyK')
check('Ctrl+K يفتح لوحة الأوامر', await page.evaluate(() => !!document.querySelector('[data-command-palette]')))
const first = await page.evaluate(() => document.querySelectorAll('.command-opt').length)
check('اللوحة تعرض نتائج ابتدائية', first > 5, `${first} نتيجة`)

await page.keyboard.type('عملاء', { delay: 60 }); await wait(500)
const filtered = await page.evaluate(() => [...document.querySelectorAll('.command-opt-label')].slice(0, 3).map((e) => e.textContent))
check('البحث يرشّح النتائج', filtered.length > 0, filtered.join(' · '))

await page.keyboard.press('ArrowDown'); await wait(200)
const moved = await page.evaluate(() => [...document.querySelectorAll('.command-opt')].findIndex((e) => e.dataset.cmdActive === 'true'))
check('السهم ينقل التحديد', moved === 1, `المحدد ${moved}`)

await page.keyboard.press('Enter'); await wait(900)
const nav = await page.evaluate(() => ({ hash: location.hash, closed: !document.querySelector('[data-command-palette]') }))
check('Enter ينفّذ الأمر ويغلق اللوحة', nav.closed, nav.hash)

await ctrl('Slash')
const map = await page.evaluate(() => {
  const el = document.querySelector('[data-shortcut-map]')
  return el ? { rows: el.querySelectorAll('.shortcut-row').length, groups: el.querySelectorAll('.shortcut-group').length } : null
})
check('Ctrl+/ يعرض خريطة الاختصارات', !!map && map.rows >= 10, map ? `${map.groups} مجموعات · ${map.rows} اختصاراً` : '')

// Escape يغلق الخريطة
await page.keyboard.press('Escape'); await wait(400)
check('Escape يغلق خريطة الاختصارات', await page.evaluate(() => !document.querySelector('[data-shortcut-map]')))

// البحث عن صنف من اللوحة
await ctrl('KeyK'); await page.keyboard.type('أرز', { delay: 60 }); await wait(600)
const itemHit = await page.evaluate(() => document.querySelector('.command-opt-label')?.textContent ?? '')
check('اللوحة تبحث في الأصناف', /أرز/.test(itemHit), itemHit)

// لا تعتيم للخلفية (قاعدة المالك)
const dim = await page.evaluate(() => {
  const el = document.querySelector('[data-command-palette]')
  const back = [...document.querySelectorAll('body *')].filter((n) => {
    const cs = getComputedStyle(n)
    if (!cs.backgroundColor.startsWith('rgba')) return false
    const a = Number(cs.backgroundColor.split(',')[3])
    const r = n.getBoundingClientRect()
    return a > 0.25 && r.width > innerWidth * 0.8 && r.height > innerHeight * 0.8 && !n.contains(el)
  })
  return back.length
})
check('بلا طبقة تعتيم للخلفية', dim === 0, `${dim} طبقة`)

await page.screenshot({ path: process.env.OUT ?? '/home/user/palette.png' })
const bad = res.filter((r) => !r).length
console.log(bad ? `\n❌ ${bad} فحص فاشل من ${res.length}` : `\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
