import { open, V } from './lib.mjs'
const [w, h, wait] = V(); const [, , url, scope = '.invoice-doc'] = process.argv
const { browser, page } = await open(url, w, h, wait)
const bad = await page.evaluate((scope) => { const root = document.querySelector(scope); if (!root) return ['SCOPE MISSING ' + scope]
  const rr = root.getBoundingClientRect(); const out = []
  root.querySelectorAll('*').forEach((el) => { const r = el.getBoundingClientRect(); if (r.width === 0 && r.height === 0) return
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return
    if (r.bottom > rr.bottom + 1 || r.top < rr.top - 1 || r.right > rr.right + 1 || r.left < rr.left - 1) out.push(`${el.tagName.toLowerCase()}.${(el.className||'').toString().split(' ').filter(Boolean).slice(0,3).join('.')} ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.left)},${Math.round(r.top)}`) })
  return out }, scope)
bad.forEach((b) => console.log(b)); await browser.close()
