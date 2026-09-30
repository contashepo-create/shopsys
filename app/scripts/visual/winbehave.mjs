/* تدقيق سلوك النوافذ كأنها نوافذ سطح مكتب (C#/MDI):
   الترتيب بالتركيز · التصغير والاستعادة من الشريط · التكبير/الاستعادة ·
   النقر المزدوج على الشريط · السحب · التحجيم · مفاتيح التنقل بين النوافذ.
   تشغيل: PORT=5173 SIZE=1366x768 node winbehave.mjs */
import { open } from './lib.mjs'

const [w, h] = (process.env.SIZE ?? '1366x768').split('x').map(Number)
const PORT = process.env.PORT || 5173
const { browser, page } = await open(`http://localhost:${PORT}/#/sales/invoices`, w, h, 6000)
const wait = (ms = 700) => new Promise((r) => setTimeout(r, ms))
const state = () => page.evaluate(() => [...document.querySelectorAll('[data-app-window]')].map((el) => {
  const r = el.getBoundingClientRect()
  return {
    kind: el.getAttribute('data-window-kind'), z: Number(getComputedStyle(el).zIndex) || 0,
    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    active: el.classList.contains('is-active') || el.getAttribute('data-window-active') === 'true',
    cls: el.className.replace('app-window layer-window', '').trim(),
  }
}))
const taskbar = () => page.evaluate(() => [...document.querySelectorAll('[data-window-taskbar] button, [data-window-taskbar] [role=button]')].map((b) => b.textContent.trim().slice(0, 22)))
const results = []
const check = (label, ok, extra = '') => { results.push({ label, ok, extra }); console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ' — ' + extra : ''}`) }

await page.evaluate(() => {
  const s = () => globalThis.__shopsysDev.data.getState()
  if (!s().items.length) s().seed(['basic'])
})
await wait(1200)
// ثلاث نوافذ: فاتورة بيع + فاتورة بيع ثانية + منتقي صنف
await page.evaluate(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click())
await wait(2600)
await page.evaluate(() => { location.hash = '#/sales/invoices' })
await wait(1400)
await page.evaluate(() => [...document.querySelectorAll('button, a')].find((b) => b.textContent.includes('فاتورة مبيعات جديدة'))?.click())
await wait(2600)
let s0 = await state()
check('فتح فاتورتين معاً بلا فقد', s0.length === 2, JSON.stringify(s0.map((x) => x.kind)))
check('التتالي: النافذة الثانية لا تغطي الأولى تماماً', s0.length === 2 && (s0[0].x !== s0[1].x || s0[0].y !== s0[1].y), s0.map((x) => `${x.x},${x.y}`).join(' / '))

// ① ترتيب z بالتركيز: انقر على النافذة السفلية
await page.evaluate(() => {
  const wins = [...document.querySelectorAll('[data-app-window]')]
  const lowest = wins.reduce((a, b) => (Number(getComputedStyle(a).zIndex) <= Number(getComputedStyle(b).zIndex) ? a : b))
  lowest.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
})
await wait(600)
let s1 = await state()
check('النقر يرفع النافذة إلى الأعلى (z-order)', s1.length === 2 && s1[0].z !== s0[0].z, s1.map((x) => `${x.kind}:${x.z}`).join(' '))
check('تمييز النافذة النشطة بصرياً', s1.some((x) => x.active), s1.map((x) => `${x.kind}:${x.active}`).join(' '))

// ② التصغير والاستعادة
const beforeMin = (await state()).length
await page.evaluate(() => document.querySelector('[data-app-window] [data-window-minimize]')?.click())
await wait(700)
const afterMin = await state()
const bar = await taskbar()
check('التصغير يزيل النافذة من السطح', afterMin.length === beforeMin - 1, `نوافذ=${afterMin.length}`)
check('النافذة المصغَّرة تظهر في شريط النوافذ', bar.length >= 1, bar.join(' | '))
await page.evaluate(() => document.querySelector('[data-window-taskbar] button')?.click())
await wait(700)
check('الاستعادة من الشريط تُرجع النافذة', (await state()).length === beforeMin)

// ③ التكبير والاستعادة + النقر المزدوج على شريط العنوان
const before = (await state())[0]
await page.evaluate(() => document.querySelector('[data-app-window] [data-window-maximize]')?.click())
await wait(700)
const maxed = (await state()).find((x) => x.kind === before.kind)
check('التكبير يملأ مساحة العمل', !!maxed && maxed.w >= w - 20, `${maxed?.w}×${maxed?.h}`)
await page.evaluate(() => document.querySelector('[data-app-window] [data-window-maximize]')?.click())
await wait(700)
const restored = (await state()).find((x) => x.kind === before.kind)
check('الاستعادة تُرجع المقاس السابق', !!restored && Math.abs(restored.w - before.w) < 4, `${restored?.w}×${restored?.h}`)
const dbl = await page.evaluate(() => {
  const bar = document.querySelector('[data-app-window] .app-window-bar')
  if (!bar) return null
  const before = document.querySelector('[data-app-window]').getBoundingClientRect().width
  bar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  return before
})
await wait(700)
const afterDbl = (await state())[0]
check('النقر المزدوج على الشريط يكبّر/يستعيد', dbl !== null && Math.abs(afterDbl.w - dbl) > 20, `${dbl} ⇐ ${afterDbl.w}`)

// ④ السحب بالماوس فعلياً — بعد الاستعادة من التكبير
await page.evaluate(() => { const b = document.querySelector('[data-app-window].is-maximized [data-window-maximize]'); b?.click() })
await wait(700)
const win = (await state())[0]
await page.mouse.move(win.x + win.w / 2, win.y + 10)
await page.mouse.down()
await page.mouse.move(win.x + win.w / 2 - 60, win.y + 60, { steps: 8 })
await page.mouse.up()
await wait(500)
const moved = (await state())[0]
check('سحب النافذة من شريط العنوان', Math.abs(moved.x - win.x) > 5 || Math.abs(moved.y - win.y) > 5, `${win.x},${win.y} ⇐ ${moved.x},${moved.y}`)

// ⑤ مقبض التحجيم
const hasHandle = await page.evaluate(() => !!document.querySelector('[data-app-window] .app-window-resize'))
check('مقبض تحجيم ظاهر', hasHandle)
if (hasHandle) {
  const r0 = (await state())[0]
  const handle = await page.evaluate(() => {
    const el = document.querySelector('[data-app-window] .app-window-resize.is-se')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.move(handle.x, handle.y)
  await page.mouse.down()
  await page.mouse.move(handle.x - 80, handle.y - 60, { steps: 8 })
  await page.mouse.up()
  await wait(500)
  const r1 = (await state())[0]
  check('التحجيم بالمقبض يغيّر المقاس', Math.abs(r1.w - r0.w) > 20 || Math.abs(r1.h - r0.h) > 20, `${r0.w}×${r0.h} ⇐ ${r1.w}×${r1.h}`)
}

// ⑥ مفاتيح التنقل بين النوافذ
// استعادة النافذة قبل اختبار السحب/التحجيم إن كانت مكبَّرة
await page.evaluate(() => { const b = document.querySelector('[data-app-window].is-maximized [data-window-maximize]'); b?.click() })
await wait(600)
for (const [label, run] of [
  ['Ctrl+Alt+W تنقّل', async () => { await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('w'); await page.keyboard.up('Alt'); await page.keyboard.up('Control') }],
  ['Ctrl+Alt+1 قفز', async () => { await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('1'); await page.keyboard.up('Alt'); await page.keyboard.up('Control') }],
  ['Ctrl+Alt+↑ تكبير', async () => { await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Alt'); await page.keyboard.up('Control') }],
  ['Ctrl+Alt+M تصغير', async () => { await page.keyboard.down('Control'); await page.keyboard.down('Alt'); await page.keyboard.press('m'); await page.keyboard.up('Alt'); await page.keyboard.up('Control') }],
]) {
  const before = JSON.stringify(await state())
  await run()
  await wait(600)
  const after = JSON.stringify(await state())
  check(label, before !== after, before === after ? 'لا استجابة' : 'استجابت')
  if (label.includes('تصغير')) { await page.evaluate(() => document.querySelector('[data-window-taskbar] button')?.click()); await wait(600) }
  if (label.includes('تكبير')) { await page.evaluate(() => { const b = document.querySelector('[data-app-window].is-maximized [data-window-maximize]'); b?.click() }); await wait(600) }
}
const activeMark = await page.evaluate(() => [...document.querySelectorAll('[data-app-window]')].map((el) => el.classList.contains('is-active')))
check('تمييز النافذة النشطة (is-active)', activeMark.filter(Boolean).length === 1, JSON.stringify(activeMark))

// ⑦ الحركة: هل هناك انتقال معرَّف للنافذة؟
const anim = await page.evaluate(() => {
  const el = document.querySelector('[data-app-window]')
  const cs = el && getComputedStyle(el)
  return cs ? { transition: cs.transition.slice(0, 80), animation: cs.animationName, willChange: cs.willChange } : null
})
check('انتقال/حركة معرَّفة للنافذة', !!anim && (anim.transition !== 'all 0s ease 0s' || anim.animation !== 'none'), JSON.stringify(anim))

await page.screenshot({ path: process.env.OUT ?? '/home/user/winbehave.png' })
const bad = results.filter((r) => !r.ok)
console.log(bad.length ? `\n❌ ${bad.length} ملاحظة من ${results.length}` : `\n✅ كل السلوكيات سليمة (${results.length})`)
await browser.close()
