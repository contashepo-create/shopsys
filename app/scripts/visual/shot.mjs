import { open } from './lib.mjs'
const [, , url, out, w = '1600', h = '1000', wait = '6000'] = process.argv
const { browser, page } = await open(url, Number(w), Number(h), Number(wait))
await page.screenshot({ path: out }); await browser.close(); console.log('saved', out, w + 'x' + h)
