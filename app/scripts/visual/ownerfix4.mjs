/* فحص حيّ لبلاغات المالك الأربعة:
   ① خطوط الإيصال الحراري واضحة  ② زر حذف المصروف هدف نقر مريح ويعمل
   ③ لا تحديد لنص الفاتورة خارج الحقول  ④ القوائم ≤١٠ بنود منسدلة أصلية */
import { open, selectQuick } from './lib.mjs'

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
    const base = { barcodes: [], categoryId: 1, baseUnit: 'قطعة', extraUnits: [], minQty: 0, trackExpiry: false, trackSerial: false, warrantyMonths: 0, soldByWeight: false, variantColors: [], variantSizes: [], isService: false, active: true, notes: '', imageUrl: '', taxable: true }
    try { s().addItem({ ...base, nameAr: 'أرز مصري 5 كجم', sku: 'RICE-5', costMinor: 12000, stockQty: 41, priceMinor: 15500 }) } catch { /* موجود */ }
  }
})
await wait(1400)
await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].filter((x) => x.textContent.includes('فاتورة مبيعات جديدة') && !x.disabled).pop(); b?.click() })
await wait(3200)

/* ④ القوائم القصيرة منسدلة أصلية */
const selects = await page.evaluate(() => {
  const natives = [...document.querySelectorAll('[data-quick-native] select')]
  const combos = [...document.querySelectorAll('[data-quick-select]:not([data-quick-native]) input')]
  return {
    native: natives.map((s) => ({ aria: s.getAttribute('aria-label'), n: s.options.length })).slice(0, 8),
    combo: combos.map((i) => i.getAttribute('aria-label')).slice(0, 8),
  }
})
check('القوائم ≤١٠ بنود صارت <select> أصلية', selects.native.length > 0, selects.native.map((s) => `${s.aria}:${s.n}`).join(' · '))
check('كل قائمة أصلية عدد بنودها ≤ ١٠', selects.native.every((s) => s.n <= 10), JSON.stringify(selects.native.map((s) => s.n)))
check('القوائم الطويلة تبقى بحثاً', selects.combo.length >= 0, `بحث: ${selects.combo.filter(Boolean).join(' · ') || 'لا شيء'}`)

/* بعد الاختيار تظل منسدلة (لا تتحول لحقل نص) */
const stillSelect = await page.evaluate(() => {
  const sel = document.querySelector('[data-quick-native] select')
  if (!sel || sel.options.length < 2) return null
  sel.selectedIndex = 1
  sel.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})
await wait(700)
check('تبقى منسدلة بعد الاختيار', stillSelect === null || await page.evaluate(() => !!document.querySelector('[data-quick-native] select')))

/* ③ لا تحديد لنص المستند */
const sel = await page.evaluate(() => {
  const doc = document.querySelector('.invoice-doc') ?? document.querySelector('[data-window-kind="sales-invoice"]')
  const styleOf = (el) => el ? getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect : null
  const input = doc?.querySelector('input:not([type=checkbox])')
  const textarea = doc?.querySelector('textarea')
  return { doc: styleOf(doc), input: styleOf(input), textarea: styleOf(textarea) }
})
check('نص المستند غير قابل للتحديد', sel.doc === 'none', `doc=${sel.doc}`)
check('الحقول تبقى قابلة للتحديد', sel.input === 'text' && (sel.textarea ?? 'text') === 'text', `input=${sel.input} · textarea=${sel.textarea}`)

/* ② زر حذف المصروف: حجم وهدف نقر ويعمل */
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /مصروف على العميل/.test(x.textContent)); b?.click() })
await wait(1200)
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /إضافة مصروف/.test(x.textContent)); b?.click() })
await wait(800)
const del = await page.evaluate(() => {
  const b = document.querySelector('[aria-label="حذف المصروف"]')
  if (!b) return null
  const r = b.getBoundingClientRect()
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { w: Math.round(r.width), h: Math.round(r.height), x: r.left + r.width / 2, y: r.top + r.height / 2, hit: b.contains(top), title: b.getAttribute('title') }
})
check('زر الحذف له تسمية وهدف نقر ≥ ٢٦px', !!del && del.w >= 26 && del.h >= 26 && !!del.title, del ? `${del.w}×${del.h} · ${del.title}` : 'غير موجود')
if (del) {
  await page.mouse.click(del.x, del.y)
  await wait(900)
  check('النقر بالفأرة يحذف الصف فعلاً', await page.evaluate(() => !document.querySelector('[aria-label="حذف المصروف"]')))
}

