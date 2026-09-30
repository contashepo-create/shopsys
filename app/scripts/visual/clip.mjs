import { open, V } from './lib.mjs'
const [w, h, wait] = V(); const [, , url, sel, out, padStr = '4'] = process.argv; const pad = Number(padStr)
const { browser, page } = await open(url, w, h, wait)
const box = await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }, sel)
if (!box) { console.log('MISSING', sel); await browser.close(); process.exit(1) }
await page.screenshot({ path: out, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(w, box.width + pad * 2), height: Math.min(h, box.height + pad * 2) } })
console.log('saved', out, JSON.stringify(box)); await browser.close()
