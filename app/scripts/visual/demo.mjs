/* تحقق حي من البند ⑲: قاعدة البيانات التجريبية الحقيقية ولوحة اختيار النشاط.
   يفتح التطبيق ⇐ يفتح اللوحة ⇐ يحمّل نشاطاً ⇐ يقرأ المتجر ⇐ ينتقل لنشاط آخر. */
import { open } from './lib.mjs'
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/`, 1600, 950, 9000)

const snapshot = () => page.evaluate(() => {
  const s = globalThis.__shopsysDev?.data?.getState?.()
  const app = globalThis.__shopsysDev?.app?.getState?.()
  if (!s) return { dev: false }
  return {
    activity: app?.setup?.activityId ?? null,
    shop: app?.setup?.shopName ?? null,
    items: s.items.length, customers: s.customers.length, suppliers: s.suppliers.length,
    warehouses: s.warehouses.length, branches: s.branches.length, treasuries: s.treasuries.length,
    wallets: s.treasuries.filter((t) => t.channel === 'wallet').length,
    terminals: s.paymentTerminals.length, sales: s.sales.length, purchases: s.purchases.length,
    journal: s.journal.length,
  }
})

console.log('قبل التحميل:', JSON.stringify(await snapshot()))
await page.evaluate(() => document.querySelector('[data-demo-db-toggle]')?.click())
await new Promise((r) => setTimeout(r, 1200))
const panel = await page.evaluate(() => ({
  panel: !!document.querySelector('[data-demo-db-panel]'),
  activities: [...document.querySelectorAll('[data-demo-activity]')].map((el) => el.getAttribute('data-demo-activity')),
  dimmed: document.querySelectorAll('.app-window-backdrop, .layer-modal-backdrop').length,
}))
console.log('اللوحة:', JSON.stringify(panel))

for (const activity of ['grocery', 'pharmacy', 'restaurant', 'clothing']) {
  await page.evaluate((id) => document.querySelector(`[data-demo-load="${id}"]`)?.click(), activity)
  await new Promise((r) => setTimeout(r, 9000))
  const note = await page.evaluate(() => document.querySelector('[data-demo-note]')?.textContent ?? '')
  console.log(`بعد تحميل ${activity}:`, JSON.stringify(await snapshot()))
  console.log('   الرسالة:', note.trim())
}
await page.screenshot({ path: process.env.OUT ?? '/home/user/demodb.png' })
await browser.close()
