import { open, selectQuick } from './lib.mjs'
const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const { browser, page } = await open(`http://localhost:${process.env.PORT}/#/sales/invoices`, w, h, 5500)
await page.evaluate(() => { const s=()=>globalThis.__shopsysDev.data.getState(); if(!s().items.length) s().seed(['basic']) })
await new Promise((r) => setTimeout(r, 1200))
await page.evaluate(() => { if (!document.querySelector('[data-app-window]')) [...document.querySelectorAll('button,a')].find((b)=>b.textContent.includes('فاتورة مبيعات جديدة'))?.click() })
await new Promise((r) => setTimeout(r, 3200))
await selectQuick(page, 'نمط تحرير الفاتورة', process.env.MODE ?? 'متقدم')
console.log(JSON.stringify(await page.evaluate(() => {
  const fields = document.querySelector('.invoice-doc-fields')
  return {
    grid: fields ? getComputedStyle(fields).gridTemplateColumns : null,
    dates: [...document.querySelectorAll('.invoice-doc input[type="date"]')].map((d) => ({
      label: d.closest('.form-field')?.querySelector('label')?.textContent?.trim().slice(0, 12),
      w: Math.round(d.getBoundingClientRect().width), sw: d.scrollWidth, value: d.value,
      overflow: d.scrollWidth - Math.round(d.clientWidth),
    })),
    cells: [...(fields?.children ?? [])].map((c) => `${(c.querySelector('label')?.textContent ?? '').trim().slice(0, 9)}:${Math.round(c.getBoundingClientRect().width)}`),
  }
}), null, 1)); await browser.close()
