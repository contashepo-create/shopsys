import { open, V } from './lib.mjs'
const [w, h, wait] = V(); const [, , url, sel] = process.argv
const { browser, page } = await open(url, w, h, wait)
const rows = await page.evaluate((sel) => { const root = document.querySelector(sel); if (!root) return ['MISSING ' + sel]
  return [...root.children].map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el)
    return `${el.tagName.toLowerCase()}.${(el.className||'').toString().split(' ').filter(Boolean).slice(0,3).join('.')} ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)} fs=${cs.fontSize} :: ${(el.innerText||'').replace(/\s+/g,' ').slice(0,60)}` }) }, sel)
rows.forEach((r) => console.log(r)); await browser.close()
