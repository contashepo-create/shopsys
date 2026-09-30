import { open, V } from './lib.mjs'
const [w, h, wait] = V(); const [, , url, spec] = process.argv
const { browser, page } = await open(url, w, h, wait)
const pairs = spec.split(';').map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)] })
console.log(JSON.stringify(await page.evaluate((pairs) => { const res = { __root: getComputedStyle(document.documentElement).fontSize }; for (const [k, sel] of pairs) { const el = document.querySelector(sel); if (!el) { res[k] = 'MISSING'; continue } const r = el.getBoundingClientRect(); res[k] = `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}` } return res }, pairs), null, 1))
await browser.close()
