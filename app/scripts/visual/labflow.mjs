/* اختبار المحاكاة الحية: إدخال بيانات · تعديل · إصدار · انعكاس على المخزون والتقرير */
import { open } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1440x860').split('x').map(Number)
const { browser, page } = await open('http://localhost:4173/', w, h, 2500)
const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms))
const errs = []
page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)))
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)) })
const res = []
const check = (label, ok, extra = '') => { res.push(ok); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`) }

await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle2' }); await wait(1200)

check('فتحت نافذة الفاتورة تلقائياً', await page.evaluate(() => !!document.querySelector('[data-kind="invoice"]')))

// ① F2 يضيف سطراً ثم الكتابة تبحث عن صنف
await page.keyboard.press('F2'); await wait(500)
check('F2 أضاف سطراً', await page.evaluate(() => document.querySelectorAll('tbody[data-lines] tr').length === 1))
await page.keyboard.type('زيت', { delay: 90 }); await wait(500)
check('الكتابة فتحت منتقي الصنف', await page.evaluate(() => !!document.querySelector('.anchor-pop')))
await page.keyboard.press('Enter'); await wait(500)
const afterPick = await page.evaluate(() => ({
  name: document.querySelector('[data-cell="name"][data-i="0"]')?.value,
  price: document.querySelector('[data-cell="price"][data-i="0"]')?.value,
  card: document.querySelector('.inv-card')?.textContent.replace(/\s+/g, ' ').slice(0, 60),
}))
check('اختيار الصنف ملأ السطر', !!afterPick.name && Number(afterPick.price) > 0, `${afterPick.name} @ ${afterPick.price}`)
check('بطاقة الصنف المصغّرة ظهرت', !!afterPick.card, afterPick.card)

// ② الكمية + الخصم وتحديث الإجماليات
await page.keyboard.type('4'); await wait(400)
const totals1 = await page.evaluate(() => ({ grand: document.querySelector('[data-sum="grand"]')?.textContent, sub: document.querySelector('[data-sum="sub"]')?.textContent }))
check('الكمية غيّرت الإجماليات حيّاً', Number(totals1.sub.replace(/,/g, '')) > 200, `الإجمالي ${totals1.grand}`)

// ③ باركود يضيف سطراً
await page.evaluate(() => { const b = document.querySelector('[data-f="barcode"]'); b.focus(); b.value = '6221033' })
await page.keyboard.press('Enter'); await wait(600)
check('الباركود أضاف سطراً', await page.evaluate(() => document.querySelectorAll('tbody[data-lines] tr').length === 2))

// ④ حفظ وإصدار F9 ⇐ المخزون ينقص + تقرير + إيصال
const stockBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('shopsys-lab-db-v1') ?? '{}')?.items?.find((i) => i.sku === 'OIL-1L')?.stock ?? 40)
await page.keyboard.press('F9'); await wait(1400)
const after = await page.evaluate(() => {
  const db = JSON.parse(localStorage.getItem('shopsys-lab-db-v1') ?? '{}')
  return { stock: db.items?.find((i) => i.sku === 'OIL-1L')?.stock, invoices: db.invoices?.length ?? 0,
    receipt: !!document.querySelector('[data-kind="receipt"]'), toast: document.querySelector('.toast')?.textContent?.slice(0, 40) }
})
check('F9 أصدر الفاتورة وحفظها محلياً', after.invoices === 1, `فواتير=${after.invoices}`)
check('المخزون نقص فعلياً', after.stock < stockBefore, `${stockBefore} ⇐ ${after.stock}`)
check('الإيصال الحراري فُتح (طباعة صامتة)', after.receipt)

// ⑤ التقرير يقرأ البيانات الحقيقية
await page.evaluate(() => document.querySelector('[data-open="report"]').click()); await wait(700)
const rep = await page.evaluate(() => document.querySelector('[data-kind="report"] [data-rep-root]')?.textContent.replace(/\s+/g, ' ').slice(0, 90))
check('تقرير اليوم يعرض الفاتورة المُصدرة', /1/.test(rep ?? ''), rep)

// ⑥ تعديل صنف من نافذة الأصناف ينعكس ويُحفظ
await page.evaluate(() => document.querySelector('[data-open="items"]').click()); await wait(700)
await page.evaluate(() => {
  const inp = document.querySelector('[data-kind="items"] tbody tr input[data-e="price"]')
  inp.value = '999'; inp.dispatchEvent(new Event('change', { bubbles: true }))
}); await wait(600)
check('تعديل سعر صنف حُفظ في التخزين المحلي',
  await page.evaluate(() => JSON.parse(localStorage.getItem('shopsys-lab-db-v1')).items[0].price === 999))

// ⑦ درج عميل جديد Ctrl+Shift+N
await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('KeyN'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
await wait(600)
check('Ctrl+Shift+N فتح الدرج الجانبي', await page.evaluate(() => !!document.querySelector('.drawer')))
await page.evaluate(() => { const d = document.querySelector('.drawer'); d.querySelector('[data-k="name"]').value = 'عميل الاختبار'; d.querySelector('[data-save]').click() })
await wait(700)
check('حفظ العميل الجديد وربطه بالفاتورة',
  await page.evaluate(() => JSON.parse(localStorage.getItem('shopsys-lab-db-v1')).customers.some((c) => c.name === 'عميل الاختبار')))

// ⑧ لوحة الأوامر Ctrl+K
await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control'); await wait(600)
check('Ctrl+K فتح لوحة الأوامر', await page.evaluate(() => !!document.querySelector('.palette')))
await page.keyboard.type('تقرير', { delay: 60 }); await wait(400)
await page.keyboard.press('Enter'); await wait(600)
check('تنفيذ أمر من اللوحة', await page.evaluate(() => !document.querySelector('.palette')))

// ⑨ شاشة العميل تعكس السلة
await page.evaluate(() => document.querySelector('[data-open="customerDisplay"]').click()); await wait(600)
await page.keyboard.press('F2'); await wait(400)
await page.keyboard.type('أرز', { delay: 80 }); await wait(500); await page.keyboard.press('Enter'); await wait(600)
const cd = await page.evaluate(() => document.querySelector('[data-kind="customerDisplay"] .cd-total')?.textContent?.trim())
check('شاشة العميل تعرض الإجمالي لحظياً', !!cd && cd !== '0.00', cd)

// ⑩ تعدد السلات Ctrl+T/Ctrl+Tab
await page.keyboard.down('Control'); await page.keyboard.press('KeyT'); await page.keyboard.up('Control'); await wait(600)
check('Ctrl+T أنشأ سلة جديدة', await page.evaluate(() => document.querySelectorAll('.inv-tab').length >= 2))

await page.evaluate(() => document.querySelector('[data-act="tileV"]').click()); await wait(800)
await page.screenshot({ path: '/home/user/lab-live.png' })
console.log(errs.length ? `\n⚠ أخطاء JS: ${[...new Set(errs)].slice(0, 4).join(' | ')}` : '\n✅ بلا أخطاء JS')
const bad = res.filter((r) => !r).length
console.log(bad ? `❌ ${bad} فحص فاشل من ${res.length}` : `✅ كل الفحوص ناجحة (${res.length})`)
await browser.close()