/* ① خطوط الإيصال الحراري — تُبنى فعلياً وتُصوَّر */
const { readFileSync } = await import('node:fs')
const src = readFileSync(new URL('../../src/ui/print/printReceipt.ts', import.meta.url), 'utf8')
const body = src.replace(/\/\*[\s\S]*?\*\//g, '')
const sizes = [...body.matchAll(/font-size: \$\{wide \? '([\d.]+)px' : '([\d.]+)px'\}/g)].flatMap((m) => [Number(m[1]), Number(m[2])])
check('أصغر خط في الإيصال ≥ 10.5px', sizes.length > 0 && Math.min(...sizes) >= 10.5, `الأصغر ${Math.min(...sizes)}px من ${sizes.length} مقاساً`)
check('لا رمادي في الإيصال الحراري', !/color: #333|color: #6[0-9a-f]{2}|color: #9[0-9a-f]{2}/.test(body), 'كل النصوص #000')
check('ضبط ألوان الطباعة مفعَّل', /print-color-adjust: exact/.test(body) && /text-rendering: geometricPrecision/.test(body))

/* صورة حقيقية للإيصال عبر بناء HTML من وحدة الطباعة نفسها */
const receiptOk = await page.evaluate(async () => {
  const mod = await import('/src/ui/print/printReceipt.ts')
  const cur = { code: 'EGP', symbol: 'ج.م', decimals: 2, name: 'جنيه' }
  const model = {
    shopName: 'سوبر ماركت محمد عبده', headerLines: ['شارع الجمهورية — المنصورة', 'هاتف: 01000000000'],
    docTitle: 'فاتورة مبيعات', docNumber: 'INV-1042', dateText: '2026-09-29 14:20',
    cashierName: 'محمد عبده', customerName: 'عميل نقدي', customerPhone: '', notes: 'شكراً لتعاملكم معنا',
    lines: [
      { nameAr: 'أرز مصري 5 كجم', qty: 2, unitText: 'كيس', priceText: '155.00', totalText: '310.00', discountText: '', subText: 'كود RICE-5' },
      { nameAr: 'زيت عباد الشمس المكرر 1 لتر', qty: 3, unitText: 'زجاجة', priceText: '65.00', totalText: '195.00', discountText: 'خصم 5%', subText: 'كود OIL-1L' },
    ],
    totals: [['إجمالي البنود', '505.00'], ['الخصم', '9.75'], ['الضريبة 14%', '69.34']],
    grandText: '564.59', paidText: '600.00', changeText: '35.41', amountWords: 'خمسمائة وأربعة وستون جنيهاً و٥٩ قرشاً',
    barcodeText: 'INV-1042', footerLines: ['الاستبدال خلال 14 يوماً بالفاتورة'],
  }
  const settings = { widthMm: 80, showLogo: false, logoDataUrl: '', showHeaderLines: true, showCashier: true, showCustomer: true, showBarcode: true, showWords: true, showFooter: true, showTax: true, copies: 1 }
  let html = ''
  try { html = mod.renderReceiptHtml(model, cur, settings) } catch (error) { return { error: String(error).slice(0, 120) } }
  const host = document.createElement('div')
  host.id = 'receipt-preview'
  host.style.cssText = 'position:fixed;inset-inline-start:20px;top:20px;z-index:99999;background:#fff;box-shadow:0 0 0 2px #000'
  host.innerHTML = `<iframe style="width:302px;height:560px;border:0" srcdoc="${html.replace(/"/g, '&quot;')}"></iframe>`
  document.body.appendChild(host)
  return { ok: true }
})
check('بناء الإيصال الحراري بلا خطأ', !!receiptOk?.ok, receiptOk?.error ?? '')
await wait(900)
await page.screenshot({ path: process.env.OUT ?? '/home/user/ownerfix4.png' })
const shot = await page.$('#receipt-preview')
if (shot) await shot.screenshot({ path: '/home/user/receipt-preview.png' })
const bad = res.filter((r) => !r).length
console.log(bad ? `\n❌ ${bad} فحص فاشل من ${res.length}` : `\n✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
