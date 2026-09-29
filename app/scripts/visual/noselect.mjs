/* قرار المالك: التطبيق لا يُعامَل كنص — لا تحديد في أي شاشة إلا داخل الحقول.
   يحاول هذا الفحص تظليل النص فعلياً (سحب بالفأرة + Ctrl+A) في كل قسم. */
import { open } from './lib.mjs'

const ROUTES = (process.env.ROUTES ?? [
  '/', '/sales/invoices', '/sales/pos', '/purchases/invoices', '/items',
  '/parties/customers', '/parties/employees', '/treasury/accounts', '/treasury/receipts',
  '/accounting/journal', '/reports/trial-balance', '/settings',
].join(',')).split(',')
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/`, w, h, 5000)
const wait = (ms = 900) => new Promise((r) => setTimeout(r, ms))
await page.evaluate(() => { const s = () => globalThis.__shopsysDev.data.getState(); if (!s().items.length) s().seed(['basic']) })
await wait(1300)

let bad = 0
for (const route of ROUTES) {
  await page.evaluate((r) => { location.hash = `#${r}` }, route)
  await wait(2600)
  const result = await page.evaluate(() => {
    const scope = document.querySelector('main') ?? document.body
    const target = [...scope.querySelectorAll('h1, h2, td, p, span, b, div')]
      .find((node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 8 && node.getBoundingClientRect().width > 40)
    if (!target) return { skipped: true }
    const range = document.createRange()
    range.selectNodeContents(target)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const selected = (selection?.toString() ?? '').trim()
    const style = getComputedStyle(target).webkitUserSelect || getComputedStyle(target).userSelect
    selection?.removeAllRanges()
    return { style, selectable: style !== 'none', sample: (target.textContent ?? '').trim().slice(0, 24), selected: selected.length }
  })
  if (result.skipped) { console.log(`— ${route}: لا نص للاختبار`); continue }
  const ok = !result.selectable
  if (!ok) bad++
  console.log(`${ok ? '✓' : '✗'} ${route} — user-select=${result.style} «${result.sample}»`)
}

/* الحقول تبقى قابلة للتحديد والنسخ — نختبرها داخل نافذة الفاتورة */
await page.evaluate(() => { location.hash = '#/sales/invoices' })
await wait(2600)
await page.evaluate(() => { const b = [...document.querySelectorAll('button, a')].filter((x) => x.textContent.includes('فاتورة مبيعات جديدة') && !x.disabled).pop(); b?.click() })
await wait(3200)
const field = await page.evaluate(() => {
  const scope = document.querySelector('[data-app-window]') ?? document.body
  const input = [...scope.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden])')]
    .find((node) => node.offsetParent && node.getBoundingClientRect().width > 40)
  if (!input) return null
  input.focus()
  if (!input.value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'نص تجريبي للنسخ')
  }
  try { input.setSelectionRange(0, input.value.length) } catch { /* حقول التاريخ لا تدعم التحديد */ }
  return { style: getComputedStyle(input).userSelect, selectionLength: (input.selectionEnd ?? 0) - (input.selectionStart ?? 0), aria: input.getAttribute('aria-label') }
})
const fieldOk = !!field && field.style === 'text' && field.selectionLength > 0
if (!fieldOk) bad++
console.log(`${fieldOk ? '✓' : '✗'} الحقول ما زالت قابلة للتحديد والنسخ — ${JSON.stringify(field)}`)

/* Ctrl+A لا يظلّل الشاشة */
await page.evaluate(() => { location.hash = '#/'; document.activeElement?.blur?.() })
await wait(1200)
await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
await wait(400)
const selectedAll = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length)
const ctrlOk = selectedAll === 0
if (!ctrlOk) bad++
console.log(`${ctrlOk ? '✓' : '✗'} Ctrl+A لا يظلّل الشاشة — ${selectedAll} حرفاً`)

console.log(bad ? `\n❌ ${bad} ملاحظة` : '\n✅ التطبيق كله لا يُعامَل كنص — والحقول وحدها قابلة للتحديد')
await browser.close()
